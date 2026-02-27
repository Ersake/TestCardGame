# ROADMAP.md — TestCardGame → Real-Time Card Fighter

This document is the living development plan for pivoting the project from a turn-based card game toward a real-time, grid-based card fighter inspired by *One Step From Eden* / *Duelists of Eden*.

**Planning philosophy:**
- Phase 1 is fully detailed — these are the immediate next steps.
- Phases 2–3 are fleshed out enough to inform design decisions without over-specifying things that don't exist yet.
- Phase 4+ lists goals and open questions only; it will be detailed when Phase 3 is complete.

**A note on the current codebase:**
The existing `Game` scene (turn loop, click-to-target, enemy phase) will be replaced. The following survive mostly intact:
- `src/data/CardData.js` — card definitions
- `src/systems/EnemyManager.js` — grid state (will be refactored, not deleted)
- `src/systems/Combat.js` — damage resolution (will be refactored)
- `src/scenes/Start.js`, `src/scenes/GameOver.js` — fine as-is

---

## Phase 1 — Simulation Foundation

**Goal:** Replace the turn-based `Game` scene with a real-time simulation loop that is deterministic and network-ready. No networking yet — just a single-player local prototype.

This phase is the most critical. Every subsequent phase depends on the decisions made here.

### 1.1 — Fixed-timestep update loop

- [ ] Replace Phaser's default variable-`delta` `update()` with a fixed-timestep accumulator pattern.
  - Target tick rate: **60 Hz** (16.667ms per tick).
  - The `update(time, delta)` method accumulates `delta`, then steps the simulation in fixed 16.667ms increments until the accumulator is drained.
  - Rendering interpolates between the previous and current simulation states using the leftover accumulator fraction.
- [ ] Define a clear separation between **simulation tick** (`simUpdate()`) and **render** (`renderUpdate()`).
  - `simUpdate()` receives no `delta` — it always advances by exactly one fixed tick.
  - `renderUpdate(alpha)` receives an interpolation factor `alpha ∈ [0,1]` for smooth rendering between ticks.
- [ ] Document the tick rate as a named constant (`TICK_RATE`, `TICK_MS`) at the top of the game config or a shared constants file.

### 1.2 — Seeded, replaceable RNG

- [ ] Remove all calls to `Math.random()` from simulation code (enemy spawn, enemy type, HP rolls).
- [ ] Implement a simple seedable pseudo-random number generator (e.g. mulberry32 or xoshiro128**) in `src/systems/RNG.js`.
- [ ] Thread a single `RNG` instance through all simulation systems that need randomness (`EnemyManager`, `Deck`).
- [ ] Ensure the same seed produces the same game — verify by running two instances with the same seed and comparing state snapshots.
- [ ] Rendering effects (particles, screen shake) may still use `Math.random()` — only simulation logic must use the seeded RNG.

### 1.3 — Serialisable game state

- [ ] Define a plain-object `GameState` structure in `src/systems/GameState.js`:
  ```js
  {
    tick:        number,
    phase:       string,
    players:     PlayerState[],   // array — supports 1–N players
    enemies:     EnemyState[][],  // grid[row][col] or null
    rngState:    object,          // serialised RNG state
    deckState:   object,          // draw + discard pile (card id arrays)
  }
  ```
- [ ] All simulation systems (`EnemyManager`, `Deck`, `Combat`) must be able to:
  - Export their current state to a plain object (`toSnapshot()`).
  - Restore from a plain object (`fromSnapshot(data)`).
- [ ] Write a round-trip test: snapshot → restore → snapshot, assert both snapshots are deeply equal.
- [ ] This snapshot capability is the foundation for rollback netcode later.

### 1.4 — Player entity (grid-based movement)

- [ ] Define a player grid (separate from the enemy grid) — e.g. a 3×3 or 4×4 arena where the player occupies one cell at a time.
- [ ] Player state: `{ id, row, col, hp, block, hand: cardId[], castCooldown }`.
- [ ] Movement input (WASD or arrow keys) queues a **move intent** — the simulation resolves it on the next tick (no direct position mutation from input handlers).
- [ ] Movement has a cooldown (e.g. cannot move more than once every N ticks) to prevent jitter.
- [ ] Collision with occupied cells (other player, solid obstacle) is rejected silently.
- [ ] Render the player as a coloured rectangle for now; art comes later.

