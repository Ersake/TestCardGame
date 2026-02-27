/**
 * Game.js — Real-time gameplay scene.
 *
 * Arena layout (1280×720):
 *   Shared 4×8 grid with pseudo-3D perspective (far = small/top, near = large/bottom).
 *
 *   Rows 0–3  enemy / P2 zone  (top of screen, small cells — far from camera)
 *   Rows 4–7  P1 zone          (bottom of screen, large cells — near camera)
 *
 *   y   0–620  grid area (row 0 at y≈30, row 7 at y≈615)
 *   y 630–640  feedback strip
 *   y 640–720  card slot HUD
 *
 * Fixed timestep: 60 Hz simulation, variable render with alpha interpolation.
 *
 * Modes:
 *   solo   — single player vs NPCs, no networking
 *   online — two players via rollback netcode + relay server
 *
 * Controls:
 *   W/A/S/D  — move player
 *   1–5      — cast card in that slot
 */

import { GameState, TICK_MS, HAND_SLOTS } from '../systems/GameState.js';
import { InputBuffer }                    from '../systems/InputBuffer.js';
import { RollbackManager }                from '../systems/RollbackManager.js';
import { getCard }                        from '../data/CardData.js';
import { GRID_ROWS, GRID_COLS }           from '../systems/EnemyManager.js';

// ─── Grid geometry ────────────────────────────────────────────────────────────

const GRID_CENTER_X = 640;
const GRID_Y_TOP    = 30;    // row 0 centre y
const GRID_Y_BOTTOM = 615;   // row 7 centre y
const BASE_SPACING  = 190;   // horizontal centre-to-centre at scale 1.0
const BASE_CELL_W   = 155;
const BASE_CELL_H   = 78;

function rowT(r)     { return r / (GRID_ROWS - 1); }
function rowScale(r) { return 0.15 + 0.85 * rowT(r); }
function rowY(r)     { return GRID_Y_TOP + (GRID_Y_BOTTOM - GRID_Y_TOP) * rowT(r); }
function cellX(r, c) { return GRID_CENTER_X + (c - 1.5) * BASE_SPACING * rowScale(r); }
function cellW(r)    { return BASE_CELL_W * rowScale(r); }
function cellH(r)    { return BASE_CELL_H * rowScale(r); }

/**
 * Convert a simulation row to a display row.
 * P1 sees the grid as-is (row 7 = bottom/near).
 * P2 sees it rotated 180° (row 0 = bottom/near).
 */
function displayRow(r, flip) { return flip ? (GRID_ROWS - 1 - r) : r; }

/** Convert a simulation column to a display column (mirrored for 180° rotation). */
function displayCol(c, flip) { return flip ? (GRID_COLS - 1 - c) : c; }

/** Linear interpolate between two values. */
function lerp(a, b, t) { return a + (b - a) * t; }

// ─── Colours ─────────────────────────────────────────────────────────────────

const COL = {
    // Cells — enemy zone
    ENEMY_EMPTY_FILL   : 0x0d0d1a,
    ENEMY_EMPTY_STROKE : 0x2a2a55,
    CELL_MELEE_FILL    : 0x3a0a0a,
    CELL_MELEE_STROKE  : 0xaa3333,
    CELL_RANGE_FILL    : 0x0a1a33,
    CELL_RANGE_STROKE  : 0x3366aa,
    // Cells — player zone
    PLAYER_EMPTY_FILL  : 0x0a130a,
    PLAYER_EMPTY_STROKE: 0x223322,
    PLAYER_CELL_FILL   : 0x102010,
    PLAYER_CELL_STROKE : 0x44aa44,
    // Player sprite
    PLAYER_FILL        : 0x44ff88,
    PLAYER_STROKE      : 0xffffff,
    // P2 sprite
    P2_FILL            : 0x4488ff,
    P2_STROKE          : 0xffffff,
    // Projectiles
    PROJ_PLAYER_FILL   : 0xffff44,
    PROJ_ENEMY_FILL    : 0xff6622,
    // Divider
    DIVIDER            : 0x445566,
    // Card slots
    SLOT_FILL          : 0x141428,
    SLOT_STROKE        : 0x4455aa,
    SLOT_COOLDOWN_FILL : 0x0a0a1a,
};

