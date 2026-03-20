const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Server } = require('socket.io');
const { WORD_PAIRS } = require('./words');

const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '');
const API_PREFIX = `${BASE_PATH}/api`;
const SOCKET_PATH = `${BASE_PATH}/socket.io`;
const DEFAULT_WORD_ROUNDS = 3;
const MIN_WORD_ROUNDS = 1;
const MAX_WORD_ROUNDS = 8;
const DEFAULT_MANCHES = 3;
const MIN_MANCHES = 1;
const MAX_MANCHES = Math.max(1, Math.min(10, WORD_PAIRS.length));
const AVATAR_TTL_MS = 3 * 60 * 60 * 1000;
const CLUE_TURN_DURATION_MS = 25 * 1000;

function normalizeBasePath(input) {
  const raw = String(input || '').trim();
  if (!raw || raw === '/') return '';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.replace(/\/+$/, '');
}

function withBasePath(pathname) {
  if (!BASE_PATH) return pathname;
  return `${BASE_PATH}${pathname}`;
}

const DEFAULT_AVATARS = [
  withBasePath('/avatars/user (1).png'),
  withBasePath('/avatars/user (2).png'),
  withBasePath('/avatars/user (3).png'),
  withBasePath('/avatars/user (4).png'),
  withBasePath('/avatars/user (5).png'),
  withBasePath('/avatars/user (6).png'),
  withBasePath('/avatars/user (7).png'),
  withBasePath('/avatars/user (8).png'),
  withBasePath('/avatars/user (9).png'),
  withBasePath('/avatars/user (10).png'),
  withBasePath('/avatars/user (11).png')
];

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  path: SOCKET_PATH,
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST']
  }
});

const rooms = new Map();
const playerRoom = new Map();
const roomTurnTimers = new Map();
const avatarUploads = new Map();

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!String(file.mimetype || '').startsWith('image/')) {
      cb(new Error('Format image non supporte.'));
      return;
    }
    cb(null, true);
  }
});

function createRoomCode() {
  if (rooms.size >= 10000) {
    return null;
  }

  let attempts = 0;
  while (attempts < 12000) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!rooms.has(code)) {
      return code;
    }
    attempts += 1;
  }

  for (let i = 0; i < 10000; i += 1) {
    const code = String(i).padStart(4, '0');
    if (!rooms.has(code)) {
      return code;
    }
  }

  return null;
}

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function pickWordPairForRoom(room) {
  if (!room.usedWordPairIndexes) {
    room.usedWordPairIndexes = new Set();
  }

  const totalPairs = WORD_PAIRS.length;
  if (totalPairs === 0) {
    return null;
  }

  const availableIndexes = [];
  for (let i = 0; i < totalPairs; i += 1) {
    if (!room.usedWordPairIndexes.has(i)) {
      availableIndexes.push(i);
    }
  }

  if (availableIndexes.length === 0) {
    return null;
  }

  const index = pickRandom(availableIndexes);
  room.usedWordPairIndexes.add(index);
  return WORD_PAIRS[index];
}

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').slice(0, 18);
}

function sanitizeRoomCode(roomCode) {
  if (typeof roomCode !== 'string') return '';
  return roomCode.replace(/\D/g, '').slice(0, 4);
}

function sanitizeClue(text) {
  if (typeof text !== 'string') return '';
  return text.trim().replace(/\s+/g, ' ').slice(0, 80);
}

function sanitizeBoundedInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function sanitizeDefaultAvatar(avatarUrl) {
  if (typeof avatarUrl !== 'string') return null;
  const clean = avatarUrl.trim();
  return DEFAULT_AVATARS.includes(clean) ? clean : null;
}

function getRandomDefaultAvatar() {
  return pickRandom(DEFAULT_AVATARS);
}

function createPlayer(id, name, defaultAvatarUrl) {
  return {
    id,
    name,
    avatar: {
      type: 'default',
      url: defaultAvatarUrl || getRandomDefaultAvatar(),
      expiresAt: null
    }
  };
}

