// Regression tests for the critique fixes (desktop viewport, real page):
// 1 shared penguin/tree geometry survives hole changes (and memory doesn't grow hole after hole)
// 2 restarting a hole clears its old score; restarting the round clears all
// 3 a disc that comes to rest under the basket counts as made; roll-bys, low fly-throughs and discs leaning on the cage don't
// 4 the aim camera swings around the disc after a landing instead of gliding over it (grass close-up)
// 5 boulders are solid   6 Crater Rim: the raised rim is dry, the lava ponds are still lava
// 7 pull-to-power: default unchanged; the ?pull=2 test link is gentler (short pulls farther, long pulls less far, full pull = full power)
// + nits: closing the picker after holing out doesn't re-score; disc pick sticks; Q/E match the buttons; no landing ring / no preview re-flights
// Usage: node tests/bugfix.mjs <url>
import { chromium } from 'playwright-core';
const url0 = process.argv[2] || 'https://thebamco.github.io/disc-golf-play/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
const results = {}; const check = (n, ok, d) => { results[n] = { ok: !!ok, detail: d }; };
const g = (fn, arg) => page.evaluate(fn, arg);
const open = async (course) => { await page.goto(url0 + (url0.includes('?') ? '&' : '?') + `course=${course}&seed=2026`); await page.waitForFunction(() => window.__game, null, { timeout: 30000 }); await page.waitForTimeout(600); };
const frames = (n = 3) => g(n => new Promise(r => { let k = 0; const f = () => ++k >= n ? r() : requestAnimationFrame(f); requestAnimationFrame(f); }), n);
// hole out from right by the basket with a tap-in
const holeOut = () => g(() => { const gm = window.__game, b = gm.basket; gm.placeDisc(b.x, b.z + 2); gm.selectDisc('putter'); gm.setCurve(0); gm.aimAtBasket(); gm.throwWith(0.12, 0); return gm.fastForward(); });

// 1. Antarctica: go through every hole twice and restart; shared geometry is never disposed, penguins still render, GPU memory flat
await open('antarctica');
const mem = [];
for (let pass = 0; pass < 3; pass++) { for (let i = 0; i < 9; i++) { await g(i => window.__game.loadHole(i), i); await frames(3); } await g(() => window.__game.loadHole(0)); await frames(3); mem.push(await g(() => window.__game.mem())); }
await g(() => window.__game.restartHole()); await frames(3);
const m1 = await g(() => window.__game.mem());
await g(() => window.__game.loadHole(0)); await frames(3); const m2 = await g(() => window.__game.mem());
const peng = await g(() => window.__game.fx().penguinHops !== undefined);
check('shared_geometry_survives', m1.sharedDisposed === 0 && peng && m2.geometries <= mem[1].geometries && mem[2].geometries <= mem[1].geometries,
  `shared geometries disposed: ${m1.sharedDisposed}; GPU geometries on hole 1 after laps 1/2/3 and a restart: ${mem.map(m => m.geometries).join('/')}/${m2.geometries}; textures ${mem.map(m => m.textures).join('/')}/${m2.textures}`);

// 2. Restart hole clears its score; restart round clears all
await open('park');
await g(() => window.__game.loadHole(0)); const h1 = await holeOut();
const r1 = await g(() => window.__game.round());
await g(() => window.__game.restartHole()); await frames(2);
const r2 = await g(() => window.__game.round()); const hud2 = await page.locator('#total').textContent();
await holeOut(); await g(() => window.__game.nextHole()); await holeOut();
const r3 = await g(() => window.__game.round());
await g(() => window.__game.restartRound()); await frames(2); const r4 = await g(() => window.__game.round());
check('restart_clears_score', h1.phase === 'holed' && r1.played === 1 && r2.scores[0] === null && r2.played === 0 && hud2 === 'E' && r3.played === 2 && r4.played === 0 && r4.scores.every(s => s === null),
  `holed H1 in ${r1.scores[0]} → played ${r1.played}; after Restart hole: score ${r2.scores[0]}, played ${r2.played}, HUD Round "${hud2}"; 2 holes played ${r3.played}; after Restart round played ${r4.played}`);

