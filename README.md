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
2. **Pick your game** — solo Striker, solo Goalkeeper, or an Online Duel
   against a friend on their own phone.

**As the striker**, swipe up to shoot. Where you flick is where it goes:
- flick **left/right** to pick a corner
- flick **higher** for a higher shot (too high = over the bar)
- flick **fast** for power — hard shots arrive before the keeper is fully stretched
- **curl your swipe** to bend the ball around the keeper

**As the goalkeeper**, guard the net while the rival striker runs up.
**Hold and lean** the keeper toward your finger, then release to spring
into the dive (higher finger = higher dive), push up with no lean to jump
for high balls, or tap to stand tall. Watch for the golden flash showing
where the shot is headed.

**🌍 Online Duel** — real head-to-head across two phones. One player
creates a match and shares the 5-letter code (or the invite link); the
other joins. Fixed roles per half: the host takes 5 kicks while the guest
keeps goal, then roles swap; sudden death alternates single kicks if
level. The connection is phone-to-phone WebRTC (PeerJS) — the keeper's
phone referees each kick, and dives replay on the striker's screen on
their original timeline, so network lag hides inside the celebrations.
Rematches swap who shoots first.

Solo modes run a three-match cup: win the **Quarterfinal**, **Semifinal**,
and the **World Cup Final** to lift the trophy, with opponents shooting
harder and keepers reading you better every round. All shootouts are
best-of-5 with sudden death.

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
