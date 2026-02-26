/**
 * Game.js — Main gameplay scene.
 *
 * Layout (1280×720):
 *   y  0–420   4×4 enemy grid (pseudo-3D perspective)
 *   y 420–480  feedback strip
 *   y 480–720  player hand + HUD
 *
 * Grid coordinates:
 *   grid[row][col]  row 0 = back row (small, top of screen)
 *                   row 3 = front row (large, near bottom of grid area)
 *
 * Turn structure:
 *   Player phase → play any cards → End Turn
 *   Enemy phase  → melee advance → enemies attack → new enemies spawn → player draws
 */

import { buildStarterDeck }  from '../data/CardData.js';
import { Deck }              from '../systems/Deck.js';
import { EnemyManager }      from '../systems/EnemyManager.js';
import { Combat }            from '../systems/Combat.js';

// ─── Grid geometry constants ───────────────────────────────────────────────

const ROWS          = 4;
const COLS          = 4;
const GRID_CENTER_X = 640;
const BASE_SPACING  = 190;   // horizontal center-to-center spacing at scale 1
const BASE_CELL_W   = 155;   // cell width at scale 1
const BASE_CELL_H   = 78;    // cell height at scale 1

/** 0 = back row, 1 = front row (normalised depth) */
function rowT(r)    { return r / (ROWS - 1); }
function rowScale(r){ return 0.28 + 0.72 * rowT(r); }
function rowY(r)    { return 72  + 330  * rowT(r); }   // 72 (back) → 402 (front)
function cellX(r, c){ return GRID_CENTER_X + (c - 1.5) * BASE_SPACING * rowScale(r); }
function cellW(r)   { return BASE_CELL_W * rowScale(r); }
function cellH(r)   { return BASE_CELL_H * rowScale(r); }

// ─── Hand layout constants ──────────────────────────────────────────────────

const HAND_SIZE    = 5;
const CARD_W       = 155;
const CARD_H       = 105;
const CARD_Y       = 620;
const CARD_SPACING = 190;

// ─── Colours ────────────────────────────────────────────────────────────────

const COL = {
    CELL_EMPTY_FILL   : 0x0d0d1a,
    CELL_EMPTY_STROKE : 0x2a2a55,
    CELL_MELEE_FILL   : 0x3a0a0a,
    CELL_MELEE_STROKE : 0xaa3333,
    CELL_RANGE_FILL   : 0x0a1a33,
    CELL_RANGE_STROKE : 0x3366aa,
    CELL_VALID_STROKE : 0x00ff88,
    CARD_EMPTY_FILL   : 0x080810,
    CARD_FILL         : 0x141428,
    CARD_SEL_FILL     : 0x2a2a5a,
    CARD_STROKE       : 0x4455aa,
    CARD_SEL_STROKE   : 0xffff00,
    BTN_ACTIVE_BG     : '#1a4a1a',
    BTN_DISABLED_BG   : '#2a2a2a',
};

// ───────────────────────────────────────────────────────────────────────────

export class Game extends Phaser.Scene {

    constructor() { super('Game'); }

