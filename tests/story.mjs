// Course story (Antarctica polar bear), phone emulation 390x844 with real touch for the final putt:
// every hole's clue spawns (props + caption), clues stay off the line of play, the hole-6 roar shakes the camera mid-throw,
// eyes blink then vanish on hole 7, the ridge shadow walks on hole 8, and after hole 9 the bear reveal plays, then the scorecard.
// Other courses have no story. Usage: node tests/story.mjs <url> [shotsDir|-]
import { chromium } from 'playwright-core';
const url0 = process.argv[2] || 'https://thebamco.github.io/disc-golf-play/';
const shots = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : null;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
const g = (fn, arg) => page.evaluate(fn, arg);
const results = {}; const check = (n, ok, d) => { results[n] = { ok: !!ok, detail: d }; };
const story = () => g(() => window.__game.story());
const open = async (course) => { await page.goto(url0 + (url0.includes('?') ? '&' : '?') + `course=${course}&seed=2026`); await page.waitForFunction(() => window.__game, null, { timeout: 30000 }); await page.waitForTimeout(800); };
const EXPECT = ['camp', 'crates', 'claws', 'prints', 'hut', 'roar', 'eyes', 'shadow', 'cave'];

await open('antarctica');
const first = await story();
check('no_intro_caption', first.hasStory && first.clue === 'camp' && !first.captionVisible && !first.caption, `hole 1: caption shown ${first.captionVisible} ("${first.caption}")`); // Ben: only radio / creature-sound text boxes stay
if (shots) { await page.waitForTimeout(2600); await page.screenshot({ path: `${shots}/story-hole-1.png` }); }
const per = [];
for (let i = 0; i < 9; i++) {
  await g(i => window.__game.loadHole(i), i); await page.waitForTimeout(400);
  const s = await story();
  // off the line of play: anchor farther than half the fairway from the hole's path (prints are flat decals and the claw wall sits on the serac wall)
  const off = await g(at => { if (!at) return null; const h = window.__game.hole(); let best = 1e9; const P = h.path;
    for (let k = 0; k < P.length - 1; k++) { const [ax, az] = P[k], [bx, bz] = P[k + 1], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((at[0] - ax) * dx + (at[1] - az) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(at[0] - ax - dx * t, at[1] - az - dz * t)); } return { d: best, half: h.width / 2 }; }, s.at);
  per.push({ n: i + 1, clue: s.clue, meshes: s.meshes, cap: s.captionVisible && !!s.caption, bubbles: s.bubbles, text: s.caption, off });
  if (i === 2 && shots) { await page.waitForTimeout(2600); await page.screenshot({ path: `${shots}/story-hole-3.png` }); }
  if (i === 6) { // eyes: appear, blink, then vanish
    const seen = []; for (const t of [0.5, 2.5, 3.15, 5, 8]) { await g(t => window.__game.holeTime(t), t); await page.waitForTimeout(450); /* a few frames even on a slow emulated phone */ seen.push(await story()); }
    check('eyes_blink_then_vanish', !seen[0].eyes.visible && seen[1].eyes.visible && seen[3].eyes.visible && !seen[4].eyes.visible, seen.map((x, k) => `${[0.5, 2.5, 3.15, 5, 8][k]}s:${x.eyes.visible ? 'eyes' : '-'}`).join(' '));
    if (shots) { await g(() => window.__game.holeTime(2.4)); await page.waitForTimeout(150); await page.screenshot({ path: `${shots}/story-hole-7.png` }); }
  }
  if (i === 7) { const a = []; for (const t of [1, 6, 15]) { await g(t => window.__game.holeTime(t), t); await page.waitForTimeout(450); /* a few frames even on a slow emulated phone */ a.push((await story()).shadow.visible); }
    check('ridge_shadow_walks_then_gone', !a[0] && a[1] && !a[2], `1s ${a[0]}, 6s ${a[1]}, 15s ${a[2]}`); }
  if (i === 5) { // a throw on hole 6: the roar shakes the camera mid-flight
    await g(() => { const gm = window.__game; gm.selectDisc('mid'); gm.aimAtBasket(); gm.throwWith(0.6, 0); });
    await page.waitForFunction(() => window.__game.story().roared, null, { timeout: 8000 }).catch(() => {});
    const r = await story(); await page.waitForFunction(() => ['aim', 'holed'].includes(window.__game.state().phase), null, { timeout: 30000 });
    check('roar_mid_throw', r.roared && r.shake && /ROO/.test(r.caption), `roared ${r.roared}, shaking ${r.shake}, caption "${r.caption}"`);
  }
}
check('every_hole_clue_spawns', per.every((p, i) => p.clue === EXPECT[i] && p.meshes > 3 && p.cap === [6].includes(p.n)), per.map(p => `H${p.n} ${p.clue} (${p.meshes} parts)`).join(', '));
const KEEP_BUBBLES = {"5": ["kssshh…"]}, KEEP_CAPTION = {6: /growl/i}; // the only text left: crackling radios and creature noises
check('only_radio_and_creature_text', per.every(p => JSON.stringify(p.bubbles) === JSON.stringify(KEEP_BUBBLES[p.n] || []) && (KEEP_CAPTION[p.n] ? KEEP_CAPTION[p.n].test(p.text || '') : !p.cap)),
  per.map(p => `H${p.n}: ${p.cap ? `"${(p.text || '').slice(0, 30)}…"` : 'no caption'}${p.bubbles.length ? ' + ' + p.bubbles.join('/') : ''}`).join(' | '));
