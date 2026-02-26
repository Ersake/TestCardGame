# AGENTS.md — TestCardGame

This file is the authoritative guide for AI coding agents working on this project. Read it in full before making any changes.

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

The project has a working **core gameplay loop**. Three scenes are registered:

| Scene | File | Purpose |
|---|---|---|
| `Start` | `src/scenes/Start.js` | Title screen — launches `Game` |
| `Game` | `src/scenes/Game.js` | Main gameplay: 4×4 enemy grid, card hand, turn loop |
| `GameOver` | `src/scenes/GameOver.js` | Shown at 0 HP — restart or return to menu |

### Systems

| Module | File | Responsibility |
|---|---|---|
| `CardData` | `src/data/CardData.js` | Card definitions + starter deck factory |
| `Deck` | `src/systems/Deck.js` | Draw pile, discard pile, shuffle |
| `EnemyManager` | `src/systems/EnemyManager.js` | 4×4 grid state, spawning, melee advance, attack resolution |
| `Combat` | `src/systems/Combat.js` | Card-play resolution and validation |

### Cards (current set)

| Name | Targeting | Type | Value |
|---|---|---|---|
| Strike | `single-melee` | damage | 6 — front row only |
| Shoot | `single-ranged` | damage | 4 — rows 2–4 only |
| Blast | `aoe` | damage | 2 — all enemies |
| Defend | `self` | block | +5 block |

### Turn structure

1. Player draws 5 cards
2. Player plays any cards (click card → click target if needed)
3. Player clicks **End Turn**
4. Melee enemies advance one row toward the player
5. All attackers deal damage (block absorbs first; block resets each turn)
6. 0–4 new enemies spawn in the back row
7. Repeat from step 1

### Art

All visuals are **placeholder rectangles and text** — no sprite assets are used by the game scenes yet. The original `assets/` folder contents (`space.png`, `phaser.png`, `spaceship.png`) are unused and can be removed when real art is added.

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

## Out of Scope (for now)

- TypeScript
- React, Vue, or any UI framework wrappers
- Server-side code or networking
- npm / node_modules
- Any bundler or transpiler