// ─── Card slot HUD layout ─────────────────────────────────────────────────────

const SLOT_Y       = 680;
const SLOT_W       = 155;
const SLOT_H       = 70;
const SLOT_SPACING = 195;

// ─── Scene ───────────────────────────────────────────────────────────────────

export class Game extends Phaser.Scene {
    constructor() { super('Game'); }

    // =========================================================================
    //  create
    // =========================================================================
    create(data) {
        // ── mode config ────────────────────────────────────────────────────
        this._mode          = data?.mode ?? 'solo';          // 'solo' | 'online'
        this._localPlayerId = data?.localPlayerId ?? 'p1';
        this._remotePlayerId = data?.remotePlayerId ?? null;
        this._net           = data?.networkManager ?? null;   // NetworkManager instance (online only)

        const seed      = data?.seed ?? (Date.now() >>> 0);
        const playerIds = this._mode === 'online'
            ? ['p1', 'p2']   // Always canonical order — determinism requires both clients create players identically
            : ['p1'];

        // ── simulation ─────────────────────────────────────────────────────
        this.gameState    = new GameState({ seed, playerIds });
        this.inputBuffer  = new InputBuffer();
        this._accumulator = 0;

        // ── rollback manager (online only) ─────────────────────────────────
        this._rollback = null;
        if (this._mode === 'online' && this._net) {
            this._rollback = new RollbackManager(this.gameState, {
                inputDelay:  2,
                maxRollback: 15,
                localId:     this._localPlayerId,
                remoteId:    this._remotePlayerId,
            });

            // Wire incoming remote inputs to rollback manager
            this._net.onRemoteInput(({ tick, data: inputData }) => {
                this._rollback.addRemoteInput(tick, inputData);
            });

            this._net.onOpponentDisconnected(() => {
                this._setFeedback('Opponent disconnected!');
                // Give a moment then end
                this.time.delayedCall(2000, () => this._onGameOver());
            });
        }

        // ── view flip (P2 sees the grid upside-down so their zone is at bottom) ──
        this._flipView = (this._localPlayerId === 'p2');

        // ── keyboard ───────────────────────────────────────────────────────
        this._setupKeys();

        // ── dark backdrop ──────────────────────────────────────────────────
        this.add.rectangle(640, 360, 1280, 720, 0x05050f);

        // ── grid cells back-to-front (row 0 first so row 7 renders on top) ─
        this._cellBgs    = [];
        this._cellLabels = [];

        for (let r = 0; r < GRID_ROWS; r++) {
            this._cellBgs[r]    = [];
            this._cellLabels[r] = [];

            for (let c = 0; c < GRID_COLS; c++) {
                const dr = displayRow(r, this._flipView);
                const dc = displayCol(c, this._flipView);
                const x  = cellX(dr, dc);
                const y  = rowY(dr);
                const w  = cellW(dr);
                const h  = cellH(dr);
                const fs = Math.max(7, Math.round(12 * rowScale(dr)));

                // "Local zone" = the zone belonging to the local player
                const isLocalZone = this._flipView ? (r <= 3) : (r >= 4);
                const fillCol   = isLocalZone ? COL.PLAYER_EMPTY_FILL  : COL.ENEMY_EMPTY_FILL;
                const strokeCol = isLocalZone ? COL.PLAYER_EMPTY_STROKE : COL.ENEMY_EMPTY_STROKE;

                const bg = this.add.rectangle(x, y, w, h, fillCol)
                    .setStrokeStyle(1, strokeCol);

                const label = this.add.text(x, y, '', {
                    fontSize  : `${fs}px`,
                    color     : '#dddddd',
                    align     : 'center',
                    lineSpacing: 2,
                }).setOrigin(0.5);

                this._cellBgs[r][c]    = bg;
                this._cellLabels[r][c] = label;
            }
        }

        // ── zone divider between rows 3 and 4 ─────────────────────────────
        const divR3 = displayRow(3, this._flipView);
        const divR4 = displayRow(4, this._flipView);
        const dividerY = Math.round((rowY(divR3) + rowY(divR4)) / 2);
        this.add.line(640, dividerY, -640, 0, 640, 0, COL.DIVIDER).setLineWidth(1.5);
        this.add.text(14, dividerY - 10, '── ARENA BOUNDARY ──', {
            fontSize: '10px', color: '#445566',
        });

        // ── player sprite (placeholder rectangle) ─────────────────────────
        this._playerSprite = this.add.rectangle(0, 0, 30, 40, COL.PLAYER_FILL)
            .setStrokeStyle(2, COL.PLAYER_STROKE)
            .setDepth(10);
        this._playerLabel = this.add.text(0, 0, 'P1', {
            fontSize: '10px', color: '#000000',
        }).setOrigin(0.5).setDepth(11);

        // ── P2 sprite (only in online mode) ────────────────────────────────
        this._p2Sprite = null;
        this._p2Label  = null;
        if (this._mode === 'online') {
            this._p2Sprite = this.add.rectangle(0, 0, 30, 40, COL.P2_FILL)
                .setStrokeStyle(2, COL.P2_STROKE)
                .setDepth(10);
            this._p2Label = this.add.text(0, 0, 'P2', {
                fontSize: '10px', color: '#000000',
            }).setOrigin(0.5).setDepth(11);
        }

        // ── projectile pool ────────────────────────────────────────────────
        this._projSprites = new Map();  // projectileId → Rectangle

        // ── feedback strip ─────────────────────────────────────────────────
        this.add.rectangle(640, 635, 1280, 20, 0x000000, 0.7);
        this._feedbackText = this.add.text(640, 635, '', {
            fontSize: '13px', color: '#ffff99', align: 'center',
        }).setOrigin(0.5);

        // ── stats HUD ──────────────────────────────────────────────────────
        this._hudText  = this.add.text(1260, 10, '', {
            fontSize: '16px', color: '#ffffff', align: 'right',
        }).setOrigin(1, 0).setDepth(20);
        this._tickText = this.add.text(10, 10, '', {
            fontSize: '13px', color: '#556677',
        }).setDepth(20);

        // ── card slot HUD ──────────────────────────────────────────────────
        this._slots   = [];
        const hotkeys = ['1', '2', '3', '4', '5'];
        this.add.rectangle(640, SLOT_Y, 1280, SLOT_H + 20, 0x000000, 0.8);

        for (let i = 0; i < HAND_SLOTS; i++) {
            const cx = 640 + (i - 2) * SLOT_SPACING;

            const bg = this.add.rectangle(cx, SLOT_Y, SLOT_W, SLOT_H, COL.SLOT_FILL)
                .setStrokeStyle(1, COL.SLOT_STROKE);

            const cooldownBar = this.add.rectangle(cx - SLOT_W / 2, SLOT_Y, 0, SLOT_H, 0x000000, 0.7)
                .setOrigin(0, 0.5);

            const label = this.add.text(cx, SLOT_Y, '', {
                fontSize  : '12px',
                color     : '#ccccff',
                align     : 'center',
                lineSpacing: 3,
                wordWrap  : { width: SLOT_W - 10 },
            }).setOrigin(0.5);

            const keyLabel = this.add.text(
                cx - SLOT_W / 2 + 5, SLOT_Y - SLOT_H / 2 + 4,
                hotkeys[i], { fontSize: '10px', color: '#888888' }
            );

            this._slots.push({ bg, cooldownBar, label, keyLabel });
        }

        // ── initial render ─────────────────────────────────────────────────
        this._renderAll(0);
    }

