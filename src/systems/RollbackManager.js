/**
 * RollbackManager.js — rollback netcode engine.
 *
 * Manages input delay, input prediction, state snapshots, and rollback/replay.
 * Completely transport-agnostic — it never touches sockets or networking.
 *
 * Lifecycle (called from Game.js update loop):
 *   1. Scene collects local input → addLocalInput(tick, snapshot)
 *   2. NetworkManager delivers remote input → addRemoteInput(tick, snapshot)
 *   3. Scene calls advanceTick() once per fixed timestep
 *      - RollbackManager decides whether to rollback, replay, or just step forward
 *
 * Input delay:
 *   Local inputs are scheduled for `currentTick + INPUT_DELAY`.  This gives the
 *   remote player's input extra frames to arrive before prediction kicks in.
 *
 * Prediction:
 *   If a remote input hasn't arrived for a tick that needs simulating, the last
 *   confirmed remote input is repeated (last-input prediction).
 *
 * Rollback:
 *   When a remote input arrives for an already-simulated tick AND it differs
 *   from what was predicted, the simulation rewinds to that tick's snapshot
 *   and replays forward to the present tick with the corrected input.
 */

const DEFAULT_INPUT = Object.freeze({ move: null, castSlot: null });

export class RollbackManager {
    /**
     * @param {GameState}  gameState       The authoritative simulation instance
     * @param {object}     options
     * @param {number}     options.inputDelay   Frames of input delay (default 2)
     * @param {number}     options.maxRollback  Max rollback depth (default 15)
     * @param {string}     options.localId      Local player id ('p1' or 'p2')
     * @param {string}     options.remoteId     Remote player id ('p1' or 'p2')
     */
    constructor(gameState, { inputDelay = 2, maxRollback = 15, localId = 'p1', remoteId = 'p2' } = {}) {
        this.gameState   = gameState;
        this.inputDelay  = inputDelay;
        this.maxRollback = maxRollback;
        this.localId     = localId;
        this.remoteId    = remoteId;

        this._currentTick = 0;

        // Ring buffers keyed by tick number.  We keep (maxRollback + inputDelay + margin) entries.
        this._bufSize = maxRollback + inputDelay + 4;

        // Input history:  _inputs[playerId][tick % _bufSize] = inputSnapshot | null
        this._inputs = {
            [localId]:  new Array(this._bufSize).fill(null),
            [remoteId]: new Array(this._bufSize).fill(null),
        };

        // Track the latest tick for which we have a confirmed (non-predicted) remote input
        this._lastConfirmedRemoteTick = -1;

        // The last known remote input (for prediction)
        this._lastRemoteInput = { ...DEFAULT_INPUT };

        // State snapshots:  _snapshots[tick % _bufSize] = snapshotObject | null
        this._snapshots = new Array(this._bufSize).fill(null);

        // Track whether the local input for the current scheduling tick has been set
        this._localInputScheduledTick = -1;

        // Stats for debugging
        this.stats = {
            rollbacks: 0,
            maxRollbackDepth: 0,
            predictedFrames: 0,
        };
    }

    // =========================================================================
    //  Public API
    // =========================================================================

    /** Current simulation tick. */
    getCurrentTick() {
        return this._currentTick;
    }

    /**
     * Register the local player's input.  Called once per frame from the scene.
     * The input will be scheduled for `currentTick + inputDelay`.
     *
     * @param {object} inputSnapshot  { move, castSlot }
     * @returns {number}  The tick this input is scheduled for (for sending over network)
     */
    addLocalInput(inputSnapshot) {
        const scheduledTick = this._currentTick + this.inputDelay;
        this._setInput(this.localId, scheduledTick, inputSnapshot);
        this._localInputScheduledTick = scheduledTick;
        return scheduledTick;
    }

    /**
     * Register a remote player's input that arrived from the network.
     * May be for the current tick, a future tick, or a past tick (triggers rollback).
     *
     * @param {number} tick            The tick this input is for
     * @param {object} inputSnapshot   { move, castSlot }
     */
    addRemoteInput(tick, inputSnapshot) {
        this._setInput(this.remoteId, tick, inputSnapshot);

        // Update last confirmed tracker
        if (tick > this._lastConfirmedRemoteTick) {
            this._lastConfirmedRemoteTick = tick;
            this._lastRemoteInput = { ...inputSnapshot };
        }

        // If this input is for a tick we already simulated, we may need to rollback
        if (tick < this._currentTick) {
            this._handleRollback(tick);
        }
    }

