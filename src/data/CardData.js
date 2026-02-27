/**
 * CardData.js — definitions for all cards in the game.
 *
 * Card shape:
 *   id             {string}    unique key
 *   name           {string}    display name
 *   type           {string}    'damage' | 'block'
 *   cooldownTicks  {number}    ticks before the slot redraws after casting (at 60 Hz)
 *   blockValue     {number?}   block granted on cast (type 'block' only)
 *   projectiles    {object[]}  projectile templates spawned on cast (may be empty)
 *
 * Projectile template shape:
 *   dr      {number}  row delta per move step  (-1 = toward enemies, +1 = toward player back)
 *   dc      {number}  col delta per move step  (0 = straight, ±1 = diagonal)
 *   damage  {number}  HP damage on hit
 *   speed   {number}  ticks between each move step (lower = faster)
 *   range   {number}  maximum number of move steps before the projectile expires
 *
 * Deck stores card IDs (strings).  Look up full definitions via getCard(id).
 */

export const CARDS = [
    {
        id:            'strike',
        name:          'Strike',
        type:          'damage',
        cooldownTicks: 90,          // 1.5 s at 60 Hz
        projectiles: [
            { dr: -1, dc: 0, damage: 6, speed: 4, range: 3 },
        ],
    },
    {
        id:            'shoot',
        name:          'Shoot',
        type:          'damage',
        cooldownTicks: 75,          // 1.25 s
        projectiles: [
            { dr: -1, dc: 0, damage: 4, speed: 8, range: 8 },
        ],
    },
    {
        id:            'blast',
        name:          'Blast',
        type:          'damage',
        cooldownTicks: 120,         // 2 s
        // Fires three projectiles: left-diagonal, straight, right-diagonal
        projectiles: [
            { dr: -1, dc: -1, damage: 2, speed: 6, range: 5 },
            { dr: -1, dc:  0, damage: 2, speed: 6, range: 5 },
            { dr: -1, dc: +1, damage: 2, speed: 6, range: 5 },
        ],
    },
    {
        id:            'defend',
        name:          'Defend',
        type:          'block',
        cooldownTicks: 60,          // 1 s
        blockValue:    5,
        projectiles:   [],          // no projectile
    },
];

/** Lookup map for O(1) access by id. */
const CARD_MAP = Object.fromEntries(CARDS.map(c => [c.id, c]));

/**
 * Return the card definition for a given id.
 * @param {string} id
 * @returns {object}
 */
export function getCard(id) {
    const card = CARD_MAP[id];
    if (!card) throw new Error(`Unknown card id: "${id}"`);
    return card;
}

/**
 * Returns a starter deck as an array of card IDs.
 * 3× Strike, 3× Shoot, 2× Blast, 2× Defend.
 */
export function buildStarterDeck() {
    return [
        'strike', 'strike', 'strike',
        'shoot',  'shoot',  'shoot',
        'blast',  'blast',
        'defend', 'defend',
    ];
}
