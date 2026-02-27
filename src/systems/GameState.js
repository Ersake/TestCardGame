/**
 * GameState.js — the authoritative simulation state, orchestrating all systems.
 *
 * This is the single source of truth for a match.  The Phaser scene reads from
 * it for rendering; it never mutates state directly.
 *
 * Responsibilities per tick (in order):
 *   1. Consume input snapshots → apply player movement and card casts
 *   2. Advance enemy timers  → collect enemy projectile requests
 *   3. Advance combat (projectiles) → collect hit events → apply damage
 *   4. Apply gate damage from enemies that walked off the far edge
 *   5. Tick spawn timer  → spawn new enemies when it fires
 *   6. Tick card slot cooldowns → refill slots when cooldown expires
 *   7. Increment the global tick counter
 *
 * Player state shape:
 *   { id, row, col, prevRow, prevCol, hp, maxHp, block,
 *     slots: [{ cardId: string|null, cooldownTimer: number }],
 *     moveCooldown: number }
 *
 * Slots: HAND_SLOTS entries, one per hotkey.  cardId is null while on cooldown.
 * moveCooldown: ticks remaining before the player can move again.
 */

import { RNG }                           from './RNG.js';
import { Deck }                          from './Deck.js';
import { EnemyManager, GRID_ROWS, GRID_COLS } from './EnemyManager.js';
import { Combat }                        from './Combat.js';
import { buildStarterDeck, getCard }     from '../data/CardData.js';

// ─── Constants ──────────────────────────────────────────────────────────────

export const TICK_RATE        = 60;                      // Hz
export const TICK_MS          = 1000 / TICK_RATE;        // ~16.667 ms
export const HAND_SLOTS       = 5;
export const PLAYER_MOVE_COOLDOWN = 0;                   // no cooldown between moves
export const SPAWN_INTERVAL   = 300;                     // ticks between spawn waves (~5s)
export const SPAWN_COUNT_MIN  = 1;
export const SPAWN_COUNT_MAX  = 3;

// Player starting positions (row, col) — each player centre-ish in their zone
const PLAYER_START = {
    p1: { row: 6, col: 1 },  // P1: rows 4–7, left-centre
    p2: { row: 1, col: 2 },  // P2: rows 0–3, right-centre (mirror)
};

// Per-player movement zones (each player is confined to their half)
const PLAYER_ZONES = {
    p1: { rowMin: 4, rowMax: GRID_ROWS - 1 },  // rows 4–7
    p2: { rowMin: 0, rowMax: 3 },               // rows 0–3
};

// ─── GameState ───────────────────────────────────────────────────────────────

export class GameState {
    /**
     * @param {{ seed?: number, playerIds?: string[] }} options
     *   seed       — RNG seed (default: random)
     *   playerIds  — ordered list of player IDs (default: ['p1'])
     */
    constructor({ seed, playerIds = ['p1'], enableEnemies } = {}) {
        this.tick        = 0;
        this.over        = false;
        this.overReason  = null;   // 'death' | 'victory'

        // Disable NPC enemies when there are 2+ players (PvP mode)
        this.enableEnemies = enableEnemies ?? (playerIds.length < 2);

        // ── core systems ───────────────────────────────────────────────────
        this.rng          = new RNG(seed ?? (Date.now() >>> 0));
        this.enemyManager = new EnemyManager(this.rng);
        this.combat       = new Combat();

        // ── spawn timer ────────────────────────────────────────────────────
        this.spawnTimer   = SPAWN_INTERVAL;

        // ── players ────────────────────────────────────────────────────────
        this.players = {};

        // Sort playerIds for determinism — both clients must create players
        // in the same order so RNG calls (deck shuffle, draws) are identical.
        const sortedIds = [...playerIds].sort();
        for (const id of sortedIds) {
            const start = PLAYER_START[id] ?? { row: 6, col: 1 };
            const deck  = new Deck(buildStarterDeck(), this.rng);

            // Pre-fill all slots from the deck
            const slots = [];
            for (let i = 0; i < HAND_SLOTS; i++) {
                slots.push({ cardId: deck.draw(), cooldownTimer: 0 });
            }

            this.players[id] = {
                id,
                row:          start.row,
                col:          start.col,
                prevRow:      start.row,
                prevCol:      start.col,
                hp:           10,
                maxHp:        10,
                block:        0,
                moveCooldown: 0,
                slots,
                deck,
            };
        }

        // Spawn initial enemies (solo only)
        if (this.enableEnemies) {
            this.enemyManager.spawn(this.rng.nextInt(SPAWN_COUNT_MIN, SPAWN_COUNT_MAX));
        }
    }

