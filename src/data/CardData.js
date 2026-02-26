/**
 * CardData.js — definitions for all cards in the game.
 *
 * Card shape:
 *   id         {string}  unique key
 *   name       {string}  display name
 *   targeting  {string}  'single-melee' | 'single-ranged' | 'aoe' | 'self'
 *   type       {string}  'damage' | 'block'
 *   value      {number}  damage dealt or block gained
 *
 * targeting rules:
 *   single-melee  → player must click a specific enemy in row 3 (front row only)
 *   single-ranged → player must click a specific enemy NOT in row 3
 *   aoe           → hits every living enemy on the grid, no click needed
 *   self          → applies block to the player, no click needed
 */

export const CARDS = [
    { id: 'strike',  name: 'Strike',  targeting: 'single-melee',  type: 'damage', value: 6 },
    { id: 'shoot',   name: 'Shoot',   targeting: 'single-ranged', type: 'damage', value: 4 },
    { id: 'blast',   name: 'Blast',   targeting: 'aoe',           type: 'damage', value: 2 },
    { id: 'defend',  name: 'Defend',  targeting: 'self',          type: 'block',  value: 5 },
];

/**
 * Returns a fresh starter deck: 3× Strike, 3× Shoot, 2× Blast, 2× Defend.
 * Each card is a shallow copy so they are independent objects.
 */
export function buildStarterDeck() {
    return [
        ...Array(3).fill(null).map(() => ({ ...CARDS[0] })),
        ...Array(3).fill(null).map(() => ({ ...CARDS[1] })),
        ...Array(2).fill(null).map(() => ({ ...CARDS[2] })),
        ...Array(2).fill(null).map(() => ({ ...CARDS[3] })),
    ];
}
