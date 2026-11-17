// Human-like playtest with REAL input: keyboard + mouse on desktop, touch on a phone.
// A planner picks each shot (disc, curve, aim, power) using the game's physics, then the shot is
// executed only through the UI: disc key/button, Q/E or curve buttons, then a pull-back drag (mouse or touch)
// whose end point gets a few pixels of human-sized jitter, or on desktop every other shot arrows + hold Space
// (real timing jitter).
// Usage: node tests/realplay.mjs <url> [desktopHoles] [phoneHoles]   e.g. 1,2,5,6 3,4,8,9
import { chromium } from 'playwright-core';
const url0 = process.argv[2] || 'https://thebamco.github.io/disc-golf-play/';
const COURSE_ID = process.env.COURSE || 'park';
const SEED = process.env.SEED || '2026'; // wind on, same winds every run
const url = url0 + (url0.includes('?') ? '&' : '?') + 'course=' + COURSE_ID + '&seed=' + SEED; // straight into Maple Park (the picker has its own test)
const deskHoles = (process.argv[3] || '1,2,5,6').split(',').map(Number);
const phoneHoles = (process.argv[4] || '3,4,8,9').split(',').map(Number);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const JITTER_PX = Number(process.env.JITTER_PX || 4);
const plan = (page) => page.evaluate(() => {
  const g = window.__game, s = g.state(), base = g.yawToBasket(); let best = null;
  const sc = r => r.outcome === 'made' ? -100 : r.outcome === 'ob' || r.outcome === 'water' ? 1000 : r.dist + (r.trees ? 3 : 0);
  const discs = s.distToBasket > 31 ? ['driver', 'mid'] : ['putter'];
  for (const disc of discs) for (const curve of [-1, 0, 1]) for (let dy = -0.4; dy <= 0.401; dy += 0.1) for (const power of [0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) {
    const r = g.simulate({ power, disc, curve, yaw: base + dy }); let v = sc(r);
    // a careful human avoids shots that go OB with a small miss
    if (r.outcome !== 'made') for (const [dp, da] of [[0.05, 0], [-0.05, 0], [0, 0.035], [0, -0.035]]) v = Math.max(v, sc(g.simulate({ power: Math.min(1, power + dp), disc, curve, yaw: base + dy + da })));
    if (!best || v < best.v) best = { v, power, disc, curve, yaw: base + dy };
  }
  // prefer a safe, middle-of-the-window putt
  if (best.disc === 'putter') { const ok = []; for (let p = 0.02; p <= 1; p += 0.02) if (g.simulate({ power: p, disc: 'putter', curve: best.curve, yaw: best.yaw }).outcome === 'made') ok.push(p); if (ok.length) best.power = ok[Math.floor(ok.length / 2)]; }
  return { ...best, yaw0: s.yaw, curve0: s.curve, phase: s.phase };
});
const waitRest = page => page.waitForFunction(() => ['aim', 'holed', 'done'].includes(window.__game.state().phase), null, { timeout: 40000 });
const report = [];

async function playHole(page, n, mode, io) {
  await page.evaluate(i => window.__game.loadHole(i), n - 1); await page.waitForTimeout(400);
  const shots = [];
  for (let k = 0; k < 12; k++) {
    const p = await plan(page); if (p.phase !== 'aim') break;
    await io.disc(p.disc);
    await io.curve(p.curve0, p.curve);
    const how = await io.throw(p.power, p.yaw - p.yaw0, k);
    await page.waitForTimeout(200);
    const t0 = await page.evaluate(() => window.__game.state());
    await waitRest(page); await page.waitForTimeout(100);
    const s = await page.evaluate(() => window.__game.state());
    const ob = s.events.some(e => e.type === 'ob' && e.throw === s.throws) ? 'OB' : s.events.some(e => e.type === 'water' && e.throw === s.throws) ? 'SPLASH' : null;
    shots.push(`${how} ${p.disc}${p.curve ? (p.curve > 0 ? ' +' : ' ') + p.curve : ''} aim ${(p.yaw - p.yaw0 >= 0 ? '+' : '')}${((p.yaw - p.yaw0) * 57.3).toFixed(0)}° power ${p.power.toFixed(2)}→${t0.lastThrow?.power.toFixed(2)} ⇒ ${s.phase === 'holed' ? (s.result.made ? 'IN' : 'picked up') : ob ? ob : s.distToBasket.toFixed(1) + ' m'}`);
    if (s.phase === 'holed') { report.push({ mode, n, wind: `${s.wind.mph} mph ${s.wind.band}`, par: s.result && (await page.evaluate(() => window.__game.hole().par)), score: s.result.throws, made: s.result.made, shots }); return; }
  }
  report.push({ mode, n, score: null, shots });
}

// ---- Desktop: keyboard + mouse
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url); await page.waitForFunction(() => window.__game); await page.waitForTimeout(1000);
  const io = {
    disc: d => page.keyboard.press({ driver: '1', mid: '2', putter: '3' }[d]),
    curve: async (from, to) => { let c = from; while (c !== to) { const side = to < c ? -1 : 1; await page.keyboard.press(side < 0 ? 'q' : 'e'); c = Math.sign(c) === -side ? 0 : side; } }, // Q/E step left/straight/right
    throw: async (power, dyaw, k) => {
      if (k % 2 === 1) { // keyboard: arrows to aim (0.9 rad/s), hold Space (fills to 100% in CHARGE_FULL_S, eased)
        const { CHARGE_FULL_S } = await page.evaluate(() => ({ CHARGE_FULL_S: window.__game.CHARGE_FULL_S }));
        if (Math.abs(dyaw) > 0.01) { const key = dyaw < 0 ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down(key); await page.waitForTimeout(Math.abs(dyaw) / 0.9 * 1000); await page.keyboard.up(key); }
        await page.keyboard.down('Space'); await page.waitForTimeout(CHARGE_FULL_S * 1000 * Math.pow(power, 1 / 1.5)); await page.keyboard.up('Space');
        return 'keys';
      }
      const v = await page.evaluate(([p, o]) => window.__game.pullFor(p, o), [power, dyaw]);
      await page.mouse.move(640, 420); await page.mouse.down();
      await page.mouse.move(640 + v.dx + rnd() * JITTER_PX, 420 + v.dy + rnd() * JITTER_PX, { steps: 10 }); await page.waitForTimeout(80); await page.mouse.up();
      return 'mouse';
    },
  };
  for (const n of deskHoles) await playHole(page, n, 'desktop keys+mouse', io);
  await page.close();
}
// ---- Phone: touch only
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url); await page.waitForFunction(() => window.__game); await page.waitForTimeout(1000);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const center = async sel => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const tap = async sel => { const [x, y] = await center(sel); await touch('touchStart', [[x, y]]); await touch('touchEnd', []); };
  const io = {
    disc: d => tap(`#disc-${d}`),
    curve: async (from, to) => { await tap('#straightbtn'); if (to) await tap(to < 0 ? '#hyzerbtn' : '#anhyzerbtn'); },
    throw: async (power, dyaw) => {
      const v = await page.evaluate(([p, o]) => window.__game.pullFor(p, o), [power, dyaw]);
      const ex = v.dx + rnd() * JITTER_PX, ey = v.dy + rnd() * JITTER_PX, steps = 10;
      await touch('touchStart', [[195, 360]]);
      for (let i = 1; i <= steps; i++) await touch('touchMove', [[195 + ex * i / steps, 360 + ey * i / steps]]);
      await page.waitForTimeout(80); await touch('touchEnd', []);
      return 'touch';
    },
  };
  for (const n of phoneHoles) await playHole(page, n, 'phone touch', io);
  // landscape: scorecard + restart menu fit and don't overlap the controls badly
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(300);
  await tap('#cardbtn'); await page.waitForTimeout(200);
  const card = await page.evaluate(() => { const r = document.querySelector('#scorecard .cardpanel').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); });
  await tap('#cardclose'); await tap('#restartbtn'); await page.waitForTimeout(200);
  const menu = await page.evaluate(() => { const r = document.getElementById('restartmenu').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); });
  await tap('#restartcancel');
  report.push({ mode: 'landscape overlays', card, menu, ok: card[0] >= 0 && card[1] >= 0 && card[2] <= 844 && card[3] <= 390 && menu[3] <= 390 && menu[2] <= 844 });
}
for (const r of report) {
  if (r.shots) { console.log(`${r.mode} — hole ${r.n} (par ${r.par}, wind ${r.wind}): ${r.score ?? 'not finished'}${r.made === false ? ' (picked up)' : ''}`); r.shots.forEach((s, i) => console.log(`    ${i + 1}. ${s}`)); }
  else console.log(r.mode, JSON.stringify(r));
}
console.log('errors', errors.length ? errors : 'none');
await browser.close();