function setPlayerDefaultAvatar(player) {
  if (player.avatar?.uploadToken) {
    avatarUploads.delete(player.avatar.uploadToken);
  }
  player.avatar = {
    type: 'default',
    url: getRandomDefaultAvatar(),
    expiresAt: null,
    uploadToken: null
  };
}

function setPlayerUploadedAvatar(player, file) {
  if (player.avatar?.uploadToken) {
    avatarUploads.delete(player.avatar.uploadToken);
  }
  const uploadToken = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const expiresAt = Date.now() + AVATAR_TTL_MS;
  avatarUploads.set(uploadToken, {
    buffer: file.buffer,
    mimetype: file.mimetype,
    expiresAt
  });

  player.avatar = {
    type: 'upload',
    url: `${API_PREFIX}/avatar/${uploadToken}`,
    expiresAt,
    uploadToken
  };
}

function removePlayerUpload(player) {
  if (!player || player.avatar?.type !== 'upload') return;
  if (player.avatar.uploadToken) {
    avatarUploads.delete(player.avatar.uploadToken);
  }
}

function getCurrentSpeakerId(room) {
  return room.order[room.currentTurnIndex] || null;
}

function clearTurnTimer(roomCode) {
  const existing = roomTurnTimers.get(roomCode);
  if (existing) {
    clearTimeout(existing);
    roomTurnTimers.delete(roomCode);
  }
}

function scheduleTurnTimer(room) {
  clearTurnTimer(room.code);
  if (room.phase !== 'clues') return;

  const speakerId = getCurrentSpeakerId(room);
  if (!speakerId) return;

  const timer = setTimeout(() => {
    const liveRoom = rooms.get(room.code);
    if (!liveRoom || liveRoom.phase !== 'clues') return;

    const liveSpeaker = getCurrentSpeakerId(liveRoom);
    if (!liveSpeaker) return;

    // If a player does not submit in time, we auto-submit a placeholder and move on.
    liveRoom.clues.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      round: liveRoom.round,
      playerId: liveSpeaker,
      text: '(pas d indice)'
    });

    advanceTurn(liveRoom);
    if (liveRoom.phase === 'clues') {
      liveRoom.turnStartedAt = Date.now();
      scheduleTurnTimer(liveRoom);
    } else {
      clearTurnTimer(liveRoom.code);
    }

    emitRoomState(liveRoom);
  }, CLUE_TURN_DURATION_MS);

  roomTurnTimers.set(room.code, timer);
}

function toPublicState(room, requesterId) {
  const players = room.order.map((id) => {
    const p = room.players.get(id);
    return {
      id: p.id,
      name: p.name,
      isHost: room.hostId === id,
      avatarUrl: p.avatar?.url || getRandomDefaultAvatar(),
      score: room.scores.get(id) || 0
    };
  });

  const clues = room.clues.map((clue) => ({
    id: clue.id,
    round: clue.round,
    playerId: clue.playerId,
    playerName: room.players.get(clue.playerId)?.name || 'Unknown',
    text: clue.text
  }));

  const isHost = requesterId === room.hostId;
  const canStart = room.phase === 'lobby' && isHost && room.order.length >= 3;
  const canSubmitClue = room.phase === 'clues' && getCurrentSpeakerId(room) === requesterId;
  const requester = room.players.get(requesterId);

  const state = {
    roomCode: room.code,
    phase: room.phase,
    round: room.round,
    maxRounds: room.wordRounds || DEFAULT_WORD_ROUNDS,
    totalManches: room.totalManches || DEFAULT_MANCHES,
    currentManche: room.currentManche || 1,
    sessionFinished:
      (room.currentManche || 1) >= (room.totalManches || DEFAULT_MANCHES) && room.phase === 'ended',
    wordRounds: room.wordRounds || DEFAULT_WORD_ROUNDS,
    players,
    clues,
    currentSpeakerId: room.phase === 'clues' ? getCurrentSpeakerId(room) : null,
    clueTurnEndsAt:
      room.phase === 'clues' && room.turnStartedAt
        ? room.turnStartedAt + CLUE_TURN_DURATION_MS
        : null,
    votesCount: room.votes.size,
    requiredVotes: room.order.length,
    canStart,
    canSubmitClue,
    isHost,
    selfId: requesterId,
    hasVoted: room.votes.has(requesterId),
    selfAvatarExpiresAt: requester?.avatar?.type === 'upload' ? requester.avatar.expiresAt : null,
    canNextManche:
      room.phase === 'ended' &&
      isHost &&
      (room.currentManche || 1) < (room.totalManches || DEFAULT_MANCHES)
  };

  if (room.phase === 'ended' && room.result) {
    state.result = room.result;
  }

  return state;
}

