# AGENTS.md — TestCardGame

This file is the authoritative guide for AI coding agents working on this project. Read it in full before making any changes.

## Context Discipline & Subagent Policy


Subagents are the 
**primary mechanism**
 for complex work. Use them by default for:
- Multi-file changes (≥3 files) or cross-surface edits (frontend + worker + data)
- Research-heavy tasks (audits, schema analysis, migration planning)
- Any step that might consume >20% of context budget
Keep the main chat as an orchestration layer and spin up sub agents as needed.

---

## Project Overview

- **Game title**: TestCardGame
- **Engine**: Phaser 3.88.2 (local, bundled as `phaser.js`)
- **Resolution**: 1280 × 720
- **Renderer**: `Phaser.AUTO` (WebGL with Canvas fallback)
- **Scaling**: `Phaser.Scale.FIT` + `CENTER_BOTH`
- No build tooling — vanilla HTML + ES modules served directly in the browser

---

## Documentation

When implementing or troubleshooting any Phaser-specific feature (scenes, tweens, physics, cameras, input, tilemaps, etc.), consult the official Phaser documentation:

**https://docs.phaser.io/**

---

## Tech Stack & Constraints

| Layer | Technology |
|---|---|
| Language | Vanilla JavaScript (ES modules) |
| Engine | Phaser 3 (`phaser.js` — local file, no CDN) |
| Entry point | `index.html` → `src/main.js` |
| Module loading | Native browser ES modules (`type="module"`) |
| Tooling | None — no bundler, no npm, no TypeScript |

**Do NOT introduce** a bundler (Webpack, Vite, Rollup, etc.), `package.json`, or any build step without explicit user approval.

---

## File & Folder Conventions

```
index.html          # HTML shell — do not restructure
phaser.js           # Phaser 3 engine — do not rename or move
project.config      # Phaser editor config — do not edit manually
assets/             # All game assets (images, audio, spritesheets, etc.)
src/
  main.js           # Phaser game config + scene registry
  scenes/
    <SceneName>.js  # One file per scene, PascalCase filename
  systems/          # Deterministic simulation + rollback
  network/          # NetworkManager (Socket.io wrapper)
  data/             # Card definitions, static config
server/
  index.js          # Node.js relay server (Socket.io)
  package.json      # Server dependencies
```

### Scene rules

- Each scene lives in `src/scenes/<SceneName>.js`
- Export the class as a named export: `export class SceneName extends Phaser.Scene`
- The Phaser scene `key` must match the class name exactly: `super('SceneName')`
- After creating a scene file, import it in `src/main.js` and append it to the `scene` array in the game config

### Asset rules

- All assets go in `assets/`
- Load assets in the scene's `preload()` method using a descriptive string key
- Do not inline large base64-encoded assets in JS or HTML

---

## Current State

The project is a **real-time card fighter** with rollback netcode multiplayer (Phase 3 of ROADMAP.md). Four scenes are registered:

| Scene | File | Purpose |
|---|---|---|
| `Start` | `src/scenes/Start.js` | Title screen — Solo Play or Multiplayer |
| `Lobby` | `src/scenes/Lobby.js` | Room create/join, ready handshake, launches Game with network config |
| `Game` | `src/scenes/Game.js` | Real-time gameplay: solo or online (rollback netcode), 4×8 grid, WASD + hotkeys |
| `GameOver` | `src/scenes/GameOver.js` | Shown at 0 HP — restart or return to menu |

### Systems

| Module | File | Responsibility |
|---|---|---|
| `CardData` | `src/data/CardData.js` | Card definitions (with projectile templates) + starter deck factory |
| `RNG` | `src/systems/RNG.js` | Seeded PRNG (mulberry32) — all simulation randomness goes here |
| `Deck` | `src/systems/Deck.js` | Draw/discard pile using seeded RNG; stores card IDs; snapshotable |
| `EnemyManager` | `src/systems/EnemyManager.js` | 4×8 grid, tick-based enemy AI, projectile spawn requests; snapshotable |
| `Combat` | `src/systems/Combat.js` | Active projectile list, per-tick movement + hit detection; snapshotable |
| `GameState` | `src/systems/GameState.js` | Master simulation state — orchestrates all systems per tick; snapshotable |
| `InputBuffer` | `src/systems/InputBuffer.js` | Decouples keyboard events from simulation tick consumption |
| `RollbackManager` | `src/systems/RollbackManager.js` | Rollback netcode engine: input delay, prediction, snapshot/restore, replay |

### Networking

| Module | File | Responsibility |
|---|---|---|
| `NetworkManager` | `src/network/NetworkManager.js` | Socket.io client wrapper — only file that touches networking |
| Relay server | `server/index.js` | Thin Node.js relay: rooms, input forwarding, clock sync (no game logic) |