// 3. Maple Park hole 2: approach putts that used to stop under the basket (0.1-0.5 m from the pole) now count straight away
await g(() => window.__game.loadHole(1));
const under = await g(() => { const gm = window.__game, B = gm.basket, bad = [], made = []; gm.placeDisc(B.x, B.z + 12);
  for (let pw = 0.1; pw <= 0.6; pw += 0.01) for (const dy of [-0.1, -0.05, 0, 0.05, 0.1]) { const s = gm.simulate({ power: pw, disc: 'putter', curve: 0, yaw: gm.yawToBasket() + dy });
    const d = Math.hypot(s.end.x - B.x, s.end.z - B.z); if (s.outcome === 'made') made.push(pw); else if (d < 0.49) bad.push(`${pw.toFixed(2)}/${dy}: ${d.toFixed(2)} m`); }
  return { bad, made: made.length }; });
const real = await g(() => { const gm = window.__game, B = gm.basket; gm.placeDisc(B.x, B.z + 12); gm.selectDisc('putter'); gm.setCurve(0); gm.setAim(gm.yawToBasket() + 0.05); gm.throwWith(0.36, 0);
  const t0 = performance.now(); let n = 0; while (gm.state().phase === 'flying' && n++ < 60 * 20) gm.fastForward(); const s = gm.state(); return { phase: s.phase, made: s.result?.made, throws: s.throws }; });
check('disc_under_basket_counts', under.bad.length === 0 && real.phase === 'holed' && real.made,
  `putts from 12 m resting under the basket uncounted: ${under.bad.length ? under.bad.join(', ') : 'none'} (${under.made} sweep throws made); real throw that used to stop 0.08 m from the pole: ${real.phase}, made ${real.made}`);
// 3b. Basket catch only counts a disc that's in the basket or has come to rest under it - not one rolling or flying through
await g(() => window.__game.loadHole(1));
const bk = await g(() => { const gm = window.__game, B = gm.basket, out = {};
  // fire a flat test disc from (x, z) toward a point beside the pole, at a set height and speed; returns outcome and where it stopped
  const shot = (fx, fz, side, height, speed, vy) => { gm.placeDisc(fx, fz); const yaw = Math.atan2(B.x + side - fx, -(B.z - fz));
    const s = gm.simulate({ disc: 'putter', power: 0.3, curve: 0, yaw, test: { height, speed, vy, bank: 0 } }); return { outcome: s.outcome, d: +Math.hypot(s.end.x - B.x, s.end.z - B.z).toFixed(2) }; };
  out.rollPast = shot(B.x, B.z + 3, 0.2, 0.12, 8);  // skids along the grass under the cage, 0.2 m off the pole, and out the far side (used to count)
  out.flyThrough = shot(B.x, B.z + 1, 0.35, 0.45, 4); // slow and low: under the tray in the air, lands and skids out past it (used to count)
  out.flyFast = shot(B.x, B.z + 4, 0.25, 0.3, 20, 0.6);    // low and fast under the tray
  out.leaning = shot(B.x + 0.64, B.z, 0, 0.12, 0.01);  // at rest against the outside of the cage (centre 0.64 m from the pole, rim 0.55)
  out.restUnder = shot(B.x + 0.2, B.z + 0.1, 0, 0.12, 0.01); // came to rest right under the tray: visibly in, counts
  // a normal putt from 5 m that drops into the tray (first power in a sweep that holes out)
  gm.placeDisc(B.x, B.z + 5); let putt = null;
  for (let pw = 0.05; pw <= 0.5 && !putt; pw += 0.01) { const s = gm.simulate({ power: pw, disc: 'putter', curve: 0, yaw: gm.yawToBasket() }); if (s.outcome === 'made') putt = { pw: +pw.toFixed(2), outcome: s.outcome }; }
  out.putt = putt; return out; });
check('basket_roll_past_not_counted', bk.rollPast.outcome !== 'made' && bk.rollPast.d > 0.49, JSON.stringify(bk.rollPast));
check('basket_low_fly_through_not_counted', bk.flyThrough.outcome !== 'made' && bk.flyThrough.d > 0.49 && bk.flyFast.outcome !== 'made', `slow: ${JSON.stringify(bk.flyThrough)}; fast: ${JSON.stringify(bk.flyFast)}`);
check('basket_leaning_on_cage_not_counted', bk.leaning.outcome !== 'made', JSON.stringify(bk.leaning));
check('basket_putt_in_tray_counts', bk.putt?.outcome === 'made' && bk.restUnder.outcome === 'made', `putt from 5 m: ${JSON.stringify(bk.putt)}; disc at rest under the tray: ${JSON.stringify(bk.restUnder)}`);

