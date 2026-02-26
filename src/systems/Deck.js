/**
 * Deck.js — manages the draw pile and discard pile.
 *
 * Usage:
 *   const deck = new Deck(buildStarterDeck());
 *   const hand = deck.drawHand(5);  // array of up to 5 cards
 *   deck.discard(hand);             // return cards to discard pile
 */

export class Deck {
    /**
     * @param {object[]} cards  Array of card definition objects (will be copied).
     */
    constructor(cards) {
        this.drawPile    = this._shuffle([...cards]);
        this.discardPile = [];
    }

    /** Fisher-Yates in-place shuffle. Returns the array. */
    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /**
     * Draw up to n cards.  If the draw pile runs dry, the discard pile is
     * shuffled and becomes the new draw pile.  Returns an array of card objects
     * (may be shorter than n if there are truly no cards left).
     * @param  {number}   n
     * @returns {object[]}
     */
    drawHand(n) {
        const hand = [];
        for (let i = 0; i < n; i++) {
            if (this.drawPile.length === 0) {
                if (this.discardPile.length === 0) break; // deck truly empty
                this.drawPile    = this._shuffle([...this.discardPile]);
                this.discardPile = [];
            }
            hand.push(this.drawPile.pop());
        }
        return hand;
    }

    /**
     * Move an array of cards to the discard pile.
     * @param {object[]} cards
     */
    discard(cards) {
        this.discardPile.push(...cards);
    }
}
