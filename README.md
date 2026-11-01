# IRON MERIDIAN — Global Command

A 3D geopolitical command game on a real-world globe. You are the Theater Commander: every battalion,
squadron, carrier group, cyber team and orbital platform answers to you — and you can deploy any of it
against any country or organization on Earth, from a quiet recon pass to declared all-out war.

Built in one night by **Stable Genius** (Claude Code) for Thomas Kanz.

## Play

**Windows:** double-click `play.bat`. It starts a tiny local server and opens the game in an Edge app window.

**Online (any device):** https://stablegenius-agent.github.io/iron-meridian/

**Anywhere else:** serve the folder with any static server and open it, e.g.

```sh
uv run --no-project python tools/serve.py   # → http://localhost:8777/
```

Add `?debug` to the URL for an FPS / draw-call readout.

## How it plays

- **Click a country** to open its dossier: military strength, air defense, intel, known targets, and every
  operation you can run there. Pick an operation, tick the assets, read the odds (success, loss risk,
  collateral, tension) and **EXECUTE**.
- **Or select a unit** in the FORCES panel, then click any country to task it.
- **Crises** pop up as timed cards at the bottom (terror plots, hostages, missile launches, piracy, cyber
  attacks, invasions of allies, disasters, rival fleet incursions). Click one to jump straight to the
  recommended operation. Resolve them fast for bonus points.
- **Command dilemmas** interrupt every few days: a rival submarine shadowing your carrier, leaked strike
  footage, a defector, a coup in an allied capital, a summit invitation. Every choice trades approval,
  tension, budget, intel or alliances.
- **Intel matters.** Enemy sites and terror cells are hidden until satellites, drones or cyber recon find
  them. Better intel means more accurate strikes and less collateral damage.
- **The escalation ladder:** Recon & Aid → Patrol & Cyber blinding → Strikes, Raids, Blockades, Grid
  attacks → Air Campaigns → Invasion → **Declare War** (commits every available asset at once).
- **Consequences:** tension rises with aggression (far more against rival powers, allies and neutrals).
  DEFCON 1 for 48 hours means global war. Collateral damage and losses cost approval; enemies retaliate
  with missiles that your destroyers, carriers and satellites try to intercept.

### Modes

- **Campaign** — 60 days, a budget, domestic approval, and a final rank from F to S plus commendations.
- **Unrestricted** — unlimited budget, faster rearm, extra assets, no failure. Every asset, every target.

### Your forces

F-35 squadrons, B-2 wings, MQ-9 Reaper flights, special-operations teams, airborne and armored battalions,
carrier strike groups, destroyer squadrons, attack submarines, cyber mission teams, recon satellite
constellations and an orbital kinetic strike platform — staged from real US bases around the world.

### Controls

| Key | Action |
|---|---|
| Mouse drag / wheel | Orbit / zoom the globe; double-click to zoom to a point |
| `Space` | Pause / resume |
| `1` `2` `3` | Normal / fast / fastest speed |
| Click a unit on the globe | Select it, then click a country to task it |
| `Tab` | Cycle through active crises |
| `T` | Threat board: every organization, known cell and hostile state |
| `P` | Procurement: spend budget on new squadrons, fleets, battalions, satellites |
| `F` | Focus the selected unit |
| `C` | Cinematic camera: ride along with your next operation |
| `H` | Field manual |
| `M` / `V` | Mute all audio / toggle voice callouts |
| `Esc` | Close panel / deselect / menu |

## Under the hood

- **three.js r170** (vendored, no build step). Country fills and borders are drawn into a 4096×2048
  equirectangular canvas; a nearest-filtered **ID texture** gives pixel-exact country picking and GPU
  hover/selection highlights. Night-side city lights, a scanning tactical grid, atmosphere and bloom.
- **Units** are low-poly models built procedurally in **Blender** (`tools/blender/build_models.py`,
  run headless) and exported as GLB; one recolorable `Hull` material per model gives friendly/hostile/rival
  liveries. Aircraft fly great-circle arcs, fleets sail along an **A\* sea-lane** pathfinder, satellites
  fly inclined orbits and reposition over targets.
- **Audio** is fully synthesized with WebAudio (sfx and ambient score); voice callouts use the OS speech
  engine.
- **Performance:** tuned for integrated GPUs at 4K — adaptive render resolution with an FPS governor,
  half-resolution bloom, pooled particle effects, ≤700-triangle models.
- **World data:** Natural Earth 1:50m countries and populated places (public domain), compacted by
  `tools/prep_geo.py`. Geopolitical alignments are **randomized every campaign**, and all non-state
  factions are fictional.

### Testing

`tools/playtest.mjs` drives a headless Edge over the DevTools protocol, runs a scenario, saves screenshots
to `tools/shots/` and fails on any page exception:

```sh
node tools/playtest.mjs tools/scenarios/smoke.mjs   # every operation type
node tools/playtest.mjs tools/scenarios/bot.mjs     # an autoplay bot runs a full 60-day campaign
```

## Credits

Code, models and audio: Stable Genius (Claude Code). Map data: Natural Earth. Engine: three.js.
