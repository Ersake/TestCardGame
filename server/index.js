/**
 * index.js — Thin relay server for TestCardGame.
 *
 * Responsibilities:
 *   1. Room management (create / join / leave, max 2 players per room)
 *   2. Ready handshake → game_start broadcast with shared seed
 *   3. Input relay — forward stamped input packets to the other player
 *   4. Clock sync — respond to ping with server timestamp for RTT measurement
 *   5. Disconnect notification
 *
 * NO game logic runs here.  The server never inspects input contents.
 *
 * Usage:
 *   cd server && npm install && npm start
 *   Server listens on PORT (default 3000).
 */

import { createServer } from 'http';
import { Server }       from 'socket.io';

const PORT = process.env.PORT || 3000;

// ─── Room storage ────────────────────────────────────────────────────────────

/**
 * rooms: Map<string, {
 *   code:    string,
 *   players: Array<{ socket, id: 'p1'|'p2', ready: boolean }>,
 *   seed:    number,
 *   started: boolean,
 * }>
 */
const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  // no ambiguous chars
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    // Avoid collisions
    return rooms.has(code) ? generateRoomCode() : code;
}

function findRoomBySocket(socket) {
    for (const room of rooms.values()) {
        for (const p of room.players) {
            if (p.socket === socket) return { room, player: p };
        }
    }
    return null;
}

function getOpponent(room, playerId) {
    return room.players.find(p => p.id !== playerId) ?? null;
}

function removePlayerFromRoom(room, socket) {
    room.players = room.players.filter(p => p.socket !== socket);
    if (room.players.length === 0) {
        rooms.delete(room.code);
    }
}

// ─── HTTP + Socket.io server ─────────────────────────────────────────────────

const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: '*',           // permissive for local dev; lock down in production
        methods: ['GET', 'POST'],
    },
});

io.on('connection', (socket) => {
    console.log(`[Connect] ${socket.id}`);

    // ── Create room ────────────────────────────────────────────────────────
    socket.on('create_room', (_, ack) => {
        const code = generateRoomCode();
        const seed = (Math.random() * 0xFFFFFFFF) >>> 0;

        const room = {
            code,
            players: [{ socket, id: 'p1', ready: false }],
            seed,
            started: false,
        };
        rooms.set(code, room);
        socket.join(code);

        console.log(`[Room] ${socket.id} created room ${code}`);
        if (typeof ack === 'function') {
            ack({ ok: true, code, playerId: 'p1' });
        }
    });

    // ── Join room ──────────────────────────────────────────────────────────
    socket.on('join_room', (data, ack) => {
        const code = (data?.code ?? '').toUpperCase().trim();
        const room = rooms.get(code);

        if (!room) {
            if (typeof ack === 'function') ack({ ok: false, reason: 'Room not found.' });
            return;
        }
        if (room.players.length >= 2) {
            if (typeof ack === 'function') ack({ ok: false, reason: 'Room is full.' });
            return;
        }
        if (room.started) {
            if (typeof ack === 'function') ack({ ok: false, reason: 'Game already in progress.' });
            return;
        }

        room.players.push({ socket, id: 'p2', ready: false });
        socket.join(code);

        console.log(`[Room] ${socket.id} joined room ${code}`);

        // Notify the creator that an opponent joined
        const creator = room.players.find(p => p.id === 'p1');
        if (creator) creator.socket.emit('player_joined', { playerId: 'p2' });

        if (typeof ack === 'function') {
            ack({ ok: true, code, playerId: 'p2' });
        }
    });

    // ── Ready ──────────────────────────────────────────────────────────────
    socket.on('ready', () => {
        const found = findRoomBySocket(socket);
        if (!found) return;
        const { room, player } = found;

        player.ready = true;
        console.log(`[Room ${room.code}] ${player.id} is ready`);

        // Notify opponent
        const opp = getOpponent(room, player.id);
        if (opp) opp.socket.emit('opponent_ready');

        // If both ready, start the game
        if (room.players.length === 2 && room.players.every(p => p.ready) && !room.started) {
            room.started = true;
            console.log(`[Room ${room.code}] Game starting (seed: ${room.seed})`);

            for (const p of room.players) {
                p.socket.emit('game_start', {
                    seed:       room.seed,
                    playerId:   p.id,
                    opponentId: p.id === 'p1' ? 'p2' : 'p1',
                });
            }
        }
    });

    // ── Input relay (hot path) ─────────────────────────────────────────────
    socket.on('input', (data) => {
        const found = findRoomBySocket(socket);
        if (!found) return;
        const { room, player } = found;
        const opp = getOpponent(room, player.id);
        if (opp) {
            opp.socket.emit('remote_input', data);
        }
    });

    // ── Clock sync ─────────────────────────────────────────────────────────
    socket.on('ping_sync', (data, ack) => {
        if (typeof ack === 'function') {
            ack({ serverTime: Date.now(), clientTime: data?.clientTime });
        }
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
        console.log(`[Disconnect] ${socket.id}`);
        const found = findRoomBySocket(socket);
        if (!found) return;
        const { room, player } = found;

        // Notify opponent
        const opp = getOpponent(room, player.id);
        if (opp) opp.socket.emit('opponent_disconnected');

        removePlayerFromRoom(room, socket);
    });
});

// ─── Start ───────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
    console.log(`Relay server listening on http://localhost:${PORT}`);
});