check('clues_off_the_line_of_play', per.every(p => !p.off || ['prints', 'claws'].includes(p.clue) || p.off.d > p.off.half + 1),
  per.filter(p => p.off).map(p => `H${p.n} ${p.off.d.toFixed(1)} m (half-width ${p.off.half})`).join(', '));

// Hole 9 reveal: real touch putt from 4 m; the bear bursts out, roars, then the scorecard
await g(() => window.__game.loadHole(8)); await page.waitForTimeout(400);
await g(() => { const gm = window.__game, b = gm.basket; gm.placeDisc(b.x + 2.4, b.z + 3.2); gm.selectDisc('putter'); gm.setCurve(0); gm.aimAtBasket(); });
const pw = await g(() => { const gm = window.__game, ok = []; for (let q = 0.02; q <= 1; q += 0.02) if (gm.simulate({ power: q, disc: 'putter', curve: 0, yaw: gm.yawToBasket() }).outcome === 'made') ok.push(q); return ok[Math.floor(ok.length / 2)]; });
const v = await g(p => window.__game.pullFor(p, 0), pw);
await touch('touchStart', [[195, 360]]); for (let j = 1; j <= 8; j++) await touch('touchMove', [[195 + v.dx * j / 8, 360 + v.dy * j / 8]]); await touch('touchEnd', []);
await page.waitForFunction(() => window.__game.state().phase === 'holed', null, { timeout: 20000 });
const r0 = await story();
await page.waitForFunction(() => window.__game.story().reveal?.stage === 'roar', null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(700);
const r1 = await story(); const s1 = await g(() => window.__game.state());
if (shots) await page.screenshot({ path: `${shots}/story-reveal.png` });
await page.waitForFunction(() => window.__game.state().phase === 'done', null, { timeout: 12000 }).catch(() => {});
const r2 = await story(); const s2 = await g(() => window.__game.state());
check('reveal_after_hole_9', r0.reveal && r0.bannerVeiled && r1.reveal?.stage === 'roar' && r1.reveal.bearVisible && !r1.revealShown && r1.shake && s1.result?.made &&
  s2.phase === 'done' && s2.cardOpen && r2.reveal.done && !r2.bannerVeiled,
  `putt made ${s1.result?.made}; reveal ${r0.reveal?.stage} → ${r1.reveal?.stage} (bear ${r1.reveal?.bearVisible}, title ${r1.revealShown}, shake ${r1.shake}) → phase ${s2.phase}, scorecard ${s2.cardOpen}`);
const hasReveal = await g(() => !!document.getElementById('storyreveal'));
check('no_text_box_after_hole_9', !hasReveal && !r1.revealShown && !r1.captionVisible, `reveal text box in page ${hasReveal}; during the ending: text box shown ${r1.revealShown}, caption ${r1.captionVisible}`); // Ben: no pop-up text after holing out on 9
// tapping Next during the reveal skips straight to the scorecard
await g(() => { const gm = window.__game; gm.loadHole(8); const b = gm.basket; gm.placeDisc(b.x, b.z + 2); gm.selectDisc('putter'); gm.aimAtBasket(); gm.throwWith(0.12, 0); gm.fastForward(); });
await page.waitForTimeout(500); const k0 = await story(); await g(() => document.getElementById('nextbtn').click()); await page.waitForTimeout(300);
const k1 = await g(() => window.__game.state());
check('reveal_skippable', k0.reveal && !k0.reveal.done && k1.phase === 'done' && k1.cardOpen, `reveal playing ${!!k0.reveal}; after Next: phase ${k1.phase}, card ${k1.cardOpen}`);
// Ben: the claw marks and the bear's ridge are real parts of the ice, not flat walls: gouges carved into an ice formation (no box panels), and the bear walks with its feet on a natural ridge's crest
await g(() => window.__game.loadHole(2)); await page.waitForTimeout(400); const cl = await g(() => window.__game.storyProps());
await g(() => { window.__game.loadHole(7); window.__game.holeTime(8); }); await page.waitForTimeout(500); const rg = await g(() => window.__game.storyProps());
await g(() => window.__game.loadHole(3)); await page.waitForTimeout(400); const pr = await g(() => window.__game.storyProps());
check('paw_prints_trail_in_snow', pr.prints && pr.prints.n > 5 && pr.prints.inScene === pr.prints.n && pr.prints.parts >= 2 && pr.prints.tris >= 120 && pr.prints.onGround, JSON.stringify(pr.prints || null)); // pad + 4 toes (merged into one mesh) + snow rim, all laid on the snow
check('claws_carved_into_ice', cl.claws && cl.claws.gouges === 8 && cl.claws.carved > 100 && cl.claws.boxes === 0, JSON.stringify(cl));
check('bear_walks_ridge_crest', rg.ridge && rg.ridge.boxes === 0 && rg.ridge.bearY != null && Math.abs(rg.ridge.bearY - 0.2 - rg.ridge.crestAtBear) < 0.05, JSON.stringify(rg));
// the bear story stays on Antarctica: Maple Park has its own (Bigfoot) story, never the bear
await open('park'); const ps = await story();
check('no_bear_story_on_other_courses', ps.hasStory && ps.clue === 'flyer' && !/bear/i.test(ps.caption || ''), `Maple Park: own story ${ps.hasStory}, clue ${ps.clue}`);
check('no_console_errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
const ok = Object.values(results).every(r => r.ok);
console.log(JSON.stringify({ ok, results }, null, 2)); await browser.close(); process.exit(ok ? 0 : 1);