// 5. Boulders are solid: Volcano Twin Flows rock at (12, -20) stops low throws aimed through it
await open('volcano'); await g(() => window.__game.loadHole(5));
const rock = await g(() => { const gm = window.__game, R = gm.obstacles().solids.find(o => o.kind === 'rock'); if (!R) return null; gm.setWind(0, 0); const hits = [];
  for (const d of [2, 2.5, 3, 3.5, 4, 5, 6]) for (const pw of [0, 0.03, 0.06, 0.1, 0.15]) { gm.placeDisc(R.x, R.z + d); const yaw = gm.yawToBasket(); gm.aimAt(R.x, R.z);
    const s = gm.simulate({ power: pw, disc: 'driver', curve: 0, yaw: Math.atan2(0, d) }); const past = R.z - s.end.z; if (s.trees > 0) hits.push({ d, pw, past: +past.toFixed(2) }); }
  return { R, hits }; });
check('boulders_are_solid', rock && rock.hits.length >= 3 && rock.hits.every(h => h.past < 2.5),
  rock ? `rock r ${rock.R.r.toFixed(2)} m h ${rock.R.h.toFixed(2)} m; ${rock.hits.length} low throws hit it, all knocked down at the rock (max ${Math.max(...rock.hits.map(h => h.past)).toFixed(2)} m past centre)` : 'no rock solid');

// 6. Crater Rim: no lava on the raised rim; ponds still lava
await g(() => window.__game.loadHole(6));
const rim = await g(() => { const gm = window.__game, wet = []; let n = 0;
  for (let r = 6; r <= 12.5; r += 0.5) for (let a = 0; a < 360; a += 5) { const x = 3 + r * Math.cos(a * Math.PI / 180), z = -62 + r * Math.sin(a * Math.PI / 180); n++; if (gm.groundY(x, z) > 0.2 && gm.isWater(x, z)) wet.push(`${x.toFixed(1)},${z.toFixed(1)}`); }
  return { n, wet, ponds: [[3, -81.5], [-14.5, -64], [20.5, -64]].map(([x, z]) => gm.isWater(x, z)) }; });
check('crater_rim_dry', rim.wet.length === 0 && rim.ponds.every(Boolean), `${rim.n} rim points checked, lava on raised ground: ${rim.wet.length}; pond centres still lava: ${rim.ponds.join(',')}`);

// nits
await open('park'); await g(() => window.__game.loadHole(0)); await holeOut();
const before = await g(() => ({ r: window.__game.round(), e: window.__game.state().events.length }));
await g(() => window.__game.showPicker(true)); await page.keyboard.press('Escape'); await frames(2);
const after = await g(() => ({ r: window.__game.round(), s: window.__game.state() }));
check('picker_close_no_rescore', after.s.phase === 'holed' && !after.s.pickerOpen && after.r.played === before.r.played && after.r.strokes === before.r.strokes && /In the basket/.test(after.s.banner || ''),
  `phase ${after.s.phase}, played ${before.r.played}→${after.r.played}, banner "${after.s.banner}"`);
await g(() => window.__game.loadHole(0)); await page.keyboard.press('2'); await frames(1);
const pick = await g(() => { const gm = window.__game, b = gm.basket; gm.placeDisc(b.x, b.z + 8); const a = gm.state().disc; gm.loadHole(1); return { kept: a, newHole: gm.state().disc, sugg: gm.state().suggested }; });
check('disc_pick_sticks', pick.kept === 'mid' && pick.newHole === pick.sugg, `picked Mid, next lie 8 m out: ${pick.kept}; new hole back to suggestion: ${pick.newHole}`);
const qe = []; for (const k of ['q', 'q', 'e', 'w', 'e', 'e', 'e', 'e']) { await page.keyboard.press(k); qe.push((await g(() => window.__game.state().curveLevel))); }
check('curve_keys_match_buttons', qe.join() === '-1,-2,1,0,1,2,3,3', `Q Q E W E E E E → levels ${qe.join(' ')}`);
// aim preview: the landing ring is gone, so nothing re-flies while idle or while pulling (straight shot)
await g(() => window.__game.loadHole(0)); await frames(5);
const s0 = (await g(() => window.__game.mem())).previewSims; await frames(30); const s1 = (await g(() => window.__game.mem())).previewSims;
const b = await page.locator('#app canvas').boundingBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
await page.mouse.move(cx, cy - 100); await page.mouse.down(); const t0 = Date.now(); let fr = 0;
for (let i = 0; i < 60; i++) { await page.mouse.move(cx, cy - 100 + i * 4); await frames(1); fr++; }
const s2 = (await g(() => window.__game.mem())).previewSims, ms = Date.now() - t0; const rings = await g(() => window.__game.sceneRings()); const live = await g(() => window.__game.state());
await page.mouse.move(cx, cy - 100); await page.mouse.up();
check('no_preview_flights_no_ring', s1 === s0 && s2 === s1 && live.phase === 'charging' && live.ring == null && rings === 0,
  `idle 30 frames: ${s1 - s0} re-flights; pulling ${fr} frames over ${ms} ms: ${s2 - s1} re-flights (no landing ring any more: state.ring ${live.ring ?? 'none'}, ring meshes ${rings})`);