    // =========================================================================
    //  update — fixed-timestep accumulator
    // =========================================================================
    update(_time, delta) {
        this._readKeys();

        this._accumulator += delta;

        if (this._mode === 'online' && this._rollback) {
            // ── Online: pump ticks through RollbackManager ───────────────
            while (this._accumulator >= TICK_MS) {
                // Gather local input and schedule it with delay
                const localInput = this.inputBuffer.consume();
                const scheduledTick = this._rollback.addLocalInput(localInput);

                // Send input to remote player
                this._net.sendInput(scheduledTick, localInput);

                // Advance simulation (may stall if too far ahead)
                const advanced = this._rollback.advanceTick();
                if (!advanced) break;  // stalled — wait for remote

                this._accumulator -= TICK_MS;

                if (this.gameState.over) {
                    this._onGameOver();
                    return;
                }
            }
        } else {
            // ── Solo: direct simulation ──────────────────────────────────
            while (this._accumulator >= TICK_MS) {
                const input = { p1: this.inputBuffer.consume() };
                this.gameState.simTick(input);
                this._accumulator -= TICK_MS;

                if (this.gameState.over) {
                    this._onGameOver();
                    return;
                }
            }
        }

        const alpha = this._accumulator / TICK_MS;
        this._renderAll(alpha);
    }

