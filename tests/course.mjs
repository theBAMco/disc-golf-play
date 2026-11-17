// Whole-course checks in phone emulation: hole data, every hole completable, Next Hole, scorecard totals,
// end screen, restart round. Bots use the game's own physics (window.__game.simulate).
// Usage: node tests/course.mjs <url> [shotsDir|-] [courseId: park|river|antarctica|volcano]
import { chromium } from 'playwright-core';
const g2level = c => !c ? 0 : Math.abs(c) > 1.5 ? 3 : Math.abs(c) > 1.2 ? 2 : 1;
const url0 = process.argv[2] || 'https://thebamco.github.io/disc-golf-play/';
const SEED = process.env.SEED || '2026'; // wind on, fixed seed so rounds are repeatable
const url = url0 + (url0.includes('?') ? '&' : '?') + 'seed=' + SEED;
const shots = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : null;
const COURSE_ID = process.argv[4] || 'park';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto(url); await page.waitForFunction(() => window.__game, null, { timeout: 30000 });
await page.waitForTimeout(800);
// Start from the course picker with a real tap
const pick0 = await page.evaluate(() => window.__game.state());
await page.evaluate(id => window.__game.homeSelect(id), COURSE_ID); await page.waitForFunction(id => { const r = document.getElementById('pick-' + id)?.getBoundingClientRect(); return r && Math.abs(r.left + r.width / 2 - innerWidth / 2) < 3; }, COURSE_ID, { timeout: 15000 });
{ const b = await page.locator(`#pick-${COURSE_ID}`).boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
await page.waitForTimeout(400);
const pick1 = await page.evaluate(() => window.__game.state());
const results = {}; const check = (n, ok, d) => { results[n] = { ok: !!ok, detail: d }; };
const EXPECT = { park: [3, 3, 3, 3, 4, 3, 4, 3, 4], river: [3, 3, 3, 4, 3, 4, 3, 4, 4], antarctica: [3, 3, 3, 4, 4, 3, 3, 5, 4], volcano: [3, 4, 3, 3, 4, 4, 3, 5, 4], moon: [3, 3, 3, 4, 3, 4, 4, 5, 4] }[COURSE_ID];
const EXPECT_PAR = EXPECT.reduce((a, b) => a + b, 0);
check('picked_from_picker', pick0.pickerOpen && pick0.phase === 'menu' && !pick1.pickerOpen && pick1.course === COURSE_ID && pick1.phase === 'aim' && pick1.hole === 1, `start: picker ${pick0.pickerOpen}, phase ${pick0.phase}; tapped ${COURSE_ID}: course ${pick1.course}, world ${pick1.world}, hole ${pick1.hole}, phase ${pick1.phase}`);

// 1. Each hole loads with the par, tee and basket from the course data
const holes = await page.evaluate(() => { const g = window.__game, c = g.course(), out = [];
  c.holes.forEach((d, i) => { g.loadHole(i); const h = g.hole(), s = g.state();
    out.push({ n: h.n, name: h.name, par: h.par, dataPar: d.par, length: Math.round(h.length), tee: [h.tee.x, h.tee.z], dataTee: d.tee, basket: [h.basket.x, h.basket.z], dataBasket: d.basket, lie: [s.lie.x, s.lie.z], throws: s.throws,
      title: document.getElementById('holetitle').textContent, trees: h.trees.length, elev: h.basket.y }); });
  return { par: c.par, out }; });
const holeOk = holes.out.length === 9 && holes.out.every((h, i) => h.n === i + 1 && h.par === h.dataPar && h.par === EXPECT[i] && String(h.tee) === String(h.dataTee) && String(h.basket) === String(h.dataBasket) && String(h.lie) === String(h.tee) && h.throws === 0 && h.title === `HOLE ${i + 1}/9 · PAR ${h.par}`);
check('holes_load_from_data', holeOk && holes.par === EXPECT_PAR, `course par ${holes.par}; ` + holes.out.map(h => `#${h.n} ${h.name} par ${h.par} ${h.length} m${h.elev > 0.5 ? ` (basket +${h.elev.toFixed(1)} m)` : ''}`).join('; '));

if (shots) for (const i of { park: [0, 1, 5, 7], river: [1, 2, 3, 4], antarctica: [0, 2, 3, 5], volcano: [0, 2, 3, 4, 6], moon: [0, 3, 6] }[COURSE_ID]) {
  await page.evaluate(i => window.__game.loadHole(i), i); await page.waitForTimeout(2900); // let the intro banner fade
  await page.screenshot({ path: `${shots}/${{ park: 'course', river: 'river', antarctica: 'antarctica', volcano: 'volcano', moon: 'moon' }[COURSE_ID]}-hole-${i + 1}.png` });
}

// 2. Bots play full rounds through the real hole flow (Next hole each time)
const rounds = await page.evaluate(() => {
  const g = window.__game;
  const scoreOf = r => r.outcome === 'made' ? -100 : (r.outcome === 'ob' || r.outcome === 'water') ? 1000 : r.dist;
  const planGood = () => {
    const s = g.state(), base = g.yawToBasket(); let best = null;
    const discs = s.distToBasket > 31 ? ['driver', 'mid', 'putter'] : ['putter', 'mid'];
    const search = (combos, span) => { for (const disc of discs) for (const [curve, tomahawk] of combos) for (let dy = -span; dy <= span + 0.001; dy += 0.1) for (const power of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
      const r = g.simulate({ power, disc, curve, yaw: base + dy, tomahawk }), sc = scoreOf(r) + (tomahawk ? 0.5 : 0);
      if (!best || sc < best.score) best = { score: sc, power, disc, curve, tomahawk, yaw: base + dy };
    } };
    search([[-1, false], [0, false], [1, false]], 0.5);
    // stuck (e.g. at the foot of a wall): look much wider, and try a tomahawk over it
    if (best.score > s.distToBasket - 2) search([[-1, false], [0, false], [1, false], [0, true]], 1.5);
    for (let k = -0.06; k <= 0.0601; k += 0.02) { const power = Math.min(1, Math.max(0.02, best.power + k));
      const sc = scoreOf(g.simulate({ power, disc: best.disc, curve: best.curve, yaw: best.yaw, tomahawk: best.tomahawk })) + (best.tomahawk ? 0.5 : 0); if (sc < best.score) best = { ...best, score: sc, power }; }
    return best;
  };
  const planNaive = () => { const s = g.state(); return { disc: s.suggested, curve: 0, yaw: g.yawToBasket(), power: Math.min(1, Math.max(0.05, s.distToBasket / g.discRange[s.suggested])) }; };
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const planHuman = () => { const p = planGood(); return { ...p, power: Math.min(1, Math.max(0.02, p.power + rnd() * 0.08)), yaw: p.yaw + rnd() * 0.035 }; };
  const play = (plan, label) => {
    g.restartRound(); const holes = []; const flow = [];
    for (let i = 0; i < 9; i++) {
      const log = [];
      for (let guard = 0; guard < 20; guard++) {
        const s = g.state(); if (s.phase !== 'aim') break;
        const p = plan(); g.selectDisc(p.disc); g.setAim(p.yaw); g.setTomahawk(!!p.tomahawk); g.throwWith(p.power, p.curve); const t = g.fastForward();
        const ob = t.events.some(e => (e.type === 'ob' || e.type === 'water') && e.throw === t.throws);
        log.push(`${p.disc[0]}${p.tomahawk ? 'T' : ''}${p.curve ? (p.curve > 0 ? '+' : '') + p.curve : ''}@${p.power.toFixed(2)}→${t.phase === 'holed' ? (t.result.made ? 'IN' : 'pickup') : ob ? (t.events.some(e => e.type === 'water' && e.throw === t.throws) ? 'SPLASH' : 'OB') : t.distToBasket.toFixed(0) + 'm'}`);
      }
      const s = g.state();
      holes.push({ n: i + 1, wind: s.wind.mph, par: g.hole().par, score: s.result?.throws, made: s.result?.made, log: log.join(' ') });
      const btn = document.getElementById('nextbtn');
      flow.push({ hole: s.hole, phase: s.phase, nextVisible: !btn.classList.contains('hidden'), label: btn.textContent });
      btn.click(); // the real Next hole button
    }
    const card = document.getElementById('scorecard');
    const marks = [...card.querySelectorAll('tr:nth-child(3) td .mark')].map(m => ({ n: Number(m.textContent), cls: m.className.replace('mark ', '') }));
    return { label, holes, flow, courseName: g.course().name, round: g.round(), phase: g.state().phase, card: { open: !card.classList.contains('hidden'), final: card.classList.contains('final'),
      total: document.getElementById('cardtotal').textContent, title: document.getElementById('cardtitle').textContent, sub: document.getElementById('cardsub').textContent,
      again: !document.getElementById('cardagain').classList.contains('hidden'), marks } };
  };
  const res = [play(planNaive, 'naive'), play(planGood, 'good')];
  for (let k = 0; k < 3; k++) res.push(play(planHuman, `human-ish #${k + 1}`));
  return res;
});
for (const r of rounds) {
  console.log(`== ${r.label}: ${r.round.strokes} throws (${r.round.toPar >= 0 ? '+' : ''}${r.round.toPar}), card total ${r.card.total}`);
  for (const h of r.holes) console.log(`   H${h.n} par ${h.par} wind ${h.wind}: ${h.score}${h.made ? '' : ' (picked up)'}  ${h.log}`);
}
const good = rounds.find(r => r.label === 'good');
check('every_hole_completable', rounds.every(r => r.holes.every(h => h.score > 0)) && good.holes.every(h => h.made && h.score <= h.par + (COURSE_ID === 'park' ? 0 : 1)),
  rounds.map(r => `${r.label}: ${r.holes.map(h => h.score + (h.made ? '' : 'p')).join(' ')}`).join(' | '));
check('next_hole_flow', rounds.every(r => r.flow.every((f, i) => f.hole === i + 1 && f.phase === 'holed' && f.nextVisible && f.label === (i === 8 ? 'Final scorecard ▶' : 'Next hole ▶'))),
  `after each hole: phase holed + "${good.flow[0].label}" … "${good.flow[8].label}" clicked`);
const totalsOk = rounds.every(r => { const sum = r.holes.reduce((a, h) => a + h.score, 0), par = r.holes.reduce((a, h) => a + h.par, 0);
  return sum === r.round.strokes && Number(r.card.total) === sum && r.round.toPar === sum - par && r.card.marks.length === 9 && r.card.marks.every((m, i) => m.n === r.holes[i].score) &&
    r.card.marks.every((m, i) => { const d = r.holes[i].score - r.holes[i].par; return m.cls === (d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'dbogey'); }); });
check('scorecard_totals', totalsOk, rounds.map(r => `${r.label}: ${r.card.sub}`).join(' | '));
check('end_screen', rounds.every(r => r.phase === 'done' && r.card.open && r.card.final && r.card.again && r.card.title.endsWith('Round complete!') && r.card.title.startsWith(r.courseName)), `title "${good.card.title}", Play again shown: ${good.card.again}`);
if (shots) { await page.waitForTimeout(500); await page.screenshot({ path: `${shots}/scorecard.png` }); }
const box = await page.evaluate(() => { const r = document.querySelector('#scorecard .cardpanel').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); });
check('scorecard_fits_phone', box[0] >= 0 && box[1] >= 0 && box[2] <= 390 && box[3] <= 844, `card panel ${box}`);
// 3. A full 9-hole round with REAL touch input only: disc/curve taps, pull-back drags (with finger jitter), Next button taps
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
const center = async sel => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const tap = async sel => { const [x, y] = await center(sel); await touch('touchStart', [[x, y]]); await touch('touchEnd', []); await page.waitForTimeout(60); };
let tseed = 5; const trnd = () => ((tseed = (tseed * 16807) % 2147483647) / 2147483647) * 2 - 1;
await page.evaluate(() => window.__game.restartRound()); await page.waitForTimeout(400);
const touchRound = []; let curveMismatch = 0; const curveUsed = [0, 0, 0, 0];
for (let i = 0; i < (process.env.SKIP_TOUCH ? 0 : 9); i++) {
  const log = [];
  for (let k = 0; k < 14; k++) {
    const p = await page.evaluate(() => { const g = window.__game, s = g.state(); if (s.phase !== 'aim') return null; const base = g.yawToBasket(); let best = null;
      const sc = r => r.outcome === 'made' ? -100 : (r.outcome === 'ob' || r.outcome === 'water') ? 1000 : r.dist + (r.trees ? 3 : 0);
      const pass = (combos, span) => { for (const disc of s.distToBasket > 31 ? ['driver', 'mid'] : ['putter']) for (const [curve, tomahawk] of combos) for (let dy = -span; dy <= span + 0.001; dy += 0.1) for (const power of [0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) {
        const r = g.simulate({ power, disc, curve, yaw: base + dy, tomahawk }); let v = sc(r) + (tomahawk ? 0.5 : 0);
        if (r.outcome !== 'made') for (const [dp, da] of [[0.05, 0], [-0.05, 0], [0, 0.035], [0, -0.035]]) v = Math.max(v, sc(g.simulate({ power: Math.min(1, power + dp), disc, curve, yaw: base + dy + da, tomahawk })) + (tomahawk ? 0.5 : 0));
        if (!best || v < best.v) best = { v, power, disc, curve, tomahawk, yaw: base + dy }; } };
      pass([[-1.66, false], [-1.37, false], [-1, false], [0, false], [1, false], [1.37, false], [1.66, false]], 0.4);
      if (s.distToBasket > 20 && best.v >= s.distToBasket) pass([[-1, false], [0, false], [1, false], [0, true]], 1.5); // stuck: aim wide, or tomahawk over
      if (best.disc === 'putter') { const ok = []; for (let q = 0.02; q <= 1; q += 0.02) if (g.simulate({ power: q, disc: 'putter', curve: best.curve, yaw: best.yaw, tomahawk: best.tomahawk }).outcome === 'made') ok.push(q); if (ok.length) best.power = ok[Math.floor(ok.length / 2)]; }
      return { ...best, offset: best.yaw - s.yaw, pull: g.pullFor(best.power, best.yaw - s.yaw) }; });
    if (!p) break;
    await tap(`#disc-${p.disc}`);
    await tap('#straightbtn'); if (p.tomahawk) await tap('#tomahawkbtn'); for (let l = 0; l < Math.abs(g2level(p.curve)); l++) await tap(p.curve < 0 ? '#hyzerbtn' : '#anhyzerbtn'); // taps stack: level 1/2/3
    const ex = p.pull.dx + trnd() * 6, ey = p.pull.dy + trnd() * 6;
    await touch('touchStart', [[195, 360]]); for (let j = 1; j <= 8; j++) await touch('touchMove', [[195 + ex * j / 8, 360 + ey * j / 8]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(150);
    await page.waitForFunction(() => ['aim', 'holed', 'done'].includes(window.__game.state().phase), null, { timeout: 90000 });
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => window.__game.state());
    const pen = s.events.find(e => (e.type === 'water' || e.type === 'ob') && e.throw === s.throws);
    const tl = g2level(s.lastThrow?.curve || 0); if (Math.sign(s.lastThrow?.curve || 0) * tl !== Math.sign(p.curve || 0) * g2level(p.curve)) curveMismatch++; else if (tl) curveUsed[tl]++;
    log.push(`${p.disc[0]}${tl ? (s.lastThrow.curve < 0 ? ' L' : ' R') + tl : ''}@${s.lastThrow?.power.toFixed(2)}→${s.phase === 'holed' ? (s.result.made ? 'IN' : 'pickup') : pen ? (pen.type === 'water' ? 'SPLASH' : 'OB') : s.distToBasket.toFixed(0) + 'm'}`);
    if (s.phase === 'holed') break;
  }
  const s = await page.evaluate(() => ({ s: window.__game.state(), par: window.__game.hole().par }));
  touchRound.push({ n: i + 1, par: s.par, score: s.s.result?.throws, made: s.s.result?.made, log: log.join(' ') });
  console.error(`touch H${i + 1}: ${s.s.result?.throws} ${log.join(' ')} (${new Date().toTimeString().slice(0, 8)})`);
  await page.waitForTimeout(300);
  await tap('#nextbtn'); await page.waitForTimeout(500);
}
const tr = await page.evaluate(() => ({ round: window.__game.round(), phase: window.__game.state().phase, total: document.getElementById('cardtotal').textContent }));
console.log(`   touch curve taps: level 1 ×${curveUsed[1]}, level 2 ×${curveUsed[2]}, level 3 ×${curveUsed[3]}, mismatches ${curveMismatch}`);
console.log(`== touch round: ${tr.round.strokes} (${tr.round.toPar >= 0 ? '+' : ''}${tr.round.toPar})`); touchRound.forEach(h => console.log(`   H${h.n} par ${h.par}: ${h.score}  ${h.log}`));
if (!process.env.SKIP_TOUCH) check('touch_round_complete', curveMismatch === 0 && touchRound.every(h => h.score > 0) && tr.round.played === 9 && tr.phase === 'done' && Number(tr.total) === tr.round.strokes,
  `real touch pulls, all 9 holes: ${touchRound.map(h => h.score + (h.made ? '' : 'p')).join(' ')} = ${tr.round.strokes} (${tr.round.toPar >= 0 ? '+' : ''}${tr.round.toPar}); card total ${tr.total}; end screen ${tr.phase}`);
if (process.env.SKIP_TOUCH) await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 9; i++) { /* finish quickly for the end-screen checks */ } });
// Play again from the end screen (real tap)
if (!process.env.SKIP_TOUCH) { const ag = await page.locator('#cardagain').boundingBox();
await page.touchscreen.tap(ag.x + ag.width / 2, ag.y + ag.height / 2); await page.waitForTimeout(300);
const again = await page.evaluate(() => ({ s: window.__game.state(), r: window.__game.round() }));
check('play_again', again.s.hole === 1 && again.s.phase === 'aim' && again.r.played === 0 && !again.s.cardOpen, `hole ${again.s.hole}, played ${again.r.played}, card open ${again.s.cardOpen}`); }
check('no_console_errors', errors.length === 0, errors.join(' | ') || 'none');
console.log(JSON.stringify(results, null, 2));
await browser.close();
process.exit(Object.values(results).every(r => r.ok) ? 0 : 1);
