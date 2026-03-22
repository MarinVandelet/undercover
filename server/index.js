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
const DEFAULT_MANCHES = 3;
const MIN_MANCHES = 1;
const MAX_MANCHES = Math.max(1, Math.min(10, WORD_PAIRS.length));
const AVATAR_TTL_MS = 3 * 60 * 60 * 1000;
const CLUE_TURN_DURATION_MS = 25 * 1000;
const DISCONNECT_GRACE_MS = 2 * 60 * 1000;

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
const roomVoteTimers = new Map();
const avatarUploads = new Map();
const sessionToPlayer = new Map();
const sessionToRoom = new Map();
const pendingDisconnectBySession = new Map();

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

function pickRandomDistinct(array, count) {
  const source = [...array];
  const picks = [];
  const safeCount = Math.max(0, Math.min(count, source.length));
  for (let i = 0; i < safeCount; i += 1) {
    const index = Math.floor(Math.random() * source.length);
    picks.push(source[index]);
    source.splice(index, 1);
  }
  return picks;
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

function sanitizeGuessWord(text) {
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

function sanitizeSessionToken(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

function normalizeWordForCompare(word) {
  return String(word || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function isGuessCloseEnough(guess, target) {
  const a = normalizeWordForCompare(guess);
  const b = normalizeWordForCompare(target);
  if (!a || !b) return false;
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  const tolerance = maxLen <= 5 ? 1 : maxLen <= 9 ? 2 : 3;
  return levenshteinDistance(a, b) <= tolerance;
}

function sanitizeDefaultAvatar(avatarUrl) {
  if (typeof avatarUrl !== 'string') return null;
  const clean = avatarUrl.trim();
  return DEFAULT_AVATARS.includes(clean) ? clean : null;
}

function getRandomDefaultAvatar() {
  return pickRandom(DEFAULT_AVATARS);
}

function createPlayer(id, name, defaultAvatarUrl, sessionToken) {
  return {
    id,
    name,
    sessionToken,
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
  return room.turnOrder?.[room.currentTurnIndex] || null;
}

function getAliveIds(room) {
  return room.order.filter((id) => !room.eliminatedIds?.has(id));
}

function getRoleOfPlayer(room, playerId) {
  return room.roleById?.get(playerId) || 'civilian';
}

function reconcileRoleSettings(room) {
  if (!room.enableMisterWhite) {
    room.misterWhiteCountSetting = 0;
  }

  const maxMisterWhite = room.enableMisterWhite ? Math.max(0, room.order.length - 1) : 0;
  room.misterWhiteCountSetting = sanitizeBoundedInt(
    room.misterWhiteCountSetting,
    0,
    maxMisterWhite,
    0
  );

  const maxUndercover = Math.max(0, room.order.length - room.misterWhiteCountSetting - 1);
  room.undercoverCountSetting = sanitizeBoundedInt(
    room.undercoverCountSetting,
    0,
    maxUndercover,
    1
  );

  const maxMisterWhiteAfterUnder = room.enableMisterWhite
    ? Math.max(0, room.order.length - room.undercoverCountSetting - 1)
    : 0;
  room.misterWhiteCountSetting = sanitizeBoundedInt(
    room.misterWhiteCountSetting,
    0,
    maxMisterWhiteAfterUnder,
    room.misterWhiteCountSetting
  );
}

function buildTurnOrder(room) {
  const aliveIds = getAliveIds(room);
  if (aliveIds.length === 0) return [];

  const startScan = room.baseStartIndex || 0;
  const turnOrder = [];
  for (let step = 0; step < room.order.length; step += 1) {
    const index = (startScan + step) % room.order.length;
    const playerId = room.order[index];
    if (!room.eliminatedIds.has(playerId)) {
      turnOrder.push(playerId);
    }
  }
  return turnOrder;
}

function eliminatePlayerWithLover(room, playerId) {
  if (!playerId || room.eliminatedIds.has(playerId)) return [];
  const eliminated = [playerId];
  room.eliminatedIds.add(playerId);

  if (room.loversPair && room.loversPair.includes(playerId)) {
    const partnerId = room.loversPair.find((id) => id !== playerId);
    if (partnerId && !room.eliminatedIds.has(partnerId)) {
      room.eliminatedIds.add(partnerId);
      eliminated.push(partnerId);
    }
  }

  return eliminated;
}

function areOnlyLoversAlive(room) {
  if (!room.loversPair || room.loversPair.length !== 2) return false;
  const aliveIds = getAliveIds(room);
  if (aliveIds.length !== 2) return false;
  return room.loversPair.every((id) => aliveIds.includes(id));
}

function startClueRound(room, incrementRound = true) {
  room.turnOrder = buildTurnOrder(room);
  room.currentTurnIndex = 0;
  room.turnsPlayedInRound = 0;
  room.votes = new Map();
  room.phase = 'clues';
  room.turnStartedAt = Date.now();
  if (incrementRound) {
    room.round += 1;
  }
}

function findWinnerTeam(room) {
  const aliveIds = getAliveIds(room);
  const aliveEvilCount = aliveIds.filter((id) => {
    const role = getRoleOfPlayer(room, id);
    return role === 'undercover' || role === 'misterwhite';
  }).length;
  const aliveCivilianCount = aliveIds.length - aliveEvilCount;

  if (aliveEvilCount === 0) {
    return 'civilians';
  }

  // Evil side wins on strict majority, or in the special 1v1 endgame.
  if (aliveEvilCount > aliveCivilianCount) {
    return 'undercovers';
  }
  if (aliveEvilCount === 1 && aliveCivilianCount === 1) {
    return 'undercovers';
  }

  return null;
}

function clearTurnTimer(roomCode) {
  const existing = roomTurnTimers.get(roomCode);
  if (existing) {
    clearTimeout(existing);
    roomTurnTimers.delete(roomCode);
  }
}

function clearVoteTimer(roomCode) {
  const existing = roomVoteTimers.get(roomCode);
  if (existing) {
    clearTimeout(existing);
    roomVoteTimers.delete(roomCode);
  }
}

function clearPendingDisconnect(sessionToken) {
  if (!sessionToken) return;
  const timer = pendingDisconnectBySession.get(sessionToken);
  if (timer) {
    clearTimeout(timer);
    pendingDisconnectBySession.delete(sessionToken);
  }
}

function replaceIdInArray(items, fromId, toId) {
  return (items || []).map((id) => (id === fromId ? toId : id));
}

function remapPlayerId(room, fromId, toId) {
  if (!room || fromId === toId) return false;
  const player = room.players.get(fromId);
  if (!player) return false;

  room.players.delete(fromId);
  player.id = toId;
  room.players.set(toId, player);
  room.order = replaceIdInArray(room.order, fromId, toId);
  room.turnOrder = replaceIdInArray(room.turnOrder, fromId, toId);

  if (room.hostId === fromId) room.hostId = toId;

  if (room.roleById.has(fromId)) {
    const role = room.roleById.get(fromId);
    room.roleById.delete(fromId);
    room.roleById.set(toId, role);
  }

  if (room.scores.has(fromId)) {
    const score = room.scores.get(fromId);
    room.scores.delete(fromId);
    room.scores.set(toId, score);
  }

  if (room.eliminatedIds.has(fromId)) {
    room.eliminatedIds.delete(fromId);
    room.eliminatedIds.add(toId);
  }

  if (room.votes.has(fromId)) {
    const target = room.votes.get(fromId);
    room.votes.delete(fromId);
    room.votes.set(toId, target);
  }
  for (const [voterId, targetId] of room.votes.entries()) {
    if (targetId === fromId) {
      room.votes.set(voterId, toId);
    }
  }

  if (room.pendingMisterWhiteGuess?.playerId === fromId) {
    room.pendingMisterWhiteGuess.playerId = toId;
  }
  if (room.lastMisterWhiteGuess?.playerId === fromId) {
    room.lastMisterWhiteGuess.playerId = toId;
  }

  if (room.secret) {
    if (room.secret.undercoverId === fromId) {
      room.secret.undercoverId = toId;
    }
    room.secret.undercoverIds = replaceIdInArray(room.secret.undercoverIds, fromId, toId);
  }

  if (room.misterWhiteId === fromId) room.misterWhiteId = toId;
  room.misterWhiteIds = replaceIdInArray(room.misterWhiteIds, fromId, toId);
  room.loversPair = room.loversPair ? replaceIdInArray(room.loversPair, fromId, toId) : null;

  room.clues = room.clues.map((clue) =>
    clue.playerId === fromId ? { ...clue, playerId: toId } : clue
  );

  if (room.result) {
    if (room.result.undercoverId === fromId) room.result.undercoverId = toId;
    if (room.result.misterWhiteId === fromId) room.result.misterWhiteId = toId;
    if (room.result.suspectedId === fromId) room.result.suspectedId = toId;
    room.result.undercoverIds = replaceIdInArray(room.result.undercoverIds || [], fromId, toId);
    room.result.misterWhiteIds = replaceIdInArray(room.result.misterWhiteIds || [], fromId, toId);
    room.result.pointsAwarded = (room.result.pointsAwarded || []).map((award) =>
      award.playerId === fromId ? { ...award, playerId: toId } : award
    );
    room.result.scoreBoard = (room.result.scoreBoard || []).map((score) =>
      score.playerId === fromId ? { ...score, playerId: toId } : score
    );
    room.result.voteBreakdown = (room.result.voteBreakdown || []).map((vote) => ({
      ...vote,
      voterId: vote.voterId === fromId ? toId : vote.voterId,
      targetId: vote.targetId === fromId ? toId : vote.targetId
    }));
  }

  return true;
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

function resolveVoting(room) {
  if (!room || room.phase !== 'voting') return;

  const aliveIds = getAliveIds(room);
  if (room.votes.size !== aliveIds.length) return;

  const tally = new Map();
  for (const votedId of room.votes.values()) {
    tally.set(votedId, (tally.get(votedId) || 0) + 1);
  }

  const topSuspectedIds = [];
  let best = -1;
  for (const [playerId, count] of tally.entries()) {
    if (count > best) {
      best = count;
      topSuspectedIds.length = 0;
      topSuspectedIds.push(playerId);
    } else if (count === best) {
      topSuspectedIds.push(playerId);
    }
  }

  const hasUniqueTop = topSuspectedIds.length === 1;
  const canEliminate = hasUniqueTop && best >= 2;
  if (!canEliminate) {
    room.lastVoteMessage =
      'Personne n\'a ete elimine: aucune personne n\'a eu plus de votes que les autres.';
    startClueRound(room, true);
    clearVoteTimer(room.code);
    scheduleTurnTimer(room);
    emitRoomState(room);
    return;
  }

  const eliminatedId = topSuspectedIds[0] || null;
  const eliminatedIds = eliminatedId ? eliminatePlayerWithLover(room, eliminatedId) : [];
  room.lastVoteMessage = null;
  clearVoteTimer(room.code);

  const eliminatedRole = eliminatedId ? getRoleOfPlayer(room, eliminatedId) : null;
  if (eliminatedId && eliminatedRole === 'misterwhite') {
    room.phase = 'misterwhite_guess';
    room.pendingMisterWhiteGuess = { playerId: eliminatedId };
    room.lastMisterWhiteGuess = null;
    room.turnStartedAt = null;
    emitRoomState(room);
    return;
  }

  const winnerTeam = findWinnerTeam(room);
  if (winnerTeam) {
    concludeGame(room, winnerTeam, eliminatedId, eliminatedIds.length ? eliminatedIds : topSuspectedIds);
  } else {
    startClueRound(room, true);
    scheduleTurnTimer(room);
    emitRoomState(room);
  }
}

function scheduleVoteResolution(room) {
  clearVoteTimer(room.code);
  if (!room || room.phase !== 'voting') return;

  const aliveIds = getAliveIds(room);
  if (room.votes.size !== aliveIds.length) return;

  const timer = setTimeout(() => {
    const liveRoom = rooms.get(room.code);
    if (!liveRoom || liveRoom.phase !== 'voting') return;
    resolveVoting(liveRoom);
  }, 1200);

  roomVoteTimers.set(room.code, timer);
}

function toPublicState(room, requesterId) {
  reconcileRoleSettings(room);
  const players = room.order.map((id) => {
    const p = room.players.get(id);
    return {
      id: p.id,
      name: p.name,
      isHost: room.hostId === id,
      avatarUrl: p.avatar?.url || getRandomDefaultAvatar(),
      score: room.scores.get(id) || 0,
      isAlive: !room.eliminatedIds?.has(id)
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
  const requesterAlive = !room.eliminatedIds?.has(requesterId);
  const canSubmitClue =
    requesterAlive && room.phase === 'clues' && getCurrentSpeakerId(room) === requesterId;
  const canSubmitMisterWhiteGuess =
    room.phase === 'misterwhite_guess'
    && room.pendingMisterWhiteGuess
    && room.pendingMisterWhiteGuess.playerId === requesterId;
  const requester = room.players.get(requesterId);
  const selfLoverId =
    room.loversPair && room.loversPair.includes(requesterId)
      ? room.loversPair.find((id) => id !== requesterId) || null
      : null;
  const selfLoverName = selfLoverId ? room.players.get(selfLoverId)?.name || null : null;
  const requesterRole = getRoleOfPlayer(room, requesterId);
  const selfWord =
    room.phase === 'lobby'
      ? null
      : requesterRole === 'misterwhite'
        ? null
        : requesterRole === 'undercover'
          ? room.secret?.undercoverWord || null
          : room.secret?.civilianWord || null;

  const state = {
    roomCode: room.code,
    phase: room.phase,
    round: room.round,
    totalManches: room.totalManches || DEFAULT_MANCHES,
    currentManche: room.currentManche || 1,
    sessionFinished:
      (room.currentManche || 1) >= (room.totalManches || DEFAULT_MANCHES) && room.phase === 'ended',
    aliveCount: getAliveIds(room).length,
    players,
    clues,
    currentSpeakerId: room.phase === 'clues' ? getCurrentSpeakerId(room) : null,
    clueTurnEndsAt:
      room.phase === 'clues' && room.turnStartedAt
        ? room.turnStartedAt + CLUE_TURN_DURATION_MS
        : null,
    votesCount: room.votes.size,
    requiredVotes: getAliveIds(room).length,
    canStart,
    canSubmitClue,
    canSubmitMisterWhiteGuess,
    isHost,
    enableMisterWhite: Boolean(room.enableMisterWhite),
    enableLovers: Boolean(room.enableLovers),
    undercoverCountSetting: room.undercoverCountSetting ?? 1,
    misterWhiteCountSetting: room.misterWhiteCountSetting ?? 0,
    civilianCountSetting: Math.max(
      0,
      room.order.length - (room.undercoverCountSetting ?? 0) - (room.misterWhiteCountSetting ?? 0)
    ),
    selfIsMisterWhite: Array.isArray(room.misterWhiteIds)
      ? room.misterWhiteIds.includes(requesterId)
      : room.misterWhiteId === requesterId,
    selfWord,
    selfLoverName,
    selfIsAlive: requesterAlive,
    selfId: requesterId,
    hasVoted: requesterAlive ? room.votes.has(requesterId) : false,
    pendingMisterWhiteGuess: room.pendingMisterWhiteGuess
      ? {
          playerId: room.pendingMisterWhiteGuess.playerId,
          playerName: room.players.get(room.pendingMisterWhiteGuess.playerId)?.name || 'Unknown'
        }
      : null,
    lastMisterWhiteGuess: room.lastMisterWhiteGuess || null,
    lastVoteMessage: room.lastVoteMessage || null,
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
  clearVoteTimer(room.code);
  reconcileRoleSettings(room);
  const pair = pickWordPairForRoom(room);
  if (!pair) return false;
  const startIndex = room.nextStartingIndex % room.order.length;
  const firstSpeakerId = room.order[startIndex];
  const assignableIds = [...room.order];
  const requestedUndercoverCount = Math.max(0, Number(room.undercoverCountSetting || 0));
  const requestedMisterWhiteCount = room.enableMisterWhite
    ? Math.max(0, Number(room.misterWhiteCountSetting || 0))
    : 0;

  // Need at least one civilian in game.
  if (requestedUndercoverCount + requestedMisterWhiteCount >= assignableIds.length) {
    return false;
  }

  const misterWhitePool = assignableIds.filter((id) => id !== firstSpeakerId);
  if (requestedMisterWhiteCount > misterWhitePool.length) {
    return false;
  }
  const misterWhiteIds = pickRandomDistinct(misterWhitePool, requestedMisterWhiteCount);
  const undercoverPool = assignableIds.filter((id) => !misterWhiteIds.includes(id));
  const undercoverIds = pickRandomDistinct(undercoverPool, requestedUndercoverCount);
  if (
    undercoverIds.length !== requestedUndercoverCount
    || misterWhiteIds.length !== requestedMisterWhiteCount
  ) {
    return false;
  }

  const loverPool = assignableIds.filter((id) => !misterWhiteIds.includes(id));
  let loversPair = null;
  if (room.enableLovers && loverPool.length >= 2) {
    const firstLover = pickRandom(loverPool);
    const secondOptions = loverPool.filter((id) => id !== firstLover);
    const secondLover = pickRandom(secondOptions);
    loversPair = [firstLover, secondLover];
  }

  room.phase = 'clues';
  room.round = 0;
  room.baseStartIndex = startIndex;
  room.nextStartingIndex = (room.baseStartIndex + 1) % room.order.length;
  room.clues = [];
  room.votes = new Map();
  room.result = null;
  room.turnStartedAt = null;
  room.pendingMisterWhiteGuess = null;
  room.lastMisterWhiteGuess = null;
  room.lastVoteMessage = null;
  room.eliminatedIds = new Set();
  room.roleById = new Map();
  room.secret = {
    civilianWord: pair.civilian,
    undercoverWord: pair.undercover,
    undercoverId: undercoverIds[0] || null,
    undercoverIds
  };
  room.misterWhiteId = misterWhiteIds[0] || null;
  room.misterWhiteIds = misterWhiteIds;
  room.loversPair = loversPair;

  for (const playerId of room.order) {
    const isUndercover = undercoverIds.includes(playerId);
    const isMisterWhite = misterWhiteIds.includes(playerId);
    room.roleById.set(playerId, isMisterWhite ? 'misterwhite' : isUndercover ? 'undercover' : 'civilian');
    const word = isMisterWhite ? null : isUndercover ? pair.undercover : pair.civilian;
    io.to(playerId).emit('game:role', {
      word,
      maxRounds: 1
    });
  }

  startClueRound(room, true);
  scheduleTurnTimer(room);
  emitRoomState(room);
  return true;
}

function applyRoundPoints(room, eliminatedId, winnerTeam) {
  const undercoverIds = Array.isArray(room.secret?.undercoverIds)
    ? room.secret.undercoverIds
    : room.secret?.undercoverId
      ? [room.secret.undercoverId]
      : [];
  const misterWhiteIds = Array.isArray(room.misterWhiteIds)
    ? room.misterWhiteIds
    : room.misterWhiteId
      ? [room.misterWhiteId]
      : [];
  const undercoverSet = new Set(undercoverIds);
  const civilianVotesForEliminatedUndercover = room.order.filter((playerId) => {
    if (undercoverSet.has(playerId)) return false;
    const votedId = room.votes.get(playerId);
    return Boolean(votedId && votedId === eliminatedId && undercoverSet.has(votedId));
  });
  const awards = [];
  const aliveUndercoverIds = undercoverIds.filter((id) => !room.eliminatedIds.has(id));
  const aliveMisterWhiteIds = misterWhiteIds.filter((id) => !room.eliminatedIds.has(id));

  if (eliminatedId && undercoverSet.has(eliminatedId) && civilianVotesForEliminatedUndercover.length > 0) {
    for (const playerId of civilianVotesForEliminatedUndercover) {
      awards.push({
        playerId,
        points: 100,
        reason: 'Undercover demasque et vote'
      });
    }
  } else if (winnerTeam === 'undercovers' && undercoverIds.length > 0) {
    for (const undercoverId of aliveUndercoverIds) {
      awards.push({
        playerId: undercoverId,
        points: 150,
        reason: 'Undercover gagnant'
      });
    }
  }

  if (winnerTeam === 'undercovers' && misterWhiteIds.length > 0) {
    const aliveCivilianCount = room.order.filter((id) => {
      if (room.eliminatedIds.has(id)) return false;
      const role = getRoleOfPlayer(room, id);
      return role === 'civilian';
    }).length;

    if (aliveMisterWhiteIds.length > 0 && aliveCivilianCount === 1) {
      for (const misterWhiteId of aliveMisterWhiteIds) {
        awards.push({
          playerId: misterWhiteId,
          points: 500,
          reason: 'Mister White gagnant (1v1)'
        });
      }
    }

    // If Undercover and Mister White survive together at end,
    // Mister White also gets an endgame win bonus.
    if (aliveCivilianCount === 0 && aliveUndercoverIds.length > 0 && aliveMisterWhiteIds.length > 0) {
      for (const misterWhiteId of aliveMisterWhiteIds) {
        awards.push({
          playerId: misterWhiteId,
          points: 150,
          reason: 'Mister White survivant avec Undercover'
        });
      }
    }
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

function concludeGame(room, winnerTeam, eliminatedId, suspectedIds, extraAwards = []) {
  clearTurnTimer(room.code);
  clearVoteTimer(room.code);
  const undercoverIds = Array.isArray(room.secret?.undercoverIds)
    ? room.secret.undercoverIds
    : room.secret?.undercoverId
      ? [room.secret.undercoverId]
      : [];
  const misterWhiteIds = Array.isArray(room.misterWhiteIds)
    ? room.misterWhiteIds
    : room.misterWhiteId
      ? [room.misterWhiteId]
      : [];
  const undercoverId = undercoverIds[0] || null;
  const misterWhiteId = misterWhiteIds[0] || null;
  const pointsAwarded = [...applyRoundPoints(room, eliminatedId, winnerTeam), ...extraAwards];
  if (areOnlyLoversAlive(room)) {
    for (const loverId of room.loversPair) {
      const previous = room.scores.get(loverId) || 0;
      room.scores.set(loverId, previous + 100);
      pointsAwarded.push({
        playerId: loverId,
        playerName: room.players.get(loverId)?.name || 'Unknown',
        points: 100,
        reason: 'Bonus amoureux survivants',
        totalScore: room.scores.get(loverId) || 0
      });
    }
  }
  const undercoverNames = undercoverIds
    .map((id) => room.players.get(id)?.name || 'Unknown')
    .join(', ');
  const misterWhiteNames = misterWhiteIds
    .map((id) => room.players.get(id)?.name || 'Unknown')
    .join(', ');
  const suspectedName = (suspectedIds || [])
    .map((id) => room.players.get(id)?.name || 'Unknown')
    .join(', ');

  room.phase = 'ended';
  room.result = {
    undercoverId,
    undercoverName: undercoverNames || 'Aucun',
    undercoverIds,
    misterWhiteId,
    misterWhiteName: misterWhiteNames || 'Aucun',
    misterWhiteIds,
    suspectedId: eliminatedId || null,
    suspectedName: suspectedName || null,
    undercoverCaught: winnerTeam === 'civilians',
    winnerTeam,
    civilianWord: room.secret.civilianWord,
    undercoverWord: undercoverIds.length > 0 ? room.secret.undercoverWord : null,
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
  const activeCount = room.turnOrder?.length || 0;
  if (activeCount <= 0) {
    room.phase = 'voting';
    room.currentTurnIndex = 0;
    room.turnsPlayedInRound = 0;
    return;
  }

  room.turnsPlayedInRound = (room.turnsPlayedInRound || 0) + 1;

  if (room.turnsPlayedInRound < activeCount) {
    room.currentTurnIndex = (room.currentTurnIndex + 1) % activeCount;
    return;
  }

  room.round += 1;
  room.turnsPlayedInRound = 0;
  room.phase = 'voting';
  room.currentTurnIndex = 0;
}

function abortGameIfTooFewPlayers(room) {
  if (
    room.order.length < 3
    && (room.phase === 'clues' || room.phase === 'voting' || room.phase === 'misterwhite_guess')
  ) {
    const undercoverIds = Array.isArray(room.secret?.undercoverIds)
      ? room.secret.undercoverIds
      : room.secret?.undercoverId
        ? [room.secret.undercoverId]
        : [];
    const undercoverNames = undercoverIds
      .map((id) => room.players.get(id)?.name || 'Unknown')
      .join(', ');
    const misterWhiteIds = Array.isArray(room.misterWhiteIds)
      ? room.misterWhiteIds
      : room.misterWhiteId
        ? [room.misterWhiteId]
        : [];
    const misterWhiteNames = misterWhiteIds
      .map((id) => room.players.get(id)?.name || 'Unknown')
      .join(', ');
    room.phase = 'ended';
    room.result = {
      undercoverId: undercoverIds[0] || null,
      undercoverName: undercoverNames || null,
      undercoverIds,
      misterWhiteId: misterWhiteIds[0] || null,
      misterWhiteName: misterWhiteNames || null,
      misterWhiteIds,
      suspectedId: null,
      suspectedName: null,
      undercoverCaught: false,
      civilianWord: room.secret?.civilianWord || null,
      undercoverWord: undercoverIds.length > 0 ? room.secret?.undercoverWord || null : null,
      reason: 'Game stopped: not enough players.'
    };
  }
}

function maybeEndIfNoEvilLeft(room) {
  if (!room || (room.phase !== 'clues' && room.phase !== 'voting' && room.phase !== 'misterwhite_guess')) {
    return false;
  }

  const winnerTeam = findWinnerTeam(room);
  if (winnerTeam !== 'civilians') {
    return false;
  }

  concludeGame(room, 'civilians', null, []);
  return true;
}

function scheduleDisconnectCleanup(socketId) {
  const roomCode = playerRoom.get(socketId);
  if (!roomCode) return;

  const room = rooms.get(roomCode);
  if (!room) return;

  const player = room.players.get(socketId);
  const sessionToken = sanitizeSessionToken(player?.sessionToken || '');
  if (!sessionToken) {
    leaveRoom(socketId);
    return;
  }

  clearPendingDisconnect(sessionToken);
  const timer = setTimeout(() => {
    const currentSocketId = sessionToPlayer.get(sessionToken);
    if (currentSocketId) {
      leaveRoom(currentSocketId);
    }
    pendingDisconnectBySession.delete(sessionToken);
  }, DISCONNECT_GRACE_MS);

  pendingDisconnectBySession.set(sessionToken, timer);
}

function leaveRoom(socketId) {
  const roomCode = playerRoom.get(socketId);
  if (!roomCode) return;

  const room = rooms.get(roomCode);
  playerRoom.delete(socketId);
  if (!room) return;

  const leavingPlayer = room.players.get(socketId);
  const leavingSessionToken = sanitizeSessionToken(leavingPlayer?.sessionToken || '');
  clearPendingDisconnect(leavingSessionToken);
  if (leavingSessionToken) {
    sessionToPlayer.delete(leavingSessionToken);
    sessionToRoom.delete(leavingSessionToken);
  }
  removePlayerUpload(leavingPlayer);

  const removedIndex = room.order.indexOf(socketId);
  room.players.delete(socketId);
  room.order = room.order.filter((id) => id !== socketId);
  room.turnOrder = (room.turnOrder || []).filter((id) => id !== socketId);
  room.eliminatedIds.delete(socketId);
  room.roleById.delete(socketId);
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
    clearVoteTimer(roomCode);
    rooms.delete(roomCode);
    return;
  }

  if (removedIndex !== -1) {
    if (room.baseStartIndex > removedIndex) {
      room.baseStartIndex -= 1;
    } else if (room.baseStartIndex >= room.order.length) {
      room.baseStartIndex = 0;
    }
  }

  room.turnsPlayedInRound = Math.max(
    0,
    Math.min(room.turnsPlayedInRound || 0, room.order.length)
  );
  reconcileRoleSettings(room);

  if (room.phase === 'clues') {
    room.turnOrder = buildTurnOrder(room);
    if (room.currentTurnIndex >= room.turnOrder.length) {
      room.currentTurnIndex = 0;
    }
    room.turnStartedAt = Date.now();
    scheduleTurnTimer(room);
  } else {
    clearTurnTimer(room.code);
    if (room.phase !== 'voting') {
      clearVoteTimer(room.code);
    }
  }

  abortGameIfTooFewPlayers(room);
  if (room.phase !== 'ended') {
    maybeEndIfNoEvilLeft(room);
  }
  emitRoomState(room);
}

function deleteRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  clearTurnTimer(roomCode);
  clearVoteTimer(roomCode);

  for (const playerId of room.order) {
    const player = room.players.get(playerId);
    const token = sanitizeSessionToken(player?.sessionToken || '');
    clearPendingDisconnect(token);
    if (token) {
      sessionToPlayer.delete(token);
      sessionToRoom.delete(token);
    }
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
    const sessionToken = sanitizeSessionToken(payload?.sessionToken) || crypto.randomBytes(24).toString('hex');
    const totalManches = sanitizeBoundedInt(payload?.matchCount, MIN_MANCHES, MAX_MANCHES, DEFAULT_MANCHES);

    if (!name) {
      callback({ ok: false, error: 'Invalid name.' });
      return;
    }

    const existingSocketId = sessionToPlayer.get(sessionToken);
    if (existingSocketId) {
      leaveRoom(existingSocketId);
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
      baseStartIndex: 0,
      nextStartingIndex: 0,
      turnOrder: [],
      eliminatedIds: new Set(),
      roleById: new Map(),
      pendingMisterWhiteGuess: null,
      lastMisterWhiteGuess: null,
      lastVoteMessage: null,
      usedWordPairIndexes: new Set(),
      totalManches,
      currentManche: 1,
      turnStartedAt: null,
      turnsPlayedInRound: 0,
      enableMisterWhite: false,
      undercoverCountSetting: 1,
      misterWhiteCountSetting: 0,
      enableLovers: false,
      misterWhiteId: null,
      misterWhiteIds: [],
      loversPair: null
    };

    room.players.set(socket.id, createPlayer(socket.id, name, selectedDefaultAvatar, sessionToken));
    room.scores.set(socket.id, 0);
    room.order.push(socket.id);
    reconcileRoleSettings(room);

    clearPendingDisconnect(sessionToken);
    sessionToPlayer.set(sessionToken, socket.id);
    sessionToRoom.set(sessionToken, code);
    rooms.set(code, room);
    playerRoom.set(socket.id, code);
    socket.join(code);

    emitRoomState(room);
    callback({ ok: true, roomCode: code, playerId: socket.id, sessionToken });
  });

  socket.on('room:join', (payload, callback = () => {}) => {
    const name = sanitizeName(payload?.name);
    const roomCode = sanitizeRoomCode(payload?.roomCode);
    const selectedDefaultAvatar = sanitizeDefaultAvatar(payload?.avatarUrl);
    const sessionToken = sanitizeSessionToken(payload?.sessionToken) || crypto.randomBytes(24).toString('hex');

    if (!name) {
      callback({ ok: false, error: 'Invalid name.' });
      return;
    }

    const existingSocketId = sessionToPlayer.get(sessionToken);
    if (existingSocketId) {
      leaveRoom(existingSocketId);
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

    if (room.order.length >= 10) {
      callback({ ok: false, error: 'Room is full.' });
      return;
    }

    leaveRoom(socket.id);

    room.players.set(socket.id, createPlayer(socket.id, name, selectedDefaultAvatar, sessionToken));
    room.scores.set(socket.id, 0);
    room.order.push(socket.id);
    reconcileRoleSettings(room);
    clearPendingDisconnect(sessionToken);
    sessionToPlayer.set(sessionToken, socket.id);
    sessionToRoom.set(sessionToken, roomCode);
    playerRoom.set(socket.id, roomCode);
    socket.join(roomCode);

    emitRoomState(room);
    callback({ ok: true, roomCode, playerId: socket.id, sessionToken });
  });

  socket.on('room:resume', (payload, callback = () => {}) => {
    const sessionToken = sanitizeSessionToken(payload?.sessionToken);
    if (!sessionToken) {
      callback({ ok: false, error: 'Invalid session token.' });
      return;
    }

    const roomCode = sessionToRoom.get(sessionToken);
    const previousSocketId = sessionToPlayer.get(sessionToken);
    if (!roomCode || !previousSocketId) {
      callback({ ok: false, error: 'No active room for this session.' });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room || !room.players.has(previousSocketId)) {
      sessionToPlayer.delete(sessionToken);
      sessionToRoom.delete(sessionToken);
      callback({ ok: false, error: 'Session expired.' });
      return;
    }

    clearPendingDisconnect(sessionToken);
    if (previousSocketId !== socket.id) {
      remapPlayerId(room, previousSocketId, socket.id);
      playerRoom.delete(previousSocketId);
      playerRoom.set(socket.id, roomCode);
      sessionToPlayer.set(sessionToken, socket.id);
    } else {
      playerRoom.set(socket.id, roomCode);
    }

    socket.join(roomCode);
    emitRoomState(room);
    callback({ ok: true, roomCode, playerId: socket.id, sessionToken });
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
    const started = startGame(room);
    if (!started) {
      callback({ ok: false, error: 'Reglages de roles invalides pour ce nombre de joueurs.' });
      return;
    }
    callback({ ok: true });
  });

  socket.on('room:updateSpecialRoles', (payload, callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: 'Only host can update special roles.' });
      return;
    }

    if (room.phase !== 'lobby') {
      callback({ ok: false, error: 'Special roles can only be changed in lobby.' });
      return;
    }

    if (typeof payload?.enableMisterWhite === 'boolean') {
      room.enableMisterWhite = payload.enableMisterWhite;
    }
    if (typeof payload?.enableLovers === 'boolean') {
      room.enableLovers = payload.enableLovers;
    }
    reconcileRoleSettings(room);

    if (typeof payload?.misterWhiteCount === 'number') {
      room.misterWhiteCountSetting = sanitizeBoundedInt(
        payload.misterWhiteCount,
        0,
        room.enableMisterWhite ? Math.max(0, room.order.length - 1) : 0,
        room.misterWhiteCountSetting
      );
      reconcileRoleSettings(room);
    }

    if (typeof payload?.undercoverCount === 'number') {
      room.undercoverCountSetting = sanitizeBoundedInt(
        payload.undercoverCount,
        0,
        Math.max(0, room.order.length - room.misterWhiteCountSetting - 1),
        room.undercoverCountSetting
      );
      reconcileRoleSettings(room);
    }

    if (typeof payload?.civilianCount === 'number') {
      const maxCivilian = room.order.length;
      const requestedCivilian = sanitizeBoundedInt(payload.civilianCount, 0, maxCivilian, 1);
      const derivedUndercover = room.order.length - room.misterWhiteCountSetting - requestedCivilian;
      room.undercoverCountSetting = sanitizeBoundedInt(
        derivedUndercover,
        0,
        Math.max(0, room.order.length - room.misterWhiteCountSetting - 1),
        room.undercoverCountSetting
      );
      reconcileRoleSettings(room);
    }

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

    if (room.eliminatedIds.has(socket.id)) {
      callback({ ok: false, error: 'Eliminated players cannot submit clues.' });
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

    if (room.eliminatedIds.has(socket.id)) {
      callback({ ok: false, error: 'Eliminated players cannot vote.' });
      return;
    }

    const targetId = payload?.targetId;
    if (!room.players.has(targetId) || room.eliminatedIds.has(targetId)) {
      callback({ ok: false, error: 'Invalid target.' });
      return;
    }

    if (targetId === socket.id) {
      callback({ ok: false, error: 'Cannot vote yourself.' });
      return;
    }

    room.votes.set(socket.id, targetId);

    const aliveIds = getAliveIds(room);
    if (room.votes.size === aliveIds.length) {
      scheduleVoteResolution(room);
    } else {
      clearVoteTimer(room.code);
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
    room.turnsPlayedInRound = 0;
    room.votes = new Map();
    room.lastVoteMessage = null;
    clearVoteTimer(room.code);
    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on('game:misterWhiteGuess', (payload, callback = () => {}) => {
    const roomCode = playerRoom.get(socket.id);
    const room = rooms.get(roomCode);

    if (!room) {
      callback({ ok: false, error: 'Room not found.' });
      return;
    }

    if (room.phase !== 'misterwhite_guess') {
      callback({ ok: false, error: 'Not mister white guess phase.' });
      return;
    }

    if (!room.pendingMisterWhiteGuess || room.pendingMisterWhiteGuess.playerId !== socket.id) {
      callback({ ok: false, error: 'Only eliminated mister white can guess.' });
      return;
    }

    const guess = sanitizeGuessWord(payload?.word);
    if (!guess) {
      callback({ ok: false, error: 'Invalid word guess.' });
      return;
    }

    const targetWord = room.secret?.civilianWord || '';
    const correct = isGuessCloseEnough(guess, targetWord);
    const bonusAwards = [];
    if (correct) {
      const previous = room.scores.get(socket.id) || 0;
      room.scores.set(socket.id, previous + 300);
      bonusAwards.push({
        playerId: socket.id,
        playerName: room.players.get(socket.id)?.name || 'Unknown',
        points: 300,
        reason: 'Mister White trouve le mot',
        totalScore: room.scores.get(socket.id) || 0
      });
    }

    room.lastMisterWhiteGuess = {
      playerId: socket.id,
      guess,
      correct,
      targetWord
    };
    room.pendingMisterWhiteGuess = null;
    room.lastVoteMessage = null;

    if (correct) {
      concludeGame(room, 'undercovers', socket.id, [socket.id], bonusAwards);
      callback({ ok: true });
      return;
    }

    const winnerTeam = findWinnerTeam(room);
    if (winnerTeam) {
      concludeGame(room, winnerTeam, socket.id, [socket.id], bonusAwards);
    } else {
      startClueRound(room, true);
      scheduleTurnTimer(room);
      emitRoomState(room);
    }

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
    const started = startGame(room);
    if (!started) {
      callback({ ok: false, error: 'Reglages de roles invalides pour ce nombre de joueurs.' });
      return;
    }
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
    room.turnsPlayedInRound = 0;
    room.turnOrder = [];
    room.eliminatedIds = new Set();
    room.roleById = new Map();
    room.pendingMisterWhiteGuess = null;
    room.lastMisterWhiteGuess = null;
    room.lastVoteMessage = null;
    room.currentManche = room.currentManche >= room.totalManches ? 1 : room.currentManche + 1;
    room.misterWhiteId = null;
    room.misterWhiteIds = [];
    room.loversPair = null;
    clearTurnTimer(room.code);
    clearVoteTimer(room.code);

    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on('disconnect', () => {
    scheduleDisconnectCleanup(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Undercover server running on http://localhost:${PORT}`);
});
