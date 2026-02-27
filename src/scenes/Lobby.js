/**
 * Lobby.js — Room creation / joining, ready handshake, then launch Game.
 *
 * Flow:
 *   1. Player chooses Create or Join (or Solo for offline testing)
 *   2. On join: room code exchange, wait for opponent
 *   3. Both players click Ready → server broadcasts game_start
 *   4. Lobby passes { seed, localPlayerId, remotePlayerId, networkManager }
 *      to the Game scene via scene data.
 */

import { NetworkManager } from '../network/NetworkManager.js';

/**
 * Relay server URL.
 * In production, set window.RELAY_SERVER_URL before the game boots,
 * or edit this fallback to point at your deployed server.
 */
const SERVER_URL = window.RELAY_SERVER_URL || 'http://localhost:3000';

export class Lobby extends Phaser.Scene {
    constructor() {
        super('Lobby');
    }

    create() {
        this._net        = null;
        this._state      = 'menu';    // menu | connecting | waiting | joined | ready
        this._roomCode   = null;
        this._isHost     = false;
        this._localReady = false;
        this._remoteReady = false;

        // ── dark background ─────────────────────────────────────────────
        this.add.rectangle(640, 360, 1280, 720, 0x05050f);

        this.add.text(640, 60, 'TestCardGame', {
            fontSize: '48px', color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5);

        this.add.text(640, 110, 'Multiplayer Lobby', {
            fontSize: '22px', color: '#7788bb',
        }).setOrigin(0.5);

        // ── status text (updates throughout flow) ───────────────────────
        this._statusText = this.add.text(640, 300, '', {
            fontSize: '18px', color: '#aabbcc', align: 'center',
        }).setOrigin(0.5);

        this._codeText = this.add.text(640, 360, '', {
            fontSize: '48px', color: '#ffffff', fontStyle: 'bold', align: 'center',
        }).setOrigin(0.5);

        this._errorText = this.add.text(640, 440, '', {
            fontSize: '16px', color: '#ff6666', align: 'center',
        }).setOrigin(0.5);

        // ── menu buttons ────────────────────────────────────────────────
        this._soloBtn   = this._makeButton(640, 220, '  Solo Play  ', () => this._startSolo());
        this._createBtn = this._makeButton(640, 300, '  Create Room  ', () => this._createRoom());
        this._joinBtn   = this._makeButton(640, 380, '  Join Room  ', () => this._promptJoin());
        this._backBtn   = this._makeButton(100, 680, '  Back  ', () => this._goBack(), '14px');
        this._backBtn.setVisible(false);

        // ── ready button (hidden until both players in room) ────────────
        this._readyBtn = this._makeButton(640, 520, '  Ready  ', () => this._sendReady());
        this._readyBtn.setVisible(false);

        // ── join input (hidden by default) ──────────────────────────────
        this._joinInput     = null;  // DOM element, created on demand
        this._joinInputText = '';
    }

    // =========================================================================
    //  UI helpers
    // =========================================================================

    _makeButton(x, y, label, onClick, size = '24px') {
        const btn = this.add.text(x, y, label, {
            fontSize        : size,
            color           : '#ffffff',
            backgroundColor : '#1a1a4a',
            padding         : { x: 18, y: 10 },
        }).setOrigin(0.5).setInteractive();
        btn.input.cursor = 'pointer';
        btn.on('pointerdown', onClick);
        btn.on('pointerover', () => btn.setStyle({ color: '#aaaaff' }));
        btn.on('pointerout',  () => btn.setStyle({ color: '#ffffff' }));
        return btn;
    }

    _showMenu(visible) {
        this._soloBtn.setVisible(visible);
        this._createBtn.setVisible(visible);
        this._joinBtn.setVisible(visible);
    }

    _setStatus(text) { this._statusText.setText(text); }
    _setCode(text)   { this._codeText.setText(text); }
    _setError(text)  { this._errorText.setText(text); }

    // =========================================================================
    //  Solo
    // =========================================================================

    _startSolo() {
        this.scene.start('Game', { mode: 'solo' });
    }

    // =========================================================================
    //  Create Room
    // =========================================================================

    async _createRoom() {
        this._showMenu(false);
        this._setStatus('Connecting to server...');
        this._setError('');
        this._backBtn.setVisible(true);

        try {
            this._net = new NetworkManager();
            await this._net.connect(SERVER_URL);

            const { code, playerId } = await this._net.createRoom();
            this._roomCode = code;
            this._isHost   = true;

            this._setStatus('Share this room code with your opponent:');
            this._setCode(code);
            this._state = 'waiting';

            this._wireNetEvents();
        } catch (err) {
            this._setError(`Error: ${err.message}`);
            this._showMenu(true);
            this._backBtn.setVisible(false);
        }
    }

    // =========================================================================
    //  Join Room
    // =========================================================================

    _promptJoin() {
        this._showMenu(false);
        this._setStatus('Enter 4-character room code:');
        this._setError('');
        this._backBtn.setVisible(true);
        this._state = 'joining';

        // Use Phaser text + keyboard listener for code entry
        this._joinInputText = '';
        this._codeText.setText('____');

        // Listen for keyboard
        this._joinKeyHandler = (event) => {
            const key = event.key.toUpperCase();
            if (/^[A-Z0-9]$/.test(key) && this._joinInputText.length < 4) {
                this._joinInputText += key;
                const display = this._joinInputText.padEnd(4, '_');
                this._codeText.setText(display);

                if (this._joinInputText.length === 4) {
                    this._doJoin(this._joinInputText);
                }
            } else if (key === 'BACKSPACE' && this._joinInputText.length > 0) {
                this._joinInputText = this._joinInputText.slice(0, -1);
                const display = this._joinInputText.padEnd(4, '_');
                this._codeText.setText(display);
            }
        };
        window.addEventListener('keydown', this._joinKeyHandler);
    }

    async _doJoin(code) {
        // Stop listening for code input
        if (this._joinKeyHandler) {
            window.removeEventListener('keydown', this._joinKeyHandler);
            this._joinKeyHandler = null;
        }

        this._setStatus('Connecting...');
        this._setCode(code);

        try {
            this._net = new NetworkManager();
            await this._net.connect(SERVER_URL);

            const { playerId } = await this._net.joinRoom(code);
            this._roomCode = code;
            this._isHost   = false;

            this._setStatus(`Joined room ${code} — waiting for host to ready up...`);
            this._state = 'joined';

            this._wireNetEvents();

            // Both players are in the room — show Ready button
            this._readyBtn.setVisible(true);
        } catch (err) {
            this._setError(`Error: ${err.message}`);
            this._setStatus('Enter 4-character room code:');
            this._joinInputText = '';
            this._codeText.setText('____');
            // Re-listen
            window.addEventListener('keydown', this._joinKeyHandler);
        }
    }

    // =========================================================================
    //  Network events (wired after connecting)
    // =========================================================================

    _wireNetEvents() {
        this._net.onPlayerJoined(() => {
            this._setStatus(`Opponent joined room ${this._roomCode}!`);
            this._state = 'joined';
            this._readyBtn.setVisible(true);
        });

        this._net.onOpponentReady(() => {
            this._remoteReady = true;
            this._setStatus('Opponent is ready!');
            if (this._localReady) {
                // Both ready — game_start will fire shortly
                this._setStatus('Starting game...');
            }
        });

        this._net.onGameStart(({ seed, playerId, opponentId }) => {
            // Clean up and transition to Game scene with multiplayer config
            this._cleanup();
            this.scene.start('Game', {
                mode:           'online',
                seed,
                localPlayerId:  playerId,
                remotePlayerId: opponentId,
                networkManager: this._net,
            });
        });

        this._net.onOpponentDisconnected(() => {
            this._setError('Opponent disconnected.');
            this._readyBtn.setVisible(false);
            this._state = 'waiting';
            this._localReady  = false;
            this._remoteReady = false;
        });
    }

    // =========================================================================
    //  Ready
    // =========================================================================

    _sendReady() {
        if (this._localReady) return;
        this._localReady = true;
        this._net.sendReady();

        this._readyBtn.setVisible(false);
        this._setStatus(this._remoteReady
            ? 'Starting game...'
            : 'Waiting for opponent to ready up...'
        );
    }

    // =========================================================================
    //  Back / cleanup
    // =========================================================================

    _goBack() {
        this._cleanup();
        this.scene.start('Lobby');
    }

    _cleanup() {
        if (this._joinKeyHandler) {
            window.removeEventListener('keydown', this._joinKeyHandler);
            this._joinKeyHandler = null;
        }
    }

    // Cleanup on scene shutdown (e.g. scene.start navigates away)
    shutdown() {
        this._cleanup();
    }
}
