# Disc Golf tests

Browser tests that drive the real game in headless Chrome.

- `bugfix.mjs`: regression tests for fixed bugs (basket catch, camera, scores, geometry, keys).
- `course.mjs`: plays every hole of a course with the game's own physics and checks the scorecard and the end screen.
- `realplay.mjs`: plays rounds through the real controls (mouse, keyboard and touch).
- `collision-lock.mjs`: 630 seeded throws (5 courses x 9 holes x 14) must land exactly as recorded in `collision-baseline.json`, so scenery changes never change play.
- `story.mjs`: the Antarctica story props, incl. the hole 4 paw-print trail laid on the snow.

```
cd tests && npm install
node bugfix.mjs                                  # against the live game: https://thebamco.github.io/disc-golf-play/
node course.mjs https://thebamco.github.io/disc-golf-play/ - river   # one course: park | river | antarctica | volcano | moon
node realplay.mjs
node collision-lock.mjs
node story.mjs
```

Set `CHROME_PATH` if Chrome is not at `/usr/bin/google-chrome`. Each test prints JSON results and exits 1 if a check fails.
