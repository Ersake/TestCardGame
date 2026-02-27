/**
 * NetworkManager.js — wraps Socket.io for the relay server connection.
 *
 * All game code talks to NetworkManager; nothing else imports Socket.io.
 * When no server URL is provided, acts as a no-op stub for single-player.
 *
 * Usage:
 *   const net = new NetworkManager();
 *   await net.connect('http://localhost:3000');
 *   const { code, playerId } = await net.createRoom();
 *   // or: const { code, playerId } = await net.joinRoom('ABCD');
 *   net.sendReady();
 *   net.onGameStart(({ seed, playerId, opponentId }) => { ... });
 *   net.onRemoteInput(({ tick, data }) => { ... });
 *   net.sendInput(tick, inputSnapshot);
 */

export class NetworkManager {
    constructor() {
        /** @type {import('socket.io-client').Socket|null} */
        this._socket    = null;
        this._connected = false;
        this._roomCode  = null;
        this._playerId  = null;

        // Callbacks (set by the consumer)
        this._onPlayerJoined        = null;
        this._onOpponentReady       = null;
        this._onGameStart           = null;
        this._onRemoteInput         = null;
        this._onOpponentDisconnected = null;

        // RTT measurement
        this._rtt = 0;
    }

    // =========================================================================
    //  Connection
    // =========================================================================

    /**
     * Connect to the relay server.
     * @param {string} serverUrl  e.g. 'http://localhost:3000'
     * @returns {Promise<void>}
     */
    connect(serverUrl) {
        return new Promise((resolve, reject) => {
            if (!serverUrl || typeof io === 'undefined') {
                console.warn('[Net] No server URL or Socket.io not loaded — running offline.');
                resolve();
                return;
            }

            // `io` is the global from the Socket.io CDN script
            this._socket = io(serverUrl, {
                transports: ['websocket'],   // skip long-polling, go straight to WS
                reconnection: false,         // we handle reconnection ourselves
            });

            this._socket.on('connect', () => {
                this._connected = true;
                console.log(`[Net] Connected (id: ${this._socket.id})`);
                this._measureRTT().then(resolve);
            });

            this._socket.on('connect_error', (err) => {
                console.error('[Net] Connection error:', err.message);
                reject(err);
            });

            // Wire up server events to internal callbacks
            this._socket.on('player_joined',        (data) => this._onPlayerJoined?.(data));
            this._socket.on('opponent_ready',        ()     => this._onOpponentReady?.());
            this._socket.on('game_start',            (data) => this._onGameStart?.(data));
            this._socket.on('remote_input',          (data) => this._onRemoteInput?.(data));
            this._socket.on('opponent_disconnected', ()     => this._onOpponentDisconnected?.());
        });
    }

    disconnect() {
        if (this._socket) {
            this._socket.disconnect();
            this._socket    = null;
            this._connected = false;
            this._roomCode  = null;
            this._playerId  = null;
        }
    }

    get isConnected() { return this._connected; }
    get roomCode()    { return this._roomCode; }
    get playerId()    { return this._playerId; }
    get rtt()         { return this._rtt; }

    // =========================================================================
    //  Room management
    // =========================================================================

    /**
     * Create a new room.
     * @returns {Promise<{ code: string, playerId: string }>}
     */
    createRoom() {
        return new Promise((resolve, reject) => {
            if (!this._socket) { reject(new Error('Not connected')); return; }

            this._socket.emit('create_room', {}, (response) => {
                if (response.ok) {
                    this._roomCode = response.code;
                    this._playerId = response.playerId;
                    resolve({ code: response.code, playerId: response.playerId });
                } else {
                    reject(new Error(response.reason ?? 'Failed to create room'));
                }
            });
        });
    }

    /**
     * Join an existing room by code.
     * @param {string} code  4-character room code
     * @returns {Promise<{ code: string, playerId: string }>}
     */
    joinRoom(code) {
        return new Promise((resolve, reject) => {
            if (!this._socket) { reject(new Error('Not connected')); return; }

            this._socket.emit('join_room', { code }, (response) => {
                if (response.ok) {
                    this._roomCode = response.code;
                    this._playerId = response.playerId;
                    resolve({ code: response.code, playerId: response.playerId });
                } else {
                    reject(new Error(response.reason ?? 'Failed to join room'));
                }
            });
        });
    }

    sendReady() {
        this._socket?.emit('ready');
    }

    // =========================================================================
    //  Input relay (hot path)
    // =========================================================================

    /**
     * Send a local input to the relay server for forwarding to the remote player.
     * @param {number} tick            Tick number this input is for
     * @param {object} inputSnapshot   { move, castSlot }
     */
    sendInput(tick, inputSnapshot) {
        this._socket?.volatile.emit('input', { tick, data: inputSnapshot });
        // `.volatile` means Socket.io will drop the packet if the buffer is congested
        // rather than queueing it — matches our rollback model where stale inputs are
        // less valuable than fresh ones.
    }

    // =========================================================================
    //  Event callbacks
    // =========================================================================

    /** Opponent joined the room (lobby phase). */
    onPlayerJoined(cb)         { this._onPlayerJoined = cb; }

    /** Opponent clicked ready (lobby phase). */
    onOpponentReady(cb)        { this._onOpponentReady = cb; }

    /** Both players ready — game starting. Callback receives { seed, playerId, opponentId }. */
    onGameStart(cb)            { this._onGameStart = cb; }

    /** Remote player's input arrived. Callback receives { tick, data }. */
    onRemoteInput(cb)          { this._onRemoteInput = cb; }

    /** Remote player disconnected. */
    onOpponentDisconnected(cb) { this._onOpponentDisconnected = cb; }

    // =========================================================================
    //  Clock sync
    // =========================================================================

    /**
     * Measure RTT with 5 ping-pong samples, take the median.
     * @returns {Promise<number>}  Median RTT in milliseconds.
     */
    async _measureRTT() {
        const samples = [];
        for (let i = 0; i < 5; i++) {
            const start = performance.now();
            await new Promise((resolve) => {
                this._socket.emit('ping_sync', { clientTime: start }, () => resolve());
            });
            samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        this._rtt = samples[Math.floor(samples.length / 2)];
        console.log(`[Net] RTT: ${this._rtt.toFixed(1)}ms (median of ${samples.length} samples)`);
        return this._rtt;
    }
}