function emitRoomState(room) {
  for (const playerId of room.order) {
    io.to(playerId).emit('room:update', toPublicState(room, playerId));
  }
}

function startGame(room) {
  const pair = pickWordPairForRoom(room);
  if (!pair) return false;
  const undercoverId = pickRandom(room.order);

  room.phase = 'clues';
  room.round = 1;
  room.currentTurnIndex = 0;
  room.clues = [];
  room.votes = new Map();
  room.result = null;
  room.turnStartedAt = Date.now();
  room.secret = {
    civilianWord: pair.civilian,
    undercoverWord: pair.undercover,
    undercoverId
  };

  for (const playerId of room.order) {
    const word = playerId === undercoverId ? pair.undercover : pair.civilian;
    io.to(playerId).emit('game:role', {
      word,
      maxRounds: room.wordRounds
    });
  }

  scheduleTurnTimer(room);
  emitRoomState(room);
  return true;
}

function applyRoundPoints(room, suspectedId, undercoverCaught) {
  const undercoverId = room.secret.undercoverId;
  const awards = [];

  if (undercoverCaught && suspectedId === undercoverId) {
    for (const playerId of room.order) {
      if (playerId === undercoverId) continue;
      if (room.votes.get(playerId) !== undercoverId) continue;
      awards.push({
        playerId,
        points: 100,
        reason: 'Undercover demasque et vote'
      });
    }
  } else if (undercoverId) {
    awards.push({
      playerId: undercoverId,
      points: 150,
      reason: 'Undercover gagnant'
    });
  }

  for (const award of awards) {
    const previous = room.scores.get(award.playerId) || 0;
    room.scores.set(award.playerId, previous + award.points);
  }

  return awards.map((award) => ({
    ...award,
    playerName: room.players.get(award.playerId)?.name || 'Unknown',
    totalScore: room.scores.get(award.playerId) || 0
  }));
}

function concludeGame(room) {
  clearTurnTimer(room.code);
  const tally = new Map();
  for (const targetId of room.votes.values()) {
    tally.set(targetId, (tally.get(targetId) || 0) + 1);
  }

  let suspectedId = null;
  let best = -1;
  for (const [playerId, count] of tally.entries()) {
    if (count > best) {
      best = count;
      suspectedId = playerId;
    }
  }

  const undercoverId = room.secret.undercoverId;
  const undercoverCaught = suspectedId === undercoverId;
  const pointsAwarded = applyRoundPoints(room, suspectedId, undercoverCaught);

  room.phase = 'ended';
  room.result = {
    undercoverId,
    undercoverName: room.players.get(undercoverId)?.name || 'Unknown',
    suspectedId,
    suspectedName: suspectedId ? room.players.get(suspectedId)?.name || 'Unknown' : null,
    undercoverCaught,
    civilianWord: room.secret.civilianWord,
    undercoverWord: room.secret.undercoverWord,
    pointsAwarded,
    scoreBoard: room.order.map((id) => ({
      playerId: id,
      playerName: room.players.get(id)?.name || 'Unknown',
      score: room.scores.get(id) || 0
    })),
    voteBreakdown: room.order.map((id) => ({
      voterId: id,
      voterName: room.players.get(id)?.name || 'Unknown',
      targetId: room.votes.get(id) || null,
      targetName: room.players.get(room.votes.get(id) || '')?.name || null
    }))
  };

  emitRoomState(room);
}

function advanceTurn(room) {
  if (room.currentTurnIndex < room.order.length - 1) {
    room.currentTurnIndex += 1;
    return;
  }

  room.currentTurnIndex = 0;
  room.round += 1;

  if (room.round > room.wordRounds) {
    room.phase = 'voting';
  }
}