**Multiplayer architecture**: Rollback netcode, 2-frame input delay, 15-frame max rollback, Socket.io WebSocket transport, thin relay server (no authoritative simulation). Both clients run identical deterministic simulations with seeded PRNG.

### Arena

- **4 columns × 8 rows** shared grid with pseudo-3D perspective
- **Rows 0–3**: P2 / enemy territory (top of screen, small/far)
- **Rows 4–7**: P1 territory (bottom of screen, large/near)
- Enemies spawn in row 0 and advance toward row 7; reaching row 7 deals gate damage
- P1 starts at row 6, col 1; P2 starts at row 1, col 2 — each confined to their half
- Both players move with WASD

### Cards (current set)

| Name | Type | Projectiles | Cooldown |
|---|---|---|---|
| Strike | damage | 1× straight, 6 dmg, range 3 (short) | 90 ticks |
| Shoot | damage | 1× straight, 4 dmg, range 8 (full grid) | 75 ticks |
| Blast | damage | 3× spread (left/straight/right), 2 dmg each | 120 ticks |
| Defend | block | none — grants +5 block instantly | 60 ticks |

Cards are cast with hotkeys **1–5**. Each slot auto-refills from the deck after its cooldown expires.

### Simulation structure

- **Fixed timestep**: 60 Hz (`TICK_MS ≈ 16.667ms`). `update()` accumulates `delta` and calls `simTick()` in 16.667ms steps.
- **Alpha interpolation**: leftover accumulator fraction is passed to the render functions for smooth sub-tick motion.
- **Deterministic**: all randomness goes through the seeded `RNG` instance. Same seed + same inputs = identical outcome.
- **Snapshotable**: every system implements `toSnapshot()` / `fromSnapshot()` — used by RollbackManager for rollback/replay.
- **Rollback netcode**: in online mode, RollbackManager wraps the simulation. Local inputs are delayed by 2 frames; remote inputs predicted (last-input repeat). On misprediction, state rewinds to snapshot and replays forward.

### Art

All visuals are **placeholder rectangles and text**. The original `assets/` folder contents are unused.

---

## Agent Rules

1. **Do not rename or move `phaser.js`** — it is referenced directly by `index.html`
2. **Preserve `<div id="game-container">`** in `index.html` — it is the Phaser mount point
3. **Keep `pixelArt: false`** in the game config unless explicitly told otherwise
4. **Keep `Phaser.AUTO`** as the renderer
5. **Register new scenes** in `src/main.js` after creating them
6. **Consult https://docs.phaser.io/** before guessing at API signatures or behaviour
7. **Do not add a build step** or change the module loading strategy without approval

---

## Adding a New Scene

1. Create `src/scenes/<SceneName>.js`:
   ```js
   export class SceneName extends Phaser.Scene {
     constructor() {
       super('SceneName');
     }

     preload() {}
     create() {}
     update() {}
   }
   ```
2. Import it in `src/main.js`:
   ```js
   import { SceneName } from './scenes/SceneName.js';
   ```
3. Add it to the `scene` array in the Phaser game config in `src/main.js`:
   ```js
   scene: [Start, SceneName]
   ```

---

## Verification

This project requires **no build step**. To verify changes:

1. Serve the project root via a local static HTTP server:
   - VS Code **Live Server** extension (recommended), or
   - `python -m http.server 8080` in the project root
2. Open `http://localhost:8080` (or the Live Server URL) in a browser
3. Check the **browser console** for errors
4. Confirm the expected scene renders correctly

---

## Hosting

### Client (static files)

The game client is hosted on **GitHub Pages** — the entire repo root is served as static files. No build step required.

### Relay server URL

The relay server URL is configured in **`index.html`** via a script tag:

```html
<script>window.RELAY_SERVER_URL = 'http://localhost:3000';</script>
```

Change this to your deployed server URL (e.g. `https://testcardgame-relay.onrender.com`) and push to GitHub Pages to enable internet play. The Lobby scene reads `window.RELAY_SERVER_URL` at runtime.

---

## Server

The relay server lives in `server/`:

```
server/
  index.js        # Node.js + Socket.io thin relay server
  package.json    # Dependencies (socket.io)
  render.yaml     # Render.com deployment blueprint
  node_modules/   # Installed packages (gitignored)
```

**Local**: `cd server && npm install && npm start` (listens on port 3000).

**Production**: deploy the `server/` directory to any Node.js host (Render, Railway, Fly.io, etc.). The server reads `PORT` from the environment variable.

The server does NOT run game logic. It manages rooms (4-char codes, max 2 players), relays input packets, handles the ready handshake, and provides clock sync.

---

## Out of Scope (for now)

- TypeScript
- React, Vue, or any UI framework wrappers
- Any bundler or transpiler