### 1.5 — Input separation from simulation

- [ ] Create `src/systems/InputBuffer.js` — collects raw input events each frame and exposes a snapshot of inputs for the current tick.
  ```js
  // Each tick the simulation consumes:
  { move: 'up'|'down'|'left'|'right'|null, castSlot: 0-4|null }
  ```
- [ ] Input events write to the buffer; the simulation reads from it exactly once per tick then clears it.
- [ ] This is the interface that networking will later replace for the remote player — local input for player 1, received network input for player 2.

### 1.6 — Real-time card casting

- [ ] Remove the click-to-select-then-click-target flow.
- [ ] Cards are assigned to hotkeys (1–5 or Q/W/E/R/T).
- [ ] Pressing a hotkey **immediately casts** the card at the player's current position/direction — no confirmation step.
- [ ] Cards with area targeting (AOE) apply immediately. Cards with directional targeting fire in the player's facing direction.
- [ ] Introduce a **cast cooldown** per card slot (or a global cooldown) so the player cannot spam cast every tick.
- [ ] The card is discarded after use and the slot goes on cooldown; the hand refills automatically when cooldown expires or all slots are spent.

### 1.7 — Enemy AI in real-time

- [ ] Replace the discrete "enemy phase" with per-tick enemy logic that runs inside `simUpdate()`.
- [ ] Each enemy has an **action timer** (ticks until next action). When it reaches zero, the enemy acts (move or attack) and the timer resets.
- [ ] Melee enemies: move toward the player's cell every N ticks. Attack if adjacent.
- [ ] Ranged enemies: fire a projectile toward the player every N ticks regardless of distance.
- [ ] Enemy spawn is now time-based (every M ticks, attempt to spawn) rather than triggered by end-of-turn.

### 1.8 — Projectiles and hitboxes

- [ ] Define a `Projectile` type: `{ id, ownerType ('player'|'enemy'), row, col, direction, damage, speed (cells/tick) }`.
- [ ] The simulation maintains a `projectiles[]` array. Each tick, projectiles advance by their speed.
- [ ] Collision check each tick: if a projectile's cell matches an enemy cell (or player cell), apply damage and remove the projectile.
- [ ] Projectiles that exit the grid bounds are removed.
- [ ] Add projectile state to `GameState` snapshots.

---

## Phase 2 — Real-Time Feel and Single-Player Playability

**Goal:** Make the prototype fun to play alone before thinking about networking. Get the core loop right.

### 2.1 — Visual feedback
- Smooth player movement animation between grid cells (tween over the fixed-tick duration).
- Visual projectile objects that interpolate position using the `alpha` from the render step.
- Hit flash on enemies and player when damaged.
- Card cast visual (brief highlight on the active card slot).

### 2.2 — Player-facing card UI
- Display the five card slots with hotkey labels and cooldown indicators.
- Show remaining HP and block prominently.
- Remove all "End Turn" / phase UI.

### 2.3 — Game balance pass
- Tune enemy action timers, spawn rate, projectile speed, and card cooldowns so the game is challenging but readable.
- Enemy count, HP values, and spawn frequency will need significant adjustment from the turn-based values.

### 2.4 — Death and restart
- On player HP reaching 0, pause the simulation and transition to `GameOver`.
- `GameOver` should display turns-survived and offer restart — this already exists and needs minor updating.

### 2.5 — Enemy variety (optional at this stage)
- Consider whether the current melee/ranged split is sufficient for a real-time feel, or if new enemy behaviours are needed.
- Keep this lightweight — the goal is a playable prototype, not a finished game.

---

## Phase 3 — Rollback Netcode Multiplayer

**Goal:** Two-player real-time PvP with rollback netcode. Both clients simulate locally; a thin relay server forwards stamped input packets.

**Decisions made:**

| Decision | Choice | Rationale |
|---|---|---|
| **Netcode** | Rollback | Lowest latency for a PvP fighter; simulation is already deterministic & snapshotable |
| **Transport** | Socket.io (WebSockets/TCP) | No NAT traversal hassle; upgradeable to geckos.io/WebRTC later if latency profiling warrants it |
| **Topology** | Thin relay server | Node.js server forwards stamped input packets; no game logic on server; cheap to host |
| **Input delay** | 2 frames fixed (≈33ms) | Imperceptible to players; dramatically reduces rollback frequency on good connections |
| **Rollback depth** | 15 frames max (≈250ms RTT) | Covers intercontinental play; sim is lightweight enough to resimulate 15 ticks in microseconds |