    // =========================================================================
    //  Input
    // =========================================================================

    _setupKeys() {
        const kb = this.input.keyboard;

        this._keys = {
            w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        };

        const slotKeyCodes = [
            Phaser.Input.Keyboard.KeyCodes.ONE,
            Phaser.Input.Keyboard.KeyCodes.TWO,
            Phaser.Input.Keyboard.KeyCodes.THREE,
            Phaser.Input.Keyboard.KeyCodes.FOUR,
            Phaser.Input.Keyboard.KeyCodes.FIVE,
        ];
        this._slotKeys = slotKeyCodes.map((code, i) => {
            const key = kb.addKey(code);
            key.on('down', () => this.inputBuffer.setCast(i));
            return key;
        });
    }

    _readKeys() {
        const k = this._keys;
        // When the view is flipped (P2), up/down are reversed so W always
        // moves toward the top of the screen and S toward the bottom.
        const up    = this._flipView ? 'down'  : 'up';
        const down  = this._flipView ? 'up'    : 'down';
        const left  = this._flipView ? 'right' : 'left';
        const right = this._flipView ? 'left'  : 'right';
        if      (Phaser.Input.Keyboard.JustDown(k.w)) this.inputBuffer.setMove(up);
        else if (Phaser.Input.Keyboard.JustDown(k.s)) this.inputBuffer.setMove(down);
        else if (Phaser.Input.Keyboard.JustDown(k.a)) this.inputBuffer.setMove(left);
        else if (Phaser.Input.Keyboard.JustDown(k.d)) this.inputBuffer.setMove(right);
    }

    // =========================================================================
    //  Rendering
    // =========================================================================

    _renderAll(alpha) {
        this._renderGrid();
        this._renderPlayer(alpha);
        this._renderProjectiles(alpha);
        this._renderHUD();
        this._renderSlots();
    }

    _renderGrid() {
        const { enemyManager } = this.gameState;

        for (let r = 0; r < GRID_ROWS; r++) {
            const isLocalZone = this._flipView ? (r <= 3) : (r >= 4);

            for (let c = 0; c < GRID_COLS; c++) {
                const enemy = enemyManager.getAt(r, c);
                const bg    = this._cellBgs[r][c];
                const lbl   = this._cellLabels[r][c];

                if (enemy) {
                    const isMelee = enemy.type === 'melee';
                    bg.setFillStyle(isMelee ? COL.CELL_MELEE_FILL : COL.CELL_RANGE_FILL)
                      .setStrokeStyle(1, isMelee ? COL.CELL_MELEE_STROKE : COL.CELL_RANGE_STROKE);
                    const hpBar = `${'█'.repeat(enemy.hp)}${'░'.repeat(enemy.maxHp - enemy.hp)}`;
                    lbl.setText(`${isMelee ? 'M' : 'R'}\n${hpBar}`).setVisible(true);
                } else {
                    const fillCol   = isLocalZone ? COL.PLAYER_EMPTY_FILL  : COL.ENEMY_EMPTY_FILL;
                    const strokeCol = isLocalZone ? COL.PLAYER_EMPTY_STROKE : COL.ENEMY_EMPTY_STROKE;
                    bg.setFillStyle(fillCol).setStrokeStyle(1, strokeCol);
                    lbl.setText('').setVisible(false);
                }
            }
        }
    }