    // ========================================================================
    //  create
    // ========================================================================
    create() {
        // ── state ──────────────────────────────────────────────────────────
        this.playerHp      = 10;
        this.playerBlock   = 0;
        this.turnCount     = 1;
        this.phase         = 'player';   // 'player' | 'enemy'
        this.selectedIdx   = -1;         // index into this.hand, or -1
        this.targetingMode = false;

        // ── systems ────────────────────────────────────────────────────────
        this.deck          = new Deck(buildStarterDeck());
        this.enemyManager  = new EnemyManager();
        this.combat        = new Combat();

        // ── dark backdrop ──────────────────────────────────────────────────
        this.add.rectangle(640, 360, 1280, 720, 0x05050f);

        // ── grid divider line ──────────────────────────────────────────────
        const divider = this.add.graphics();
        divider.lineStyle(1, 0x222244, 1);
        divider.lineBetween(0, 430, 1280, 430);

        // ── grid cells (back-to-front so front renders on top) ─────────────
        this.cellBgs    = [];
        this.cellLabels = [];

        for (let r = 0; r < ROWS; r++) {
            this.cellBgs[r]    = [];
            this.cellLabels[r] = [];

            for (let c = 0; c < COLS; c++) {
                const x    = cellX(r, c);
                const y    = rowY(r);
                const w    = cellW(r);
                const h    = cellH(r);
                const fs   = Math.max(9, Math.round(13 * rowScale(r)));

                const bg = this.add.rectangle(x, y, w, h, COL.CELL_EMPTY_FILL)
                    .setStrokeStyle(1, COL.CELL_EMPTY_STROKE)
                    .setInteractive();
                bg.input.cursor = 'pointer';

                const label = this.add.text(x, y, '', {
                    fontSize : `${fs}px`,
                    color    : '#dddddd',
                    align    : 'center',
                    lineSpacing: 2,
                }).setOrigin(0.5);

                bg.on('pointerdown', () => this.onCellClick(r, c));
                bg.on('pointerover', () => {
                    if (this.targetingMode && this._isValidTarget(r, c)) {
                        bg.setFillStyle(bg.fillColor + 0x111111);
                    }
                });
                bg.on('pointerout',  () => this.refreshCell(r, c));

                this.cellBgs[r][c]    = bg;
                this.cellLabels[r][c] = label;
            }
        }

        // ── row distance labels (left gutter) ─────────────────────────────
        const rowNames = ['Row 4 (back)', 'Row 3', 'Row 2', 'Row 1 (front)'];
        for (let r = 0; r < ROWS; r++) {
            this.add.text(14, rowY(r), rowNames[r], {
                fontSize : `${Math.max(9, Math.round(10 * rowScale(r)))}px`,
                color    : '#444466',
            }).setOrigin(0, 0.5);
        }

        // ── hand card slots ────────────────────────────────────────────────
        this.handBgs    = [];
        this.handLabels = [];

        for (let i = 0; i < HAND_SIZE; i++) {
            const cx = 640 + (i - 2) * CARD_SPACING;

            const bg = this.add.rectangle(cx, CARD_Y, CARD_W, CARD_H, COL.CARD_EMPTY_FILL)
                .setStrokeStyle(1, 0x222233)
                .setInteractive();
            bg.input.cursor = 'pointer';

            const label = this.add.text(cx, CARD_Y, '', {
                fontSize  : '13px',
                color     : '#ccccff',
                align     : 'center',
                lineSpacing: 4,
                wordWrap  : { width: CARD_W - 12 },
            }).setOrigin(0.5);

            bg.on('pointerdown', () => this.onCardClick(i));
            bg.on('pointerover', () => {
                if (this.hand[i] && this.phase === 'player') bg.setFillStyle(0x1e1e38);
            });
            bg.on('pointerout', () => {
                if (this.hand[i]) {
                    bg.setFillStyle(i === this.selectedIdx ? COL.CARD_SEL_FILL : COL.CARD_FILL);
                }
            });

            this.handBgs[i]    = bg;
            this.handLabels[i] = label;
        }

        // ── HUD ────────────────────────────────────────────────────────────
        this.hudText  = this.add.text(20,   450, '', { fontSize: '20px', color: '#ffffff' });
        this.turnText = this.add.text(1260, 450, '', { fontSize: '20px', color: '#aaaacc', align: 'right' }).setOrigin(1, 0);

        this.feedbackText = this.add.text(640, 480, '', {
            fontSize : '15px',
            color    : '#ffff99',
            align    : 'center',
        }).setOrigin(0.5, 0);

        // ── End Turn button ────────────────────────────────────────────────
        this.endTurnBtn = this.add.text(1180, 680, '  End Turn  ', {
            fontSize        : '22px',
            color           : '#ffffff',
            backgroundColor : COL.BTN_ACTIVE_BG,
            padding         : { x: 10, y: 8 },
        }).setOrigin(0.5).setInteractive();
        this.endTurnBtn.input.cursor = 'pointer';

        this.endTurnBtn.on('pointerdown', () => this.endPlayerTurn());
        this.endTurnBtn.on('pointerover', () => {
            if (this.phase === 'player') this.endTurnBtn.setStyle({ color: '#aaffaa' });
        });
        this.endTurnBtn.on('pointerout', () => {
            this.endTurnBtn.setStyle({ color: '#ffffff' });
        });

        // ── "Hand" label ───────────────────────────────────────────────────
        this.add.text(20, 570, 'HAND', { fontSize: '12px', color: '#334466' });

        // ── initial state ──────────────────────────────────────────────────
        this.enemyManager.spawn(Phaser.Math.Between(1, 3));
        this.hand = this._drawFive();
        this.refreshAll();
    }

