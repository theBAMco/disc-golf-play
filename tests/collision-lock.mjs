// Collision lock: the same seeded throws on every hole of all 5 courses must land in exactly the same spots (outcome, end point, tree/bank hits)
// as the recorded baseline, so visual detail never changes play. Usage: node tests/collision-lock.mjs <url> [--record]
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const url0 = process.argv[2] || 'https://thebamco.github.io/disc-golf-play/', record = process.argv.includes('--record');
const basePath = new URL('./collision-baseline.json', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
const out = {};
for (const course of ['park', 'river', 'antarctica', 'volcano', 'moon']) {
  await page.goto(url0 + (url0.includes('?') ? '&' : '?') + `course=${course}&seed=2026&wind=calm`); await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
  out[course] = await page.evaluate(() => { const gm = window.__game, res = []; let seed = 99; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let h = 0; h < 9; h++) { gm.loadHole(h); const base = gm.yawToBasket();
      for (let k = 0; k < 14; k++) { const o = { power: 0.35 + r() * 0.65, disc: ['driver', 'mid', 'putter'][Math.floor(r() * 3)], curve: [-1, -0.5, 0, 0.5, 1][Math.floor(r() * 5)], yaw: base + (r() - 0.5) * 0.9, tomahawk: false };
        const s = gm.simulate(o); res.push([h + 1, s.outcome, +s.end.x.toFixed(3), +s.end.z.toFixed(3), s.trees || 0, s.banks || 0, !!s.bounced]); } }
    return res; });
}
let ok, detail;
if (record || !existsSync(basePath)) { writeFileSync(basePath, JSON.stringify(out)); ok = true; detail = `recorded ${Object.values(out).flat().length} throws`; }
else { const base = JSON.parse(readFileSync(basePath, 'utf8')); const diffs = [];
  for (const c of Object.keys(base)) base[c].forEach((b, i) => { if (JSON.stringify(b) !== JSON.stringify(out[c][i])) diffs.push(`${c} #${i}: ${JSON.stringify(b)} → ${JSON.stringify(out[c][i])}`); });
  ok = diffs.length === 0; detail = ok ? `${Object.values(base).flat().length} seeded throws identical (5 courses x 9 holes x 14)` : diffs.slice(0, 6).join(' | '); }
const results = { throws_land_identically: { ok, detail }, no_errors: { ok: errors.length === 0, detail: errors.slice(0, 2).join(' | ') || 'none' } };
const all = Object.values(results).every(r => r.ok);
console.log(JSON.stringify({ ok: all, results }, null, 2)); await browser.close(); process.exit(all ? 0 : 1);