function abortGameIfTooFewPlayers(room) {
  if (room.order.length < 3 && (room.phase === 'clues' || room.phase === 'voting')) {
    room.phase = 'ended';
    room.result = {
      undercoverId: room.secret?.undercoverId || null,
      undercoverName: room.secret?.undercoverId ? room.players.get(room.secret.undercoverId)?.name || 'Unknown' : null,
      suspectedId: null,
      suspectedName: null,
      undercoverCaught: false,
      civilianWord: room.secret?.civilianWord || null,
      undercoverWord: room.secret?.undercoverWord || null,
      reason: 'Game stopped: not enough players.'
    };
  }
}

function leaveRoom(socketId) {
  const roomCode = playerRoom.get(socketId);
  if (!roomCode) return;

  const room = rooms.get(roomCode);
  playerRoom.delete(socketId);
  if (!room) return;

  const leavingPlayer = room.players.get(socketId);
  removePlayerUpload(leavingPlayer);

  room.players.delete(socketId);
  room.order = room.order.filter((id) => id !== socketId);
  room.scores.delete(socketId);
  room.votes.delete(socketId);

  for (const [voterId, targetId] of room.votes.entries()) {
    if (targetId === socketId) {
      room.votes.delete(voterId);
    }
  }

  if (room.hostId === socketId) {
    room.hostId = room.order[0] || null;
  }

  if (room.order.length === 0) {
    clearTurnTimer(roomCode);
    rooms.delete(roomCode);
    return;
  }

  if (room.phase === 'clues') {
    room.turnStartedAt = Date.now();
    scheduleTurnTimer(room);
  } else {
    clearTurnTimer(room.code);
  }

  abortGameIfTooFewPlayers(room);
  emitRoomState(room);
}

function deleteRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  clearTurnTimer(roomCode);

  for (const playerId of room.order) {
    const player = room.players.get(playerId);
    removePlayerUpload(player);
    playerRoom.delete(playerId);
    io.to(playerId).emit('room:deleted');
    io.sockets.sockets.get(playerId)?.leave(roomCode);
  }

  rooms.delete(roomCode);
}

function cleanupExpiredAvatars() {
  const now = Date.now();
  const changedRooms = [];

  for (const room of rooms.values()) {
    let roomChanged = false;
    for (const playerId of room.order) {
      const player = room.players.get(playerId);
      if (!player || player.avatar?.type !== 'upload') continue;
      if (!player.avatar.expiresAt || player.avatar.expiresAt > now) continue;
      setPlayerDefaultAvatar(player);
      roomChanged = true;
    }

    if (roomChanged) {
      changedRooms.push(room);
    }
  }

  for (const room of changedRooms) {
    emitRoomState(room);
  }
}

setInterval(cleanupExpiredAvatars, 60 * 1000).unref();

