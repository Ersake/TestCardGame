/**
 * Deck.js — manages the draw pile and discard pile.
 *
 * Cards are stored as string IDs.  Use getCard(id) from CardData.js to
 * retrieve full card definitions.
 *
 * All shuffling uses the injected RNG instance so the deck is deterministic
 * and snapshotable for rollback netcode.
 *
 * Usage:
 *   const rng  = new RNG(seed);
 *   const deck = new Deck(buildStarterDeck(), rng);
 *   const cardId = deck.draw();     // one card ID, or null if empty
 *   deck.discard('strike');         // return a card ID to the discard pile
 *
 * Snapshot / restore:
 *   const snap = deck.toSnapshot();
 *   deck.fromSnapshot(snap);
 */

export class Deck {
    /**
     * @param {string[]} cardIds  Array of card ID strings (will be copied & shuffled).
     * @param {RNG}      rng      Seeded RNG instance shared with the simulation.
     */
    constructor(cardIds, rng) {
        this._rng        = rng;
        this.drawPile    = rng.shuffle([...cardIds]);
        this.discardPile = [];
    }

    // -------------------------------------------------------------------------
    //  Draw / discard
    // -------------------------------------------------------------------------

    /**
     * Draw one card.  If the draw pile is empty the discard pile is shuffled
     * and recycled first.  Returns null only if both piles are empty.
     * @returns {string|null}
     */
    draw() {
        if (this.drawPile.length === 0) {
            if (this.discardPile.length === 0) return null;
            this.drawPile    = this._rng.shuffle([...this.discardPile]);
            this.discardPile = [];
        }
        return this.drawPile.pop();
    }

    /**
     * Return a single card ID to the discard pile.
     * @param {string} cardId
     */
    discard(cardId) {
        this.discardPile.push(cardId);
    }

    /** Total cards remaining (draw + discard). */
    get remaining() {
        return this.drawPile.length + this.discardPile.length;
    }

    // -------------------------------------------------------------------------
    //  Snapshot / restore
    // -------------------------------------------------------------------------

    /** @returns {{ drawPile: string[], discardPile: string[] }} */
    toSnapshot() {
        return {
            drawPile:    [...this.drawPile],
            discardPile: [...this.discardPile],
        };
    }

    /** @param {{ drawPile: string[], discardPile: string[] }} snap */
    fromSnapshot(snap) {
        this.drawPile    = [...snap.drawPile];
        this.discardPile = [...snap.discardPile];
    }
}
