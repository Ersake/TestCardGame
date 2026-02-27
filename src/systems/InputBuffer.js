/**
 * InputBuffer.js — decouples raw input events from simulation tick consumption.
 *
 * The Phaser scene writes to the buffer every frame via the key listeners.
 * Once per simulation tick, the buffer is consumed and cleared.
 *
 * This is the seam that networking replaces for the remote player:
 *   - Local player  → InputBuffer populated by keyboard events
 *   - Remote player → InputBuffer populated by received network packets
 *
 * Input snapshot shape (one per tick):
 *   {
 *     move:     'up' | 'down' | 'left' | 'right' | null,
 *     castSlot: 0–4 | null,    // which card slot hotkey was pressed (0-indexed)
 *   }
 *
 * If multiple move keys are pressed in the same tick, the most recently pressed
 * one wins (last-write-wins on the buffer).  If multiple cast keys are pressed,
 * only the lowest-index slot is used (first wins for casts to avoid accidents).
 */

export class InputBuffer {
    constructor() {
        this._move     = null;  // pending move direction
        this._castSlot = null;  // pending card cast slot index
    }

    // -------------------------------------------------------------------------
    //  Write side — called by Phaser input listeners
    // -------------------------------------------------------------------------

    /** @param {'up'|'down'|'left'|'right'} direction */
    setMove(direction) {
        this._move = direction;
    }

    /**
     * Signal that the player pressed the hotkey for a card slot.
     * If a cast is already buffered this tick, the earlier one wins.
     * @param {number} slotIndex  0-indexed slot (0–4)
     */
    setCast(slotIndex) {
        if (this._castSlot === null) {
            this._castSlot = slotIndex;
        }
    }

    // -------------------------------------------------------------------------
    //  Read side — called once per simulation tick
    // -------------------------------------------------------------------------

    /**
     * Returns the current input snapshot and clears the buffer.
     * @returns {{ move: string|null, castSlot: number|null }}
     */
    consume() {
        const snapshot = {
            move:     this._move,
            castSlot: this._castSlot,
        };
        this._move     = null;
        this._castSlot = null;
        return snapshot;
    }

    /**
     * Peek at the current buffer contents without consuming them.
     * Useful for debugging / spectator mode.
     * @returns {{ move: string|null, castSlot: number|null }}
     */
    peek() {
        return { move: this._move, castSlot: this._castSlot };
    }

    /** Discard all buffered input without consuming it. */
    clear() {
        this._move     = null;
        this._castSlot = null;
    }
}