    /** Convert sim row to display row (rotated 180° for P2). */
    _dr(r) { return displayRow(r, this._flipView); }
    /** Convert sim col to display col (rotated 180° for P2). */
    _dc(c) { return displayCol(c, this._flipView); }

    _renderPlayer(alpha) {
        // Render local player (P1 in solo, localPlayerId in online)
        const localId = this._localPlayerId;
        const p = this.gameState.players[localId];
        if (!p) return;

        const dprev = this._dr(p.prevRow);
        const dcur  = this._dr(p.row);
        const prevX = cellX(dprev, this._dc(p.prevCol));
        const prevY = rowY(dprev);
        const curX  = cellX(dcur, this._dc(p.col));
        const curY  = rowY(dcur);

        const x = lerp(prevX, curX, alpha);
        const y = lerp(prevY, curY, alpha);
        const s = lerp(rowScale(dprev), rowScale(dcur), alpha);

        this._playerSprite.setPosition(x, y).setDisplaySize(34 * s, 44 * s);
        this._playerLabel.setPosition(x, y).setFontSize(`${Math.round(10 * s)}px`);
        this._playerLabel.setText(localId.toUpperCase());

        // Highlight the player's current cell
        this._cellBgs[p.row][p.col]
            .setFillStyle(COL.PLAYER_CELL_FILL)
            .setStrokeStyle(2, COL.PLAYER_CELL_STROKE);

        // Render remote player (online only)
        if (this._p2Sprite && this._remotePlayerId) {
            const p2 = this.gameState.players[this._remotePlayerId];
            if (!p2) return;

            const dp2prev = this._dr(p2.prevRow);
            const dp2cur  = this._dr(p2.row);
            const p2prevX = cellX(dp2prev, this._dc(p2.prevCol));
            const p2prevY = rowY(dp2prev);
            const p2curX  = cellX(dp2cur, this._dc(p2.col));
            const p2curY  = rowY(dp2cur);

            const p2x = lerp(p2prevX, p2curX, alpha);
            const p2y = lerp(p2prevY, p2curY, alpha);
            const p2s = lerp(rowScale(dp2prev), rowScale(dp2cur), alpha);

            this._p2Sprite.setPosition(p2x, p2y).setDisplaySize(34 * p2s, 44 * p2s);
            this._p2Label.setPosition(p2x, p2y).setFontSize(`${Math.round(10 * p2s)}px`);
            this._p2Label.setText(this._remotePlayerId.toUpperCase());

            // Highlight remote player's cell
            this._cellBgs[p2.row][p2.col]
                .setFillStyle(0x0a1a30)
                .setStrokeStyle(2, 0x4488ff);
        }
    }

    _renderProjectiles(alpha) {
        const activeIds = new Set();

        for (const proj of this.gameState.combat.projectiles) {
            activeIds.add(proj.id);

            const dprev = this._dr(proj.prevRow);
            const dcur  = this._dr(proj.row);
            const prevX = cellX(dprev, this._dc(proj.prevCol));
            const prevY = rowY(dprev);
            const curX  = cellX(dcur, this._dc(proj.col));
            const curY  = rowY(dcur);
            const x     = lerp(prevX, curX, alpha);
            const y     = lerp(prevY, curY, alpha);
            const s     = lerp(rowScale(dprev), rowScale(dcur), alpha);
            const size  = Math.max(6, 16 * s);
            const color = proj.ownerType === 'player' ? COL.PROJ_PLAYER_FILL : COL.PROJ_ENEMY_FILL;

            if (!this._projSprites.has(proj.id)) {
                const sprite = this.add.rectangle(x, y, size, size, color).setDepth(8);
                this._projSprites.set(proj.id, sprite);
            } else {
                this._projSprites.get(proj.id)
                    .setPosition(x, y)
                    .setDisplaySize(size, size)
                    .setFillStyle(color);
            }
        }

        // Clean up sprites whose projectiles no longer exist
        for (const [id, sprite] of this._projSprites) {
            if (!activeIds.has(id)) {
                sprite.destroy();
                this._projSprites.delete(id);
            }
        }
    }