// 4. Maple hole 1: after a landing the aim camera can need to get to the other side of the disc (it rolled past the basket).
// It used to glide straight over the disc, briefly filling the screen with grass; now it swings around the lie.
await open('maple'); await g(() => window.__game.loadHole(0)); await frames(5);
const swing = await g(async () => { const gm = window.__game, B = gm.basket; const fr = () => new Promise(r => requestAnimationFrame(r));
  gm.placeDisc(B.x + 3, B.z + 14.5); gm.setAim(gm.yawToBasket() + Math.PI); await fr(); await fr(); // camera settled looking away from the basket
  for (let i = 0; i < 30; i++) await fr();
  gm.aimAtBasket(); let minDisc = 99, minLook = 99, minClear = 99; const L = gm.state().lie;
  for (let i = 0; i < 120; i++) { await fr(); const c = gm.camInfo(); minDisc = Math.min(minDisc, Math.hypot(c.x - L.x, c.y - L.y, c.z - L.z));
    minLook = Math.min(minLook, Math.hypot(c.look.x - c.x, c.look.y - c.y, c.look.z - c.z)); minClear = Math.min(minClear, c.y - c.ground); }
  return { minDisc: +minDisc.toFixed(2), minLook: +minLook.toFixed(2), minClear: +minClear.toFixed(2) }; });
check('aim_camera_swings_around_disc', swing.minDisc >= 2.5 && swing.minLook >= 2.5 && swing.minClear >= 1.5,
  `turning the aim camera to the far side of the disc: closest to the disc ${swing.minDisc} m, look point never nearer than ${swing.minLook} m, lowest ${swing.minClear} m above the grass`);
// 7. Pull-to-power: the default feel is unchanged; ?pull=2 (test link) is gentler - short pulls go a bit farther, long ones less far, full pull still full
const pullAt = async (extra) => { await page.goto(url0 + (url0.includes('?') ? '&' : '?') + 'course=park&seed=2026' + extra); await page.waitForFunction(() => window.__game, null, { timeout: 30000 }); await page.waitForTimeout(600);
  const box = await page.locator('#app canvas').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height * 0.4, out = {};
  for (const px of [60, 100, 200, 400]) { await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx, cy + px / 2); await page.mouse.move(cx, cy + px); await frames(2);
    out[px] = +(await g(() => window.__game.state().pull?.power ?? -1)).toFixed(3); await page.mouse.move(cx, cy); await page.mouse.up(); await frames(2); }
  const m = await g(() => window.__game.pullMetrics()); return { out, m }; };
const pv1 = await pullAt(''), pv2 = await pullAt('&pull=2');
const want = (px, m, maxFrac, ease) => { const short = maxFrac === 0.38 ? m.max / 0.38 : m.max / 0.42; const max = short * maxFrac; return Math.min(1, Math.max(0, (px - m.dead) / (max - m.dead))) ** ease; };
const v1ok = [60, 100, 200, 400].every(px => Math.abs(pv1.out[px] - want(px, pv1.m, 0.38, 1.5)) < 0.01);
const v2ok = [60, 100, 200, 400].every(px => Math.abs(pv2.out[px] - want(px, pv2.m, 0.42, 1.2)) < 0.01);
check('pull_default_unchanged_and_pull2_gentler', v1ok && v2ok && pv2.out[60] > pv1.out[60] && pv2.out[100] > pv1.out[100] && pv2.out[200] < pv1.out[200] && pv1.out[400] === 1 && pv2.out[400] === 1,
  `power at 60/100/200/400 px pull: default ${Object.values(pv1.out).join('/')} (full at ${Math.round(pv1.m.max)} px), ?pull=2 ${Object.values(pv2.out).join('/')} (full at ${Math.round(pv2.m.max)} px)`);
check('no_console_errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
const ok = Object.values(results).every(r => r.ok);
console.log(JSON.stringify({ ok, results }, null, 2)); await browser.close(); process.exit(ok ? 0 : 1);
