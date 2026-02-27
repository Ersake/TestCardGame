/**
 * EnemyManager.js — owns the 4×8 shared arena grid and all enemy mutation logic.
 *
 * Grid layout:
 *   grid[row][col]  8 rows × 4 cols
 *   row 0 = enemy back row (far from player, small on screen)
 *   row 7 = player back row (closest to camera, large on screen)
 *   col 0–3 left to right
 *
 * Zones:
 *   rows 0–3  enemy territory  (enemies spawn here)
 *   rows 4–7  player territory (player moves here)
 *
 * Enemies advance from row 0 toward higher row numbers (toward the player).
 * Melee enemies move one row per actionInterval ticks.
 * Ranged enemies never move; they fire projectiles toward the player.
 *
 * Enemy object shape:
 *   { type, hp, maxHp, attack, actionTimer, actionInterval }
 *
 * tick() returns a TickResult:
 *   { projectiles: ProjectileRequest[], gateDamage: number }
 *
 * ProjectileRequest:
 *   { row, col, dr, dc, damage, speed, range, ownerType: 'enemy' }
 *
 * gateDamage: total damage dealt by melee enemies that walked off row 7.
 */

export const GRID_ROWS = 8;
export const GRID_COLS = 4;
export const ENEMY_ZONE_MAX_ROW = 3;  // enemies start in rows 0–3
export const PLAYER_ZONE_MIN_ROW = 4;  // player lives in rows 4–7

export class EnemyManager {
    /**
     * @param {RNG} rng  Seeded RNG instance shared with the simulation.
     */
    constructor(rng) {
        this._rng  = rng;
        // grid[row][col]: enemy object or null
        this.grid  = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(null));
    }

    // -------------------------------------------------------------------------
    //  Spawn
    // -------------------------------------------------------------------------

    /**
     * Attempt to spawn up to `count` enemies in empty cells on row 0.
     * @param {number} count
     */
    spawn(count) {
        const emptyCols = [];
        for (let c = 0; c < GRID_COLS; c++) {
            if (!this.grid[0][c]) emptyCols.push(c);
        }
        this._rng.shuffle(emptyCols);
        const toSpawn = Math.min(count, emptyCols.length);

        for (let i = 0; i < toSpawn; i++) {
            const col      = emptyCols[i];
            const isMelee  = this._rng.nextBool(0.5);
            const type     = isMelee ? 'melee' : 'ranged';
            const hp       = isMelee
                ? this._rng.nextInt(4, 6)
                : this._rng.nextInt(3, 5);
            const interval = isMelee ? 90 : 80;  // ticks between actions

            this.grid[0][col] = {
                type,
                hp,
                maxHp:          hp,
                attack:         isMelee ? 4 : 3,
                actionTimer:    interval,
                actionInterval: interval,
            };
        }
    }

    // -------------------------------------------------------------------------
    //  Simulation tick
    // -------------------------------------------------------------------------

    /**
     * Advance all enemy timers by one tick.  When a timer fires:
     *   - Melee  : attempt to move one row toward the player.
     *   - Ranged : emit a projectile request.
     *
     * Melee enemies that would step beyond row 7 deal gate damage instead.
     *
     * @returns {{ projectiles: object[], gateDamage: number }}
     */
    tick() {
        const projectiles = [];
        let   gateDamage  = 0;

        // Process front-to-back so advancing melee enemies don't chain-push.
        for (let r = GRID_ROWS - 1; r >= 0; r--) {
            for (let c = 0; c < GRID_COLS; c++) {
                const enemy = this.grid[r][c];
                if (!enemy) continue;

                enemy.actionTimer--;
                if (enemy.actionTimer > 0) continue;

                enemy.actionTimer = enemy.actionInterval;  // reset

                if (enemy.type === 'melee') {
                    const nextRow = r + 1;
                    if (nextRow >= GRID_ROWS) {
                        // Reached the far edge — gate damage
                        gateDamage     += enemy.attack;
                        this.grid[r][c] = null;
                    } else if (!this.grid[nextRow][c]) {
                        // Advance
                        this.grid[nextRow][c] = enemy;
                        this.grid[r][c]       = null;
                    }
                    // If next cell occupied, enemy waits (stays in place)

                } else {
                    // Ranged — emit a projectile heading toward the player
                    projectiles.push({
                        row:       r,
                        col:       c,
                        dr:        +1,   // toward player (increasing row)
                        dc:        0,
                        damage:    enemy.attack,
                        speed:     10,   // ticks per cell (moderate speed)
                        range:     GRID_ROWS,
                        ownerType: 'enemy',
                    });
                }
            }
        }

        return { projectiles, gateDamage };
    }

    // -------------------------------------------------------------------------
    //  Damage
    // -------------------------------------------------------------------------

    /**
     * Deal damage to the enemy at (row, col).  Removes it if HP drops to 0.
     * @param {number} row
     * @param {number} col
     * @param {number} amount
     * @returns {boolean}  true if the enemy was killed
     */
    damageEnemy(row, col, amount) {
        const enemy = this.grid[row][col];
        if (!enemy) return false;
        enemy.hp -= amount;
        if (enemy.hp <= 0) {
            this.grid[row][col] = null;
            return true;
        }
        return false;
    }

    // -------------------------------------------------------------------------
    //  Queries
    // -------------------------------------------------------------------------

    /**
     * @returns {{ row: number, col: number, enemy: object }[]}
     */
    getAllEnemies() {
        const result = [];
        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                if (this.grid[r][c]) result.push({ row: r, col: c, enemy: this.grid[r][c] });
            }
        }
        return result;
    }

    /**
     * @param {number} row
     * @param {number} col
     * @returns {object|null}
     */
    getAt(row, col) {
        if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return null;
        return this.grid[row][col];
    }

    // -------------------------------------------------------------------------
    //  Snapshot / restore
    // -------------------------------------------------------------------------

    toSnapshot() {
        return {
            grid: this.grid.map(row =>
                row.map(cell => cell ? { ...cell } : null)
            ),
        };
    }

    fromSnapshot(snap) {
        this.grid = snap.grid.map(row =>
            row.map(cell => cell ? { ...cell } : null)
        );
    }
}
