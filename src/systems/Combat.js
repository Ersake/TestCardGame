/**
 * Combat.js — resolves a card play against the current game state.
 *
 * Rules:
 *   single-melee  → target must be in row 3 (front row)
 *   single-ranged → target must NOT be in row 3
 *   aoe           → damages all living enemies
 *   self          → signals the scene to add block (returns success; block
 *                   application stays in the scene to keep system boundaries clean)
 *
 * Returns { success: boolean, reason?: string }
 */

export class Combat {
    /**
     * @param {object}              card        Card definition object
     * @param {{ row, col }|null}   target      Grid coordinates, or null for aoe/self
     * @param {{ enemyManager }}    gameState   Slice of scene state needed for resolution
     * @returns {{ success: boolean, reason?: string }}
     */
    playCard(card, target, gameState) {
        const { enemyManager } = gameState;

        switch (card.targeting) {

            case 'single-melee': {
                if (!target)
                    return { success: false, reason: 'Select a front-row enemy.' };
                if (target.row !== 3)
                    return { success: false, reason: 'Strike can only hit front-row enemies (row 1).' };
                if (!enemyManager.grid[target.row][target.col])
                    return { success: false, reason: 'No enemy in that cell.' };
                enemyManager.damageEnemy(target.row, target.col, card.value);
                return { success: true };
            }

            case 'single-ranged': {
                if (!target)
                    return { success: false, reason: 'Select a target enemy.' };
                if (target.row === 3)
                    return { success: false, reason: 'Ranged cards cannot hit front-row enemies.' };
                if (!enemyManager.grid[target.row][target.col])
                    return { success: false, reason: 'No enemy in that cell.' };
                enemyManager.damageEnemy(target.row, target.col, card.value);
                return { success: true };
            }

            case 'aoe': {
                const all = enemyManager.getAllEnemies();
                if (all.length === 0)
                    return { success: false, reason: 'No enemies to hit.' };
                for (const { row, col } of all) {
                    enemyManager.damageEnemy(row, col, card.value);
                }
                return { success: true };
            }

            case 'self':
                // Block application is handled by the scene after receiving success.
                return { success: true };

            default:
                return { success: false, reason: 'Unknown card targeting type.' };
        }
    }
}