    _renderHUD() {
        const p = this.gameState.players[this._localPlayerId];
        if (!p) return;
        const hpBar  = `${'♥'.repeat(Math.max(0, p.hp))}${'♡'.repeat(Math.max(0, p.maxHp - p.hp))}`;
        const blkStr = p.block > 0 ? `  Shield:${p.block}` : '';

        let hudStr = `You: ${hpBar}${blkStr}`;

        // Show opponent HP in online mode
        if (this._remotePlayerId) {
            const p2 = this.gameState.players[this._remotePlayerId];
            if (p2) {
                const p2hp = `${'♥'.repeat(Math.max(0, p2.hp))}${'♡'.repeat(Math.max(0, p2.maxHp - p2.hp))}`;
                const p2blk = p2.block > 0 ? `  Shield:${p2.block}` : '';
                hudStr += `\nOpp: ${p2hp}${p2blk}`;
            }
        }

        this._hudText.setText(hudStr);

        const tickStr = this._rollback
            ? `t:${this._rollback.getCurrentTick()} rb:${this._rollback.stats.rollbacks}`
            : `t:${this.gameState.tick}`;
        this._tickText.setText(tickStr);
    }

    _renderSlots() {
        const p = this.gameState.players[this._localPlayerId];
        if (!p) return;

        for (let i = 0; i < HAND_SLOTS; i++) {
            const slot = p.slots[i];
            const { bg, cooldownBar, label } = this._slots[i];

            if (slot.cardId) {
                const card    = getCard(slot.cardId);
                const dmg     = card.projectiles.reduce((sum, t) => sum + t.damage, 0);
                const typeStr = card.type === 'damage' ? `Atk ${dmg}` : `Blk +${card.blockValue}`;
                bg.setFillStyle(COL.SLOT_FILL).setStrokeStyle(1, COL.SLOT_STROKE);
                cooldownBar.setSize(0, SLOT_H);
                label.setText(`${card.name}\n${typeStr}`).setColor('#ccccff');
            } else {
                // Show cooldown progress bar shrinking as timer counts down
                const frac = slot.cooldownTimer > 0
                    ? slot.cooldownTimer / 120   // normalise against max expected cooldown
                    : 0;
                bg.setFillStyle(COL.SLOT_COOLDOWN_FILL).setStrokeStyle(1, 0x222233);
                cooldownBar.setSize(SLOT_W * frac, SLOT_H);
                label.setText('').setColor('#555577');
            }
        }
    }

    // =========================================================================
    //  Game over
    // =========================================================================

    _setFeedback(text) {
        if (this._feedbackText) this._feedbackText.setText(text);
    }

    _onGameOver() {
        // Stop the simulation loop from re-entering the online branch
        this._rollback = null;

        this.input.keyboard.removeAllKeys(true);
        for (const sprite of this._projSprites.values()) sprite.destroy();
        this._projSprites.clear();

        // Report result to relay server for logging, then disconnect
        if (this._net) {
            const players = Object.values(this.gameState.players);
            const loser   = players.find(p => p.hp <= 0);
            const winner  = players.find(p => p.hp > 0);
            if (loser && winner) {
                this._net.sendGameOver(winner.id, loser.id, this.gameState.tick);
            }
            // Small delay so the packet can flush before the socket closes
            setTimeout(() => { this._net?.disconnect(); this._net = null; }, 200);
        }

        this.time.delayedCall(600, () => {
            this.scene.start('GameOver', { turns: this.gameState.tick });
        });
    }
}
