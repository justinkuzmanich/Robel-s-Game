# 📓 Robel's World Cup Striker — Development Log

A running record of how this game came together, feature by feature.

**Play it live:** https://justinkuzmanich.github.io/Robel-s-Game/

---

## 1. The game is born — swipe-to-shoot penalty shootout (`2735e50`)

**The brief:** a World Cup soccer game that's easy to play on mobile, quick to
pick up, fun in short sessions, with 3D effects that look cool and run well on
Pixel-class (Google Tensor) phones.

**What was built:**
- A penalty-shootout game in **Three.js (r160, vendored — no build step)**:
  pick one of 12 nations, then win the Quarterfinal, Semifinal, and World Cup
  Final, each a best-of-5 shootout with sudden death.
- **One-gesture controls:** flick up to shoot — direction picks the corner,
  flick height sets shot height, flick speed sets power (hard shots arrive
  before the keeper is fully stretched), and a curved swipe bends the ball
  around the keeper. A live reticle shows your aim while dragging.
- **3D night-stadium scene:** procedural crowd bowl, striped pitch with painted
  box lines, goal with net, low-poly diving keeper with real dive animation,
  spinning panel ball with a team-colored light trail, confetti bursts, camera
  push-in and shake.
- **Real ball physics** (projectile flight plus a Magnus curve term) and an
  analytic save check: the keeper's dive is modeled as a capsule and tested
  against the ball at the exact moment it crosses the goal line.
- **Zero asset files:** every texture is drawn to canvas at boot; every sound
  (crowd, whistle, kick thump, post clang) is synthesized with WebAudio.
  Haptics via the Vibration API.
- **Mobile-GPU performance budget:** pixel ratio capped at 2, no shadow maps
  (cheap blob shadows instead), low-poly meshes, one directional + hemisphere
  light.

**Testing found the first real design bug:** raw camera-raycast aiming made
almost every natural flick sail over the bar on a portrait screen. Aiming was
rebuilt as a forgiving flick-to-target mapping, and the keeper's reach was
tuned so well-placed corner shots beat him even when he guesses right.
Automated Playwright runs (headless Chromium at phone size) verified full
matches end-to-end.

## 2. Going live — GitHub Pages (`426fe43`, `e4cf6a1`)

- Added a GitHub Actions workflow that deploys the game to GitHub Pages on
  every push. First run failed because CI can't enable Pages itself; after a
  one-time flip of the Pages setting in the repo, every push auto-deploys in
  about 20 seconds.

## 3. A name (`07bc5be`)

- Retitled to **ROBEL'S WORLD CUP STRIKER** — three-line gold logo on the
  title screen, browser tab title, and README.

## 4. Crowd that sounds human (`6cc1429`)

- Goal cheers went from a filtered-noise whoosh to a **synthesized human
  roar**: ~18 overlapping sawtooth "voices" shaped by open-vowel formant
  filters, each with its own pitch contour, vibrato, and staggered onset, plus
  celebration whistles. Misses get a deflated "ohhh" from lower voices with
  sagging pitch. Everything routes through a master compressor so the layers
  never clip. Verified by rendering the cheer offline and checking the output.

## 5. Goalkeeper mode (`e785e96`)

- New role-select screen after picking a team: **Striker or Goalkeeper**.
- In keeper mode the camera flips behind your goal; an AI striker (in the
  opponent's colors) runs up and shoots with stage-scaled pace and placement.
  A golden flash telegraphs the target — your read-and-react window.
- Testing caught two real bugs: the "tap to kick off" touch leaked through and
  registered as a dive (wasting round 1 of every match), and the first camera
  position sat so close behind the keeper that you couldn't see the ball.

## 6. Multiplayer — built, then rolled back (`c1905c9`, `d46f7d5`)

- Built two local 2-player duels, each player picking their own nation:
  **Pass & Play** (keeper secretly picks a dive zone, hands the phone over)
  and **Split Screen** (shooter flicks in the bottom half while the keeper
  dives live from the top half — input rewritten for simultaneous touches).
- Both modes played full matches to their winners in automated tests. The
  project direction changed and the feature was reverted cleanly with
  `git revert`, so it's preserved in history (`c1905c9`) and can be restored
  any time.

## 7. Keeper controls, round two — direct positioning (`d6c3a26`)

- **Camera pulled back and up** so the whole goal frame is visible, with a
  wider lens in keeper mode.
- **Drag = the keeper mirrors your finger** along the goal line in real time;
  release with a sideways flick to dive from where you stand; flick straight
  up to leap for high balls; gentle release to stay planted.
- Save coverage got a vertical-jump profile (strong up high, beatable along
  the ground), and the reach bonus was trimmed since direct positioning is far
  more capable than blind swiping.
- One self-inflicted bug caught and fixed: a careless find-and-replace made
  the camera function call itself recursively, freezing mode select.

## 8. Cache-busting (`3cf0a8b`)

- A deployed update looked "missing" because GitHub Pages lets browsers cache
  files for 10 minutes. The page now loads `game.js?v=N`, bumped with each
  gameplay change, so fresh HTML always pulls matching fresh game code.

## 9. Keeper controls, round three — lean and spring (`5603972`)

- **Camera moved in tight behind the net** (~65% of the goal in frame during
  the buildup) and now **pans with the keeper and pulls back the moment the
  shot or dive happens** so the whole goal is in view for the save.
- **New control feel:** holding the screen *leans* the keeper's body toward
  your finger like a real keeper shifting weight; releasing springs into the
  dive on the leaned side (higher finger = higher dive); pushing up with no
  lean jumps straight up; a plain tap stands tall.

## 10. The net saga (`9c831e8`, `d2bf46d`, `afbad5a`)

The close keeper camera exposed a chain of net problems the distant cameras
had been hiding:

1. **Gap under the crossbar** — the roof net panel had been tilted the wrong
   way since day one, with its high edge at the *back* of the goal. Fixed by
   sizing and angling it to sit exactly on the bar… but the gap persisted.
2. **The 90° box net** (user suggestion — the right call): flat roof at
   crossbar height running straight back, vertical back wall, rectangular
   sides — every edge meets flush, plus matching vertical back posts and top
   rails on the frame.
3. **The top still looked open.** Debugging with a solid-red test material
   proved the roof panel *was* rendering — but its thin net lines were being
   mipmap-filtered into invisibility at the keeper camera's grazing angle.
   Fixed with **max anisotropic filtering** on the net textures, bolder mesh
   lines, and a back top rail so the roof's rear edge reads as structure.

---

## Where things stand

**Current modes:** solo Striker and solo Goalkeeper, each a three-stage World
Cup run (best-of-5 shootouts, sudden death, difficulty ramping each round).

**How it's tested:** headless Chromium at phone size drives real matches —
swiping to shoot, lean-diving as keeper, reading the target flash like a
player would — plus offline audio rendering and geometry probes. Every feature
above shipped only after a full-match run with zero console errors.

**How it ships:** every push to `claude/mobile-world-cup-game-cbw2a9` (the
default branch) auto-deploys to GitHub Pages via Actions.

**Parked, available to restore:** the 2-player Pass & Play and Split Screen
modes (commit `c1905c9`).

**Ideas discussed but not yet built:** streak/score systems, PWA home-screen
install, difficulty tuning knobs (shot pace, flash duration, glove reach).