app.get(`${API_PREFIX}/health`, (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.get(`${API_PREFIX}/avatar/:token`, (req, res) => {
  const token = String(req.params.token || '');
  const entry = avatarUploads.get(token);
  if (!entry) {
    res.status(404).end();
    return;
  }

  if (entry.expiresAt <= Date.now()) {
    avatarUploads.delete(token);
    res.status(404).end();
    return;
  }

  res.setHeader('Content-Type', entry.mimetype);
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.send(entry.buffer);
});

app.post(`${API_PREFIX}/avatar/upload`, uploadAvatar.single('avatar'), (req, res) => {
  const socketId = typeof req.body?.socketId === 'string' ? req.body.socketId : '';
  const roomCode = playerRoom.get(socketId);
  const room = rooms.get(roomCode);

  if (!room) {
    res.status(400).json({ ok: false, error: 'Player not in room.' });
    return;
  }

  const player = room.players.get(socketId);
  if (!player) {
    res.status(400).json({ ok: false, error: 'Player not found.' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ ok: false, error: 'No file sent.' });
    return;
  }

  removePlayerUpload(player);
  setPlayerUploadedAvatar(player, req.file);
  emitRoomState(room);

  res.json({
    ok: true,
    avatarUrl: player.avatar.url,
    expiresAt: player.avatar.expiresAt
  });
});

app.use((error, _req, res, next) => {
  if (error && error.message && error.message.includes('Format image')) {
    res.status(400).json({ ok: false, error: error.message });
    return;
  }

  if (error && error.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ ok: false, error: 'Image too large (max 3MB).' });
    return;
  }

  next(error);
});

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (BASE_PATH) {
  app.use(BASE_PATH, express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || !req.path.startsWith(BASE_PATH)) {
      next();
      return;
    }

    if (req.path.startsWith(API_PREFIX) || req.path.startsWith(SOCKET_PATH)) {
      next();
      return;
    }

    res.sendFile(path.join(clientDist, 'index.html'), (error) => {
      if (error) {
        next();
      }
    });
  });
} else {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET') {
      next();
      return;
    }

    if (req.path.startsWith(API_PREFIX) || req.path.startsWith(SOCKET_PATH)) {
      next();
      return;
    }

    res.sendFile(path.join(clientDist, 'index.html'), (error) => {
      if (error) {
        next();
      }
    });
  });
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload, callback = () => {}) => {
    const name = sanitizeName(payload?.name);
    const selectedDefaultAvatar = sanitizeDefaultAvatar(payload?.avatarUrl);
    const totalManches = sanitizeBoundedInt(payload?.matchCount, MIN_MANCHES, MAX_MANCHES, DEFAULT_MANCHES);

    if (!name) {
      callback({ ok: false, error: 'Invalid name.' });
      return;
    }

    leaveRoom(socket.id);

    const code = createRoomCode();
    if (!code) {
      callback({ ok: false, error: 'No room code available.' });
      return;
    }
    const room = {
      code,
      hostId: socket.id,
      phase: 'lobby',
      round: 0,
      currentTurnIndex: 0,
      players: new Map(),
      scores: new Map(),
      order: [],
      clues: [],
      votes: new Map(),
      secret: null,
      result: null,
      usedWordPairIndexes: new Set(),
      totalManches,
      currentManche: 1,
      wordRounds: DEFAULT_WORD_ROUNDS,
      turnStartedAt: null
    };

    room.players.set(socket.id, createPlayer(socket.id, name, selectedDefaultAvatar));
    room.scores.set(socket.id, 0);
    room.order.push(socket.id);

    rooms.set(code, room);
    playerRoom.set(socket.id, code);
    socket.join(code);

    emitRoomState(room);
    callback({ ok: true, roomCode: code, playerId: socket.id });
  });

  socket.on('room:join', (payload, callback = () => {}) => {
    const name = sanitizeName(payload?.name);
    const roomCode = sanitizeRoomCode(payload?.roomCode);
    const selectedDefaultAvatar = sanitizeDefaultAvatar(payload?.avatarUrl);

    if (!name) {
      callback({ ok: false, error: 'Invalid name.' });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.phase !== 'lobby') {
      callback({ ok: false, error: 'Game already started.' });
      return;
    }

    if (room.order.length >= 12) {
      callback({ ok: false, error: 'Room is full.' });
      return;
    }

    leaveRoom(socket.id);

    room.players.set(socket.id, createPlayer(socket.id, name, selectedDefaultAvatar));
    room.scores.set(socket.id, 0);
    room.order.push(socket.id);
    playerRoom.set(socket.id, roomCode);
    socket.join(roomCode);

    emitRoomState(room);
    callback({ ok: true, roomCode, playerId: socket.id });
  });

  socket.on('game:start', (callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: 'Only host can start.' });
      return;
    }

    if (room.phase !== 'lobby') {
      callback({ ok: false, error: 'Game already running.' });
      return;
    }

    if (room.order.length < 3) {
      callback({ ok: false, error: 'At least 3 players required.' });
      return;
    }

    room.usedWordPairIndexes = new Set();
    startGame(room);
    callback({ ok: true });
  });

  socket.on('room:updateWordRounds', (payload, callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: 'Only host can update rounds.' });
      return;
    }

    if (room.phase !== 'lobby') {
      callback({ ok: false, error: 'Rounds can only be changed in lobby.' });
      return;
    }

    room.wordRounds = sanitizeBoundedInt(
      payload?.wordRounds,
      MIN_WORD_ROUNDS,
      MAX_WORD_ROUNDS,
      DEFAULT_WORD_ROUNDS
    );
    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on('room:updateMatchCount', (payload, callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: 'Only host can update match count.' });
      return;
    }

    if (room.phase !== 'lobby') {
      callback({ ok: false, error: 'Match count can only be changed in lobby.' });
      return;
    }

    room.totalManches = sanitizeBoundedInt(
      payload?.matchCount,
      MIN_MANCHES,
      MAX_MANCHES,
      DEFAULT_MANCHES
    );

    if (room.currentManche > room.totalManches) {
      room.currentManche = 1;
    }

    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on('room:leave', (callback = () => {}) => {
    leaveRoom(socket.id);
    callback({ ok: true });
  });

  socket.on('room:delete', (callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: 'Only host can delete room.' });
      return;
    }

    deleteRoom(roomCode);
    callback({ ok: true });
  });

  socket.on('avatar:randomize', (callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    const player = room.players.get(socket.id);
    if (!player) {
      callback({ ok: false, error: 'Player not found.' });
      return;
    }

    setPlayerDefaultAvatar(player);
    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on('game:clue', (payload, callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.phase !== 'clues') {
      callback({ ok: false, error: 'Not clue phase.' });
      return;
    }

    if (getCurrentSpeakerId(room) !== socket.id) {
      callback({ ok: false, error: 'Not your turn.' });
      return;
    }

    const text = sanitizeClue(payload?.text);
    if (!text) {
      callback({ ok: false, error: 'Invalid clue.' });
      return;
    }

    room.clues.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      round: room.round,
      playerId: socket.id,
      text
    });

    advanceTurn(room);
    if (room.phase === 'clues') {
      room.turnStartedAt = Date.now();
      scheduleTurnTimer(room);
    } else {
      clearTurnTimer(room.code);
    }
    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on('game:vote', (payload, callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.phase !== 'voting') {
      callback({ ok: false, error: 'Not voting phase.' });
      return;
    }

    const targetId = payload?.targetId;
    if (!room.players.has(targetId)) {
      callback({ ok: false, error: 'Invalid target.' });
      return;
    }

    if (targetId === socket.id) {
      callback({ ok: false, error: 'Cannot vote yourself.' });
      return;
    }

    room.votes.set(socket.id, targetId);

    if (room.votes.size === room.order.length) {
      concludeGame(room);
    } else {
      emitRoomState(room);
    }

    callback({ ok: true });
  });

  socket.on('game:forceVoting', (callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: 'Only host can force voting.' });
      return;
    }

    if (room.phase !== 'clues') {
      callback({ ok: false, error: 'Can only force voting from clues.' });
      return;
    }

    clearTurnTimer(room.code);
    room.phase = 'voting';
    room.currentTurnIndex = 0;
    room.turnStartedAt = null;
    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on('game:nextManche', (callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: 'Only host can start next manche.' });
      return;
    }

    if (room.phase !== 'ended') {
      callback({ ok: false, error: 'Current manche is not finished.' });
      return;
    }

    if ((room.currentManche || 1) >= (room.totalManches || DEFAULT_MANCHES)) {
      callback({ ok: false, error: 'Session already finished.' });
      return;
    }

    room.currentManche += 1;
    startGame(room);
    callback({ ok: true });
  });

  socket.on('game:backToLobby', (callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: 'Only host can reset.' });
      return;
    }

    room.phase = 'lobby';
    room.round = 0;
    room.currentTurnIndex = 0;
    room.clues = [];
    room.votes = new Map();
    room.secret = null;
    room.result = null;
    room.usedWordPairIndexes = new Set();
    room.turnStartedAt = null;
    room.currentManche = room.currentManche >= room.totalManches ? 1 : room.currentManche + 1;
    clearTurnTimer(room.code);

    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on('disconnect', () => {
    leaveRoom(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Undercover server running on http://localhost:${PORT}`);
});