### 3.1 — Rollback engine (`src/systems/RollbackManager.js`)

This is the core networking logic, independent of any transport layer.

- [ ] **Input history ring buffer** — stores the last `MAX_ROLLBACK + INPUT_DELAY` input snapshots per player, keyed by tick number.
  - Local inputs are written immediately.
  - Remote inputs are slotted in when they arrive (possibly for past ticks).
  - Predicted inputs: when a remote tick hasn't arrived yet, copy the most recent confirmed input for that player (last-input prediction).
- [ ] **State snapshot ring buffer** — stores `GameState.toSnapshot()` every tick, up to `MAX_ROLLBACK` deep.
- [ ] **Input delay queue** — local inputs are not applied to the simulation immediately. They are timestamped for `currentTick + INPUT_DELAY` and held until that tick arrives. This gives the remote player's input 2 extra frames to arrive before prediction is needed.
- [ ] **Rollback trigger** — when a remote input arrives for a tick that was already simulated:
  1. Compare the received input against what was predicted for that tick.
  2. If they match, no action needed (prediction was correct).
  3. If they differ:
     a. Restore the snapshot for that tick (`GameState.fromSnapshot()`).
     b. Replay from that tick to the current tick using the corrected input history.
     c. The renderer will show the corrected state on the next frame — for small corrections this is invisible.
- [ ] **Advantage limiting** — if the local client is too far ahead of the remote client (based on received tick stamps), insert a 1-frame stall to let the remote catch up. Prevents one fast machine from running away.
- [ ] **Desync detection hook** — after each confirmed tick (both inputs known), hash the game state. Both clients can exchange hashes periodically. If hashes diverge, log the states for debugging. (Not a blocker for launch, but essential for debugging determinism issues.)

**Public API:**
```js
const rb = new RollbackManager(gameState, { inputDelay: 2, maxRollback: 15 });

rb.addLocalInput(tick, inputSnapshot);    // called by InputBuffer
rb.addRemoteInput(tick, inputSnapshot);   // called by NetworkManager
rb.advanceTick();                         // called once per fixed timestep in update()
rb.getCurrentTick();                      // the local simulation tick
```

### 3.2 — Node.js relay server (`server/`)

A minimal Node.js + Socket.io server. No game logic — just rooms and packet forwarding.

- [ ] **Project setup**: `server/package.json` with `socket.io` dependency. Entry point `server/index.js`.
- [ ] **Room system**: in-memory map of `roomCode → { players[], seed, startTick }`.
  - `create_room` → generates a 4-character room code, stores creator's socket.
  - `join_room` → validates room exists and has space, stores joiner's socket.
  - Max 2 players per room.
- [ ] **Ready handshake**: both players send `ready`. Once both are ready, server broadcasts `game_start` with `{ seed, yourPlayerId, opponentPlayerId }`.
- [ ] **Input relay**: client sends `{ type: 'input', tick, data }`. Server forwards it to the other player in the room *unmodified*. Server does not inspect or validate the contents.
- [ ] **Clock sync**: on connection, server responds to `ping` with its timestamp. Client measures RTT from 5 samples, takes the median. Used to calibrate the initial tick offset between the two clients.
- [ ] **Disconnect handling**: if a player disconnects, notify the other player. The client pauses the sim and shows a "opponent disconnected" message.

### 3.3 — Client network layer (`src/network/NetworkManager.js`)

Wraps Socket.io client. All other game code talks to `NetworkManager`, never to Socket.io directly.