    // ========================================================================
    //  Rendering helpers
    // ========================================================================

    refreshAll() {
        this.refreshGrid();
        this.refreshHand();
        this.refreshHUD();
    }

    refreshGrid() {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                this.refreshCell(r, c);
            }
        }
        if (this.targetingMode) this.highlightValidTargets();
    }

    refreshCell(r, c) {
        const enemy = this.enemyManager.grid[r][c];
        const bg    = this.cellBgs[r][c];
        const lbl   = this.cellLabels[r][c];

        if (enemy) {
            const isMelee = enemy.type === 'melee';
            bg.setFillStyle(isMelee ? COL.CELL_MELEE_FILL : COL.CELL_RANGE_FILL)
              .setStrokeStyle(1, isMelee ? COL.CELL_MELEE_STROKE : COL.CELL_RANGE_STROKE);
            lbl.setText(`${isMelee ? '[M]' : '[R]'}\nHP ${enemy.hp}/${enemy.maxHp}`);
        } else {
            bg.setFillStyle(COL.CELL_EMPTY_FILL)
              .setStrokeStyle(1, COL.CELL_EMPTY_STROKE);
            lbl.setText('');
        }
    }

    /** Returns true if cell (r,c) is a legal target for the currently selected card. */
    _isValidTarget(r, c) {
        if (this.selectedIdx < 0) return false;
        const card  = this.hand[this.selectedIdx];
        const enemy = this.enemyManager.grid[r][c];
        if (!card || !enemy) return false;
        if (card.targeting === 'single-melee')  return r === 3;
        if (card.targeting === 'single-ranged') return r !== 3;
        return false;
    }

    highlightValidTargets() {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (this._isValidTarget(r, c)) {
                    this.cellBgs[r][c].setStrokeStyle(2, COL.CELL_VALID_STROKE);
                }
            }
        }
    }

    refreshHand() {
        for (let i = 0; i < HAND_SIZE; i++) {
            const card = this.hand[i];
            const bg   = this.handBgs[i];
            const lbl  = this.handLabels[i];
            const sel  = (i === this.selectedIdx);

            if (card) {
                bg.setAlpha(1)
                  .setFillStyle(sel ? COL.CARD_SEL_FILL : COL.CARD_FILL)
                  .setStrokeStyle(2, sel ? COL.CARD_SEL_STROKE : COL.CARD_STROKE);

                const typeStr  = card.type === 'damage'
                    ? `Atk ${card.value}`
                    : `Blk +${card.value}`;
                const targStr  = card.targeting.replace('single-', '').toUpperCase();
                const clr      = card.type === 'damage' ? '#ff9999' : '#99ccff';

                lbl.setText(`${card.name}\n${typeStr}\n${targStr}`)
                   .setColor(clr);
            } else {
                bg.setAlpha(0.3)
                  .setFillStyle(COL.CARD_EMPTY_FILL)
                  .setStrokeStyle(1, 0x1a1a2a);
                lbl.setText('');
            }
        }
    }

    refreshHUD() {
        this.hudText.setText(`HP: ${this.playerHp}    Block: ${this.playerBlock}`);
        this.turnText.setText(`Turn ${this.turnCount}`);
        const active = this.phase === 'player';
        this.endTurnBtn.setStyle({ backgroundColor: active ? COL.BTN_ACTIVE_BG : COL.BTN_DISABLED_BG });
    }

    setFeedback(msg, color = '#ffff99') {
        this.feedbackText.setText(msg).setColor(color);
        if (msg) {
            if (this._feedbackTimer) this._feedbackTimer.remove();
            this._feedbackTimer = this.time.delayedCall(2500, () => {
                if (this.feedbackText) this.feedbackText.setText('');
            });
        }
    }

    // ========================================================================
    //  Input handlers
    // ========================================================================

    onCardClick(index) {
        if (this.phase !== 'player') return;
        const card = this.hand[index];
        if (!card) return;

        // Clicking the already-selected card deselects it
        if (this.selectedIdx === index) {
            this.selectedIdx   = -1;
            this.targetingMode = false;
            this.setFeedback('');
            this.refreshHand();
            this.refreshGrid();
            return;
        }

        this.selectedIdx = index;

        if (card.targeting === 'aoe' || card.targeting === 'self') {
            // No targeting step needed — play immediately
            this.playSelectedCard(null);
        } else {
            // Enter targeting mode: highlight valid enemy cells
            this.targetingMode = true;
            this.refreshHand();
            this.refreshGrid();   // also calls highlightValidTargets if targetingMode
            this.setFeedback('Select a target enemy.');
        }
    }

    onCellClick(row, col) {
        if (this.phase !== 'player' || !this.targetingMode) return;
        this.playSelectedCard({ row, col });
    }

    // ========================================================================
    //  Card resolution
    // ========================================================================

    playSelectedCard(target) {
        const card = this.hand[this.selectedIdx];
        if (!card) return;

        const result = this.combat.playCard(card, target, {
            enemyManager: this.enemyManager,
        });

        if (!result.success) {
            this.setFeedback(result.reason, '#ff7777');
            return;
        }

        // Consume card from the hand slot
        this.deck.discard([card]);
        this.hand[this.selectedIdx] = null;

        // Apply block locally (Combat returns success but doesn't mutate scene state)
        if (card.targeting === 'self') {
            this.playerBlock += card.value;
        }

        this.selectedIdx   = -1;
        this.targetingMode = false;
        this.setFeedback('');
        this.refreshAll();
    }

    // ========================================================================
    //  Turn transitions
    // ========================================================================

    endPlayerTurn() {
        if (this.phase !== 'player') return;
        this.phase = 'enemy';

        // Discard any unplayed cards
        const remaining = this.hand.filter(c => c !== null);
        this.deck.discard(remaining);
        this.hand      = Array(HAND_SIZE).fill(null);
        this.selectedIdx   = -1;
        this.targetingMode = false;

        this.refreshAll();
        this.runEnemyTurn();
    }

    runEnemyTurn() {
        // Step 1 — melee enemies advance one row (400ms delay for visibility)
        this.time.delayedCall(400, () => {
            this.enemyManager.advanceMelee();
            this.refreshGrid();

            // Step 2 — enemies attack
            this.time.delayedCall(500, () => {
                const attackers   = this.enemyManager.getAttackers();
                let   totalDmg    = 0;
                for (const { enemy } of attackers) totalDmg += enemy.attack;

                const absorbed = Math.min(this.playerBlock, totalDmg);
                const hpDmg    = totalDmg - absorbed;
                this.playerBlock = Math.max(0, this.playerBlock - absorbed);
                this.playerHp   -= hpDmg;

                if (totalDmg > 0) {
                    this.setFeedback(
                        `Enemies deal ${totalDmg} damage — ${absorbed} blocked, ${hpDmg} to HP.`,
                        '#ff8888'
                    );
                } else {
                    this.setFeedback('No enemies attacked this turn.', '#88ff88');
                }
                this.refreshHUD();

                // Step 3 — check defeat
                if (this.playerHp <= 0) {
                    this.playerHp = 0;
                    this.refreshHUD();
                    this.time.delayedCall(900, () => {
                        this.scene.start('GameOver', { turns: this.turnCount });
                    });
                    return;
                }

                // Step 4 — spawn new enemies in the back row
                this.time.delayedCall(500, () => {
                    const count = Phaser.Math.Between(0, 4);
                    this.enemyManager.spawn(count);
                    this.refreshGrid();

                    // Step 5 — begin next player turn
                    this.time.delayedCall(350, () => {
                        this.turnCount++;
                        this.playerBlock = 0;   // block does not carry over
                        this.phase       = 'player';
                        this.hand        = this._drawFive();
                        this.refreshAll();
                        this.setFeedback(`Turn ${this.turnCount} — play your cards.`, '#aaccff');
                    });
                });
            });
        });
    }

    // ========================================================================
    //  Utility
    // ========================================================================

    /** Draw 5 cards, padding with nulls if the deck runs low. */
    _drawFive() {
        const drawn = this.deck.drawHand(HAND_SIZE);
        return Array.from({ length: HAND_SIZE }, (_, i) => drawn[i] ?? null);
    }
}
