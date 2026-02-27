/**
 * RNG.js — Seeded pseudo-random number generator (mulberry32 algorithm).
 *
 * All simulation randomness must go through this class so that:
 *   1. Two runs with the same seed produce identical outcomes (determinism).
 *   2. State can be snapshotted and restored for rollback netcode.
 *
 * Usage:
 *   const rng = new RNG(12345);
 *   rng.next();          // float in [0, 1)
 *   rng.nextInt(0, 3);   // integer in [min, max] inclusive
 *   rng.nextBool(0.5);   // boolean with given probability
 *
 * Snapshot / restore:
 *   const snap = rng.toSnapshot();
 *   rng.fromSnapshot(snap);
 */

export class RNG {
    /**
     * @param {number} seed  32-bit unsigned integer seed. Defaults to a
     *                       time-based value if omitted — only use the default
     *                       for throwaway instances, NOT simulation code.
     */
    constructor(seed = (Date.now() >>> 0)) {
        this._state = seed >>> 0;  // coerce to uint32
    }

    // -------------------------------------------------------------------------
    //  Core generator (mulberry32)
    // -------------------------------------------------------------------------

    /**
     * Advance the state and return a float in [0, 1).
     * @returns {number}
     */
    next() {
        let z = (this._state += 0x6D2B79F5);
        z = Math.imul(z ^ (z >>> 15), z | 1);
        z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
        return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
    }

    // -------------------------------------------------------------------------
    //  Convenience helpers
    // -------------------------------------------------------------------------

    /**
     * Random integer in the inclusive range [min, max].
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    nextInt(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    /**
     * Random boolean with the given probability of returning true.
     * @param {number} [probability=0.5]
     * @returns {boolean}
     */
    nextBool(probability = 0.5) {
        return this.next() < probability;
    }

    /**
     * Shuffle an array in-place using Fisher-Yates.
     * @template T
     * @param {T[]} arr
     * @returns {T[]}  The same array, shuffled.
     */
    shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // -------------------------------------------------------------------------
    //  Snapshot / restore
    // -------------------------------------------------------------------------

    /** @returns {{ state: number }} */
    toSnapshot() {
        return { state: this._state };
    }

    /** @param {{ state: number }} snap */
    fromSnapshot(snap) {
        this._state = snap.state >>> 0;
    }
}