- [ ] **Offline stub**: when no server URL is configured, `NetworkManager` is a no-op. Single-player still works identically to Phase 1/2 with zero networking overhead.
- [ ] **Connection lifecycle**: `connect(serverUrl)`, `disconnect()`, `createRoom()`, `joinRoom(code)`, `sendReady()`.
- [ ] **Input sending**: `sendInput(tick, inputSnapshot)` — serialises and emits via Socket.io.
- [ ] **Input receiving**: `onRemoteInput(callback)` — fires when the relay forwards a remote input packet. Passes `{ tick, data }` to the callback, which feeds into `RollbackManager.addRemoteInput()`.
- [ ] **Lobby callbacks**: `onRoomCreated(callback)`, `onPlayerJoined(callback)`, `onGameStart(callback)`, `onOpponentDisconnected(callback)`.
- [ ] **Socket.io client loading**: loaded via `<script>` tag in `index.html` (CDN or local copy). No bundler.

### 3.4 — Lobby scene (`src/scenes/Lobby.js`)

New scene inserted between `Start` and `Game`. Handles room creation, joining, and the ready handshake.

- [ ] **Create Room** button → calls `NetworkManager.createRoom()`, displays room code for sharing.
- [ ] **Join Room** input → text field + Go button, calls `NetworkManager.joinRoom(code)`.
- [ ] **Player status display** — shows "Waiting for opponent…" → "Opponent joined!" → countdown → launch `Game`.
- [ ] **Ready handshake** — both players must click Ready (or auto-ready after short countdown).
- [ ] On `game_start`, transition to `Game` scene passing `{ seed, localPlayerId, remotePlayerId }`.
- [ ] **Back button** — disconnect and return to `Start`.

### 3.5 — Wire `Game.js` for multiplayer

Modify the existing `Game` scene to integrate with `RollbackManager` and `NetworkManager`.

- [ ] **Two-player simulation**: `GameState` is constructed with `playerIds: ['p1', 'p2']`. Both players exist on the grid simultaneously — P1 in rows 4–7, P2 in rows 0–3 (from their own perspective each player sees themselves at the bottom).
- [ ] **View flipping**: if `localPlayerId === 'p2'`, the rendering functions flip row order so the local player always appears at the bottom of the screen. This is purely visual — the simulation grid is canonical.
- [ ] **Input routing**:
  - Local player's keyboard → `InputBuffer` → `RollbackManager.addLocalInput()`.
  - Remote player's input arrives via `NetworkManager.onRemoteInput()` → `RollbackManager.addRemoteInput()`.
- [ ] **Tick advancement**: `update()` calls `RollbackManager.advanceTick()` instead of `gameState.simTick()` directly. The rollback manager handles input delay, prediction, and rollback internally.
- [ ] **Render from simulation**: the renderer reads from `this.gameState` as before — `RollbackManager` ensures it points to the latest (possibly rolled-back-and-replayed) state.
- [ ] **Second player sprite**: add a second placeholder rectangle for P2, rendered using the same lerp logic.
- [ ] **Disconnect handling**: on `onOpponentDisconnected`, pause the sim and show an overlay with "Return to Lobby" option.

### 3.6 — Testing checklist

- [ ] Two browser tabs on localhost play against each other through the relay server.
- [ ] Artificially delay one tab's packets by 100ms (browser dev tools throttle) — verify rollback produces smooth play with occasional minor corrections.
- [ ] Both clients reach the same final state after identical play sessions (desync hash check).
- [ ] Disconnecting one tab shows the notification on the other.

---

## Phase 4 — Game Modes and Polish

> **To be detailed when Phase 3 is complete.**

### Goals
- Abstract the win/loss condition so different game modes (co-op, race, PvP direct) can be selected at the lobby level without changing simulation code.
- Co-op (shared HP pool, both players fight the same enemy grid) is the first mode to ship.
- PvP (each player has their own grid, or players attack each other directly) follows.
- Spectator mode (read-only client receiving state) may be useful for debugging.

### Open questions at this stage
- Does co-op share a single hand or do both players have independent hands?
- In PvP, do players attack each other's HP directly, or defeat a set number of enemies first?
- Is there a time limit per match?

---

## Key invariants (do not violate these across all phases)

1. **Simulation never reads wall-clock time** (`Date.now()`, `performance.now()`). Time is always tick count.
2. **Input never directly mutates state.** Input writes to a buffer; simulation reads from it.
3. **All randomness in simulation goes through the seeded RNG.** Never `Math.random()` in `simUpdate()`.
4. **State is always snapshotable.** Every system implements `toSnapshot()` / `fromSnapshot()`.
5. **`NetworkManager` is the only file that knows about the transport library.** Everything else talks to its interface.
