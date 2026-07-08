# ⚽ Robel's World Cup Striker

A quick, casual **World Cup penalty shootout** you can pick up in seconds. Built for
mobile — flick the screen to shoot, beat the keeper, win the cup.

## Play

Serve the folder with any static server and open it on your phone (or desktop):

```bash
npx serve .        # or: python3 -m http.server 8000
```

Then open `http://localhost:8000`. No build step, no dependencies to install —
Three.js is vendored in `lib/`.

## How to play

1. **Pick your nation** — 12 teams to choose from.
2. **Pick your game** — solo Striker, solo Goalkeeper, or one of the
   two-player duels.

**As the striker**, swipe up to shoot. Where you flick is where it goes:
- flick **left/right** to pick a corner
- flick **higher** for a higher shot (too high = over the bar)
- flick **fast** for power — hard shots arrive before the keeper is fully stretched
- **curl your swipe** to bend the ball around the keeper

**As the goalkeeper**, guard the net while the rival striker runs up. Watch
for the golden flash showing where the shot is headed, then **swipe toward
it to dive** (swipe higher to reach high balls) — or **tap** to stand your
ground for a shot down the middle. React fast: dive early and you're at
full stretch when the ball arrives.

**2P Pass & Play (one screen)** — the defending player secretly picks a
dive zone, hands the phone over, and the shooter takes the kick. Pure
penalty mind games, alternating every kick.

**2P Split Screen (live duel)** — both players on the screen at once:
the shooter flicks in the bottom zone while the keeper watches the swipe
and dives from the top zone in real time.

Best-of-5 shootout, sudden death if level. Solo modes run a three-match
cup — win the **Quarterfinal**, **Semifinal**, and the **World Cup Final**
to lift the trophy, with opponents shooting harder and keepers reading you
better every round. Two-player duels are single matches with instant
rematches.

## Tech notes

- **Three.js (r160)** WebGL scene: night stadium bowl with a procedural crowd,
  striped pitch with painted box lines, goal + net, low-poly diving keeper,
  spinning panel ball with a team-colored shot trail, confetti bursts.
- **Tuned for mobile GPUs** (runs at 60fps on Pixel-class hardware): pixel
  ratio capped at 2, no shadow maps (cheap blob shadows), low-poly meshes,
  canvas-generated textures, a single directional + hemisphere light.
- **Zero assets**: all textures are drawn to canvas at boot, all sound effects
  (crowd, whistle, kick, post clang, cheers) are synthesized with WebAudio.
- Haptic feedback via the Vibration API where available.
- Ball flight is real projectile physics plus a Magnus term for swipe curl;
  the keeper's save check is an analytic capsule test at the moment the ball
  crosses the goal line.

## Files

| File | What it is |
|---|---|
| `index.html` | UI shell: title/team select, HUD scoreboard, banners, end screens |
| `game.js` | Scene, physics, keeper AI, audio, tournament state machine |
| `lib/three.min.js` | Vendored Three.js r160 |
