# Возачки испит — Град

A browser game that simulates a practical city-driving exam in North Macedonia. You drive an automatic car through a small minimalist city. The examiner gives instructions in Macedonian, shows them on screen and speaks them through the browser's speech engine (only if an `mk-MK` voice is installed).

The game has no build step, no backend and no dependencies. Open `index.html` through any static web server.

## Features
- Top-down 2.5D city with traffic lights, a roundabout, priority junctions with STOP/yield signs, zebra crossings, a 4-lane avenue, parking bays and a parked delivery van.
- Simulated traffic: cars follow lanes, keep their distance, stop at red lights, yield at priority junctions and roundabouts, and stop for pedestrians. Pedestrians walk the sidewalks and use crosswalks, obeying pedestrian signals.
- Three modes:
  - **Full exam:** a long route through the city with every task.
  - **Practice:** free driving with random instructions.
  - **Scenarios:** 11 separate scenarios (straight driving, left turn, right turn, traffic lights, pedestrian crossing, priority junction, roundabout, lane change, passing an obstacle, parallel parking, pulling over and moving off).
- Continuous evaluation and a results screen showing pass/fail (ПОЛОЖИВТЕ / НЕ ПОЛОЖИВТЕ). It checks: speed, red and yellow lights, the STOP sign, priority, pedestrians, indicators, mirror checks, lane position, following distance, collisions, curbs, and the accuracy of parking and pulling over.
- Scoring is configurable in `js/config.js` (`CFG.SCORING`). It is a simulation and does **not** reproduce the official exam procedure.

## Controls
W/↑ accelerate · S/↓ brake (hold at standstill to reverse) · A/D steer · Space brake · Z/X indicators · Q mirror check · R repeat instruction · P/Esc pause. On mobile, on-screen buttons appear.

## Code layout
`js/config.js` (constants, text) · `util.js` · `world.js` (road graph, lanes, lights) · `player.js` (physics) · `traffic.js` (AI vehicles) · `peds.js` · `render.js` (canvas) · `audio.js` (Web Audio + speech) · `scenarios.js` · `exam.js` (rules, tasks, scoring) · `ui.js` · `main.js` (loop).