    /**
     * Advance the simulation by one tick.  Call this exactly once per fixed
     * timestep in the scene's update() loop.
     *
     * Returns true if the tick was advanced, false if it was stalled
     * (advantage limiting — local is too far ahead of remote).
     *
     * @returns {boolean}
     */
    advanceTick() {
        // Advantage limiting: don't let local get more than maxRollback ahead
        // of the latest confirmed remote tick
        if (this._lastConfirmedRemoteTick >= 0) {
            const lead = this._currentTick - this._lastConfirmedRemoteTick;
            if (lead > this.maxRollback) {
                return false;  // stall this frame
            }
        }

        // Save snapshot BEFORE simulating this tick (so we can restore to this point)
        this._saveSnapshot(this._currentTick);

        // Build the input map for this tick
        const inputs = this._buildInputsForTick(this._currentTick);

        // Step the simulation
        this.gameState.simTick(inputs);
        this._currentTick++;

        return true;
    }

    // =========================================================================
    //  Private — Input management
    // =========================================================================

    _setInput(playerId, tick, inputSnapshot) {
        const idx = tick % this._bufSize;
        this._inputs[playerId][idx] = { tick, data: { ...inputSnapshot } };
    }

    _getInput(playerId, tick) {
        const idx = tick % this._bufSize;
        const entry = this._inputs[playerId][idx];
        if (entry && entry.tick === tick) {
            return entry.data;
        }
        return null;  // not yet received
    }

    /**
     * Build the full input map { p1: {...}, p2: {...} } for a given tick.
     * Uses confirmed inputs where available, prediction otherwise.
     */
    _buildInputsForTick(tick) {
        const inputs = {};

        // Local player — should always have input (we scheduled it via addLocalInput)
        inputs[this.localId] = this._getInput(this.localId, tick) ?? { ...DEFAULT_INPUT };

        // Remote player — use confirmed if available, else predict
        const remoteInput = this._getInput(this.remoteId, tick);
        if (remoteInput) {
            inputs[this.remoteId] = remoteInput;
        } else {
            // Predict: repeat last confirmed remote input
            inputs[this.remoteId] = { ...this._lastRemoteInput };
            this.stats.predictedFrames++;
        }

        return inputs;
    }

    // =========================================================================
    //  Private — Snapshots
    // =========================================================================

    _saveSnapshot(tick) {
        const idx = tick % this._bufSize;
        this._snapshots[idx] = {
            tick,
            data: this.gameState.toSnapshot(),
        };
    }

    _loadSnapshot(tick) {
        const idx = tick % this._bufSize;
        const snap = this._snapshots[idx];
        if (!snap || snap.tick !== tick) {
            console.warn(`[Rollback] Missing snapshot for tick ${tick}`);
            return false;
        }
        this.gameState.fromSnapshot(snap.data);
        return true;
    }

    // =========================================================================
    //  Private — Rollback
    // =========================================================================

    /**
     * A remote input arrived for a tick we already simulated.
     * Check if it differs from prediction; if so, rollback and replay.
     */
    _handleRollback(correctedTick) {
        const depth = this._currentTick - correctedTick;
        if (depth <= 0 || depth > this.maxRollback) return;

        // Check if the received input actually differs from what we predicted
        // (if we predicted correctly, no rollback needed — saves CPU)
        const predicted = this._getInput(this.remoteId, correctedTick);
        // The input was just set by addRemoteInput, so _getInput now returns
        // the corrected value.  We need to compare against what was used during
        // the original simulation.  Since we wrote over it, we can't compare
        // directly — always rollback to be safe.  (Optimisation: store predicted
        // flag per tick to skip unnecessary rollbacks.)

        // Restore to the snapshot at correctedTick
        if (!this._loadSnapshot(correctedTick)) {
            console.warn(`[Rollback] Cannot rollback to tick ${correctedTick} — snapshot missing`);
            return;
        }

        // Replay from correctedTick to currentTick
        for (let t = correctedTick; t < this._currentTick; t++) {
            this._saveSnapshot(t);  // overwrite with corrected snapshot
            const inputs = this._buildInputsForTick(t);
            this.gameState.simTick(inputs);
        }

        this.stats.rollbacks++;
        this.stats.maxRollbackDepth = Math.max(this.stats.maxRollbackDepth, depth);
    }

    // =========================================================================
    //  Diagnostics
    // =========================================================================

    /**
     * Compute a simple hash of the game state for desync detection.
     * Both clients can exchange these periodically.
     * @returns {number}
     */
    getStateHash() {
        // Quick and dirty: JSON-stringify and sum char codes
        const str = JSON.stringify(this.gameState.toSnapshot());
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash * 31 + str.charCodeAt(i)) | 0;
        }
        return hash;
    }
}
