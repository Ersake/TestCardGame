/**
 * EnemyManager.js — owns the 4×4 enemy grid and all mutation logic.
 *
 * Grid layout:
 *   grid[row][col]  row 0 = back (furthest from player)
 *                   row 3 = front (closest to player)
 *                   col 0-3 left to right
 *
 * Enemy object shape:
 *   { type: 'melee'|'ranged', hp: number, maxHp: number, attack: number }
 *
 * Melee enemies move one row forward per enemy turn and attack when in row 3.
 * Ranged enemies never move and always attack regardless of row.
 */

export class EnemyManager {
    constructor() {
        // grid[row][col]: enemy object or null
        this.grid = Array.from({ length: 4 }, () => Array(4).fill(null));
    }

    // ------------------------------------------------------------------ spawn

    /**
     * Spawn up to `count` random enemies in empty cells on row 0 (back row).
     * @param {number} count
     */
    spawn(count) {
        const emptyCols = [];
        for (let c = 0; c < 4; c++) {
            if (!this.grid[0][c]) emptyCols.push(c);
        }
        // Shuffle so the occupied columns are chosen randomly
        for (let i = emptyCols.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [emptyCols[i], emptyCols[j]] = [emptyCols[j], emptyCols[i]];
        }
        const toSpawn = Math.min(count, emptyCols.length);
        for (let i = 0; i < toSpawn; i++) {
            const col  = emptyCols[i];
            const type = Math.random() < 0.5 ? 'melee' : 'ranged';
            const hp   = type === 'melee'
                ? 4 + Math.floor(Math.random() * 3)   // 4-6
                : 3 + Math.floor(Math.random() * 3);   // 3-5
            this.grid[0][col] = { type, hp, maxHp: hp, attack: type === 'melee' ? 4 : 3 };
        }
    }

    // --------------------------------------------------------------- movement

    /**
     * Move every melee enemy one row toward the player (row+1).
     * If the target cell is occupied the enemy stays put.
     * Processes back-to-front to avoid chain-reactions in one pass.
     */
    advanceMelee() {
        for (let r = 2; r >= 0; r--) {          // start at row 2; row 3 already at front
            for (let c = 0; c < 4; c++) {
                const enemy = this.grid[r][c];
                if (enemy && enemy.type === 'melee' && !this.grid[r + 1][c]) {
                    this.grid[r + 1][c] = enemy;
                    this.grid[r][c]     = null;
                }
            }
        }
    }

    // -------------------------------------------------------------- attacking

    /**
     * Returns every enemy that attacks this turn:
     *   - Ranged: any row
     *   - Melee:  row 3 only
     * @returns {{ row: number, col: number, enemy: object }[]}
     */
    getAttackers() {
        const attackers = [];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                const enemy = this.grid[r][c];
                if (!enemy) continue;
                if (enemy.type === 'ranged' || (enemy.type === 'melee' && r === 3)) {
                    attackers.push({ row: r, col: c, enemy });
                }
            }
        }
        return attackers;
    }

    // ---------------------------------------------------------------- queries

    /** All living enemies in a specific row. */
    getEnemiesInRow(row) {
        const result = [];
        for (let c = 0; c < 4; c++) {
            if (this.grid[row][c]) result.push({ row, col: c, enemy: this.grid[row][c] });
        }
        return result;
    }

    /** All living enemies across the entire grid. */
    getAllEnemies() {
        const result = [];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                if (this.grid[r][c]) result.push({ row: r, col: c, enemy: this.grid[r][c] });
            }
        }
        return result;
    }

    // --------------------------------------------------------------- mutation

    /**
     * Deal `amount` damage to the enemy at (row, col).
     * Removes the enemy if HP reaches 0.
     * @param {number} row
     * @param {number} col
     * @param {number} amount
     * @returns {boolean} true if the enemy died
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
}