    // =========================================================================
    //  Main simulation tick
    // =========================================================================

    /**
     * Advance the simulation by exactly one tick.
     *
     * @param {Object.<string, { move: string|null, castSlot: number|null }>} inputs
     *   Map of playerId → input snapshot for this tick.
     */
    simTick(inputs = {}) {
        if (this.over) return;

        // ── 1. Input → player actions ─────────────────────────────────────
        // Process in sorted order for cross-client determinism
        const sortedEntries = Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b));
        for (const [id, input] of sortedEntries) {
            const player = this.players[id];
            if (!player) continue;

            // Save previous position for render interpolation
            player.prevRow = player.row;
            player.prevCol = player.col;

            this._applyMove(player, input.move);
            if (input.castSlot !== null) {
                this._applyCast(player, input.castSlot);
            }
        }

        // For players with no input this tick, still update prevRow/prevCol
        for (const player of Object.values(this.players)) {
            if (!inputs[player.id]) {
                player.prevRow = player.row;
                player.prevCol = player.col;
            }
        }

        // ── 2. Enemy tick ──────────────────────────────────────────────────
        const { projectiles: enemyProjs, gateDamage } = this.enemyManager.tick();

        // Spawn enemy projectiles
        for (const req of enemyProjs) {
            this.combat.addProjectile(req, req.row, req.col);
        }

        // Gate damage is split evenly across all living players
        if (gateDamage > 0) {
            const living = Object.values(this.players).filter(p => p.hp > 0);
            const each   = Math.ceil(gateDamage / Math.max(living.length, 1));
            for (const p of living) {
                this._damagePlayer(p, each);
            }
        }

        // ── 3. Projectile tick ─────────────────────────────────────────────
        const playerArray = Object.values(this.players);
        const hits = this.combat.tick(this.enemyManager, playerArray, GRID_ROWS, GRID_COLS);

        for (const hit of hits) {
            if (hit.type === 'enemy') {
                this.enemyManager.damageEnemy(hit.row, hit.col, hit.damage);
            } else if (hit.type === 'player') {
                const player = this.players[hit.playerId];
                if (player) this._damagePlayer(player, hit.damage);
            }
        }

        // ── 4. Slot cooldown tick ──────────────────────────────────────────
        for (const player of Object.values(this.players)) {
            // Card slot cooldowns
            for (const slot of player.slots) {
                if (slot.cooldownTimer > 0) {
                    slot.cooldownTimer--;
                    if (slot.cooldownTimer === 0) {
                        // Slot refills from deck
                        slot.cardId = player.deck.draw();
                    }
                }
            }
        }

        // ── 5. Spawn timer (solo only) ──────────────────────────────────────
        if (this.enableEnemies) {
            this.spawnTimer--;
            if (this.spawnTimer <= 0) {
                this.enemyManager.spawn(this.rng.nextInt(SPAWN_COUNT_MIN, SPAWN_COUNT_MAX));
                this.spawnTimer = SPAWN_INTERVAL;
            }
        }

        // ── 6. Advance tick counter ────────────────────────────────────────
        this.tick++;
    }

    // =========================================================================
    //  Private helpers
    // =========================================================================

    /** @param {object} player @param {string|null} direction */
    _applyMove(player, direction) {
        if (!direction) return;

        // Each player is confined to their half of the grid
        const zone = PLAYER_ZONES[player.id] ?? PLAYER_ZONES['p1'];

        let nr = player.row;
        let nc = player.col;

        switch (direction) {
            case 'up':    nr--; break;
            case 'down':  nr++; break;
            case 'left':  nc--; break;
            case 'right': nc++; break;
        }

        // Clamp to player's zone and valid columns
        if (nr < zone.rowMin || nr > zone.rowMax) return;
        if (nc < 0 || nc >= GRID_COLS) return;

        player.row = nr;
        player.col = nc;
    }

    /** @param {object} player @param {number} slotIndex */
    _applyCast(player, slotIndex) {
        if (slotIndex < 0 || slotIndex >= HAND_SLOTS) return;
        const slot = player.slots[slotIndex];
        if (!slot.cardId || slot.cooldownTimer > 0) return;

        const card = getCard(slot.cardId);

        if (card.type === 'block') {
            player.block += card.blockValue ?? 0;
        }

        // P2 lives in rows 0–3 and shoots toward row 7, so flip dr & dc
        const zone = PLAYER_ZONES[player.id];
        const flipProj = zone && zone.rowMin === 0;   // P2's zone starts at row 0

        for (const tmpl of card.projectiles) {
            this.combat.addProjectile(
                {
                    ...tmpl,
                    dr: flipProj ? -tmpl.dr : tmpl.dr,
                    dc: flipProj ? -tmpl.dc : tmpl.dc,
                    ownerType: 'player',
                },
                player.row,
                player.col,
            );
        }

        // Put slot on cooldown; cardId cleared until cooldown expires
        slot.cardId       = null;
        slot.cooldownTimer = card.cooldownTicks;

        // Discard the card back to the deck
        player.deck.discard(card.id);
    }

    /** Apply damage to a player, consuming block first. */
    _damagePlayer(player, amount) {
        const absorbed   = Math.min(player.block, amount);
        player.block     = Math.max(0, player.block - absorbed);
        player.hp        = Math.max(0, player.hp - (amount - absorbed));

        if (player.hp <= 0 && !this.over) {
            this.over       = true;
            this.overReason = 'death';
        }
    }

    // =========================================================================
    //  Snapshot / restore
    // =========================================================================

    toSnapshot() {
        const playersSnap = {};
        for (const [id, p] of Object.entries(this.players)) {
            playersSnap[id] = {
                id,
                row: p.row, col: p.col,
                prevRow: p.prevRow, prevCol: p.prevCol,
                hp: p.hp, maxHp: p.maxHp, block: p.block,
                moveCooldown: p.moveCooldown,
                slots: p.slots.map(s => ({ ...s })),
                deck: p.deck.toSnapshot(),
            };
        }

        return {
            tick:         this.tick,
            over:         this.over,
            overReason:   this.overReason,
            spawnTimer:   this.spawnTimer,
            rng:          this.rng.toSnapshot(),
            enemyManager: this.enemyManager.toSnapshot(),
            combat:       this.combat.toSnapshot(),
            players:      playersSnap,
        };
    }

    fromSnapshot(snap) {
        this.tick       = snap.tick;
        this.over       = snap.over;
        this.overReason = snap.overReason;
        this.spawnTimer = snap.spawnTimer;

        this.rng.fromSnapshot(snap.rng);
        this.enemyManager.fromSnapshot(snap.enemyManager);
        this.combat.fromSnapshot(snap.combat);

        for (const [id, ps] of Object.entries(snap.players)) {
            const player = this.players[id];
            if (!player) continue;
            Object.assign(player, {
                row: ps.row, col: ps.col,
                prevRow: ps.prevRow, prevCol: ps.prevCol,
                hp: ps.hp, maxHp: ps.maxHp, block: ps.block,
                moveCooldown: ps.moveCooldown,
                slots: ps.slots.map(s => ({ ...s })),
            });
            player.deck.fromSnapshot(ps.deck);
        }
    }
}
