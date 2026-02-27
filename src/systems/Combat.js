/**
 * Combat.js — owns the active projectile list and resolves collisions each tick.
 *
 * Projectile object shape:
 *   id         {number}           unique auto-increment id
 *   ownerType  {'player'|'enemy'} who fired it
 *   row        {number}           current row (integer grid cell)
 *   col        {number}           current column
 *   prevRow    {number}           row at the start of this tick (for render lerp)
 *   prevCol    {number}           col at the start of this tick
 *   dr         {number}           row delta per step  (-1 toward enemies, +1 toward player)
 *   dc         {number}           col delta per step
 *   damage     {number}           HP damage on hit
 *   speed      {number}           ticks between move steps
 *   stepTimer  {number}           countdown to next step
 *   stepsLeft  {number}           remaining steps before expiry
 *
 * tick() returns a list of HitEvent objects:
 *   { type: 'enemy'|'player', row, col, damage, projectileId }
 *
 * Callers are responsible for applying damage to the appropriate target.
 */

export class Combat {
    constructor() {
        this._nextId     = 1;
        this.projectiles = [];
    }

    // -------------------------------------------------------------------------
    //  Add projectiles
    // -------------------------------------------------------------------------

    /**
     * Add a new projectile to the active list.
     * @param {object} template  Projectile template (dr, dc, damage, speed, range, ownerType)
     * @param {number} row       Spawn row
     * @param {number} col       Spawn col
     */
    addProjectile(template, row, col) {
        this.projectiles.push({
            id:        this._nextId++,
            ownerType: template.ownerType,
            row,
            col,
            prevRow:   row,
            prevCol:   col,
            dr:        template.dr,
            dc:        template.dc,
            damage:    template.damage,
            speed:     template.speed,
            stepTimer: template.speed,
            stepsLeft: template.range,
        });
    }

    // -------------------------------------------------------------------------
    //  Simulation tick
    // -------------------------------------------------------------------------

    /**
     * Advance all projectiles by one tick.  Detect and return hit events.
     * Expired or out-of-bounds projectiles are removed automatically.
     *
     * @param {EnemyManager} enemyManager
     * @param {object[]}     players      Array of player state objects { row, col, hp, ... }
     * @param {number}       gridRows
     * @param {number}       gridCols
     * @returns {Array<{ type: string, row: number, col: number, damage: number, projectileId: number }>}
     */
    tick(enemyManager, players, gridRows, gridCols) {
        const hits    = [];
        const alive   = [];

        for (const p of this.projectiles) {
            // Save previous position for rendering interpolation
            p.prevRow = p.row;
            p.prevCol = p.col;

            p.stepTimer--;

            if (p.stepTimer <= 0) {
                // Move one step
                p.row      += p.dr;
                p.col      += p.dc;
                p.stepTimer = p.speed;
                p.stepsLeft--;
            }

            // Boundary check
            if (p.row < 0 || p.row >= gridRows || p.col < 0 || p.col >= gridCols) continue;

            // Expiry check
            if (p.stepsLeft <= 0) continue;

            // Hit detection
            let hit = false;

            if (p.ownerType === 'player') {
                // Player projectiles hit enemies
                const enemy = enemyManager.getAt(p.row, p.col);
                if (enemy) {
                    hits.push({ type: 'enemy', row: p.row, col: p.col, damage: p.damage, projectileId: p.id });
                    hit = true;
                }
            } else {
                // Enemy projectiles hit players
                for (const player of players) {
                    if (player.row === p.row && player.col === p.col) {
                        hits.push({ type: 'player', row: p.row, col: p.col, damage: p.damage, projectileId: p.id, playerId: player.id });
                        hit = true;
                        break;
                    }
                }
            }

            if (!hit) alive.push(p);
        }

        this.projectiles = alive;
        return hits;
    }

    // -------------------------------------------------------------------------
    //  Snapshot / restore
    // -------------------------------------------------------------------------

    toSnapshot() {
        return {
            nextId:      this._nextId,
            projectiles: this.projectiles.map(p => ({ ...p })),
        };
    }

    fromSnapshot(snap) {
        this._nextId     = snap.nextId;
        this.projectiles = snap.projectiles.map(p => ({ ...p }));
    }
}
