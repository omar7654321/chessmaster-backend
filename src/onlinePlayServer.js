const { WebSocketServer } = require('ws');
const { Chess } = require('chess.js');
const { v4: uuidv4 } = require('uuid');

const LOBBIES = new Map(); // gameId -> lobby
const PLAYERS = new Map(); // playerId -> player

const GAME_ID_LENGTH = 8;
const PING_INTERVAL_MS = 30_000;
const PONG_GRACE_MS = 10_000;

function createLogger(prefix) {
  return {
    info: (...args) => console.log(`[online] [${prefix}]`, ...args),
    warn: (...args) => console.warn(`[online] [${prefix}]`, ...args),
    error: (...args) => console.error(`[online] [${prefix}]`, ...args),
  };
}

const log = createLogger('core');

function generateGameId() {
  return uuidv4().replace(/-/g, '').slice(0, GAME_ID_LENGTH).toUpperCase();
}

function getPlayer(ws) {
  if (!ws || !ws.__playerId) return null;
  return PLAYERS.get(ws.__playerId) || null;
}

function serializeMessage(payload = {}) {
  return JSON.stringify(payload);
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try {
    ws.send(serializeMessage(payload));
  } catch (err) {
    log.warn('Failed to send message', err?.message || err);
  }
}

function sendToPlayer(player, payload) {
  if (!player) return;
  safeSend(player.ws, payload);
}

function broadcastToLobby(lobby, payload, { excludePlayerId = undefined } = {}) {
  if (!lobby) return;
  [lobby.host, lobby.guest]
    .filter(Boolean)
    .filter((player) => excludePlayerId === undefined || player.playerId !== excludePlayerId)
    .forEach((player) => sendToPlayer(player, payload));
}

function getPlayerName(player) {
  if (!player) return null;
  return player.username || `Player-${player.playerId.slice(0, 4).toUpperCase()}`;
}

function getOpponentColor(color) {
  return color === 'white' ? 'black' : 'white';
}

function createLobby(host, preferredColor) {
  const color = ['white', 'black'].includes(preferredColor)
    ? preferredColor
    : (Math.random() < 0.5 ? 'white' : 'black');
  const gameId = generateGameId();
  const chess = new Chess();

  const lobby = {
    gameId,
    createdAt: new Date().toISOString(),
    host,
    guest: null,
    chess,
    status: 'waiting',
    moves: [],
  };

  host.gameId = gameId;
  host.color = color;
  host.ws && safeSend(host.ws, {
    type: 'created',
    gameId,
    color,
  });

  LOBBIES.set(gameId, lobby);
  log.info('Lobby created', { gameId, host: host.playerId, color });
  return lobby;
}

function startGame(lobby) {
  if (!lobby || !lobby.host || !lobby.guest) return;
  lobby.status = 'active';
  lobby.chess.reset();
  lobby.moves.length = 0;

  const fen = lobby.chess.fen();
  const turn = lobby.chess.turn() === 'w' ? 'white' : 'black';

  const payload = {
    type: 'start',
    gameId: lobby.gameId,
    fen,
    turn,
    white: {
      playerId: lobby.host.color === 'white' ? lobby.host.playerId : lobby.guest.playerId,
      name: lobby.host.color === 'white' ? getPlayerName(lobby.host) : getPlayerName(lobby.guest),
    },
    black: {
      playerId: lobby.host.color === 'black' ? lobby.host.playerId : lobby.guest.playerId,
      name: lobby.host.color === 'black' ? getPlayerName(lobby.host) : getPlayerName(lobby.guest),
    },
  };

  sendToPlayer(lobby.host, { ...payload, color: lobby.host.color });
  sendToPlayer(lobby.guest, { ...payload, color: lobby.guest.color });

  log.info('Game started', { gameId: lobby.gameId });
}

function finalizeGame(lobby, result, reason) {
  if (!lobby) return;
  if (lobby.status === 'completed') return;

  lobby.status = 'completed';
  lobby.completedAt = new Date().toISOString();
  lobby.result = result;
  lobby.resultReason = reason;

  broadcastToLobby(lobby, {
    type: 'game_over',
    gameId: lobby.gameId,
    result,
    reason,
  });

  const participants = [lobby.host, lobby.guest].filter(Boolean);
  participants.forEach((player) => {
    player.gameId = null;
    player.color = null;
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
  });

  lobby.host = null;
  lobby.guest = null;
  LOBBIES.delete(lobby.gameId);

  log.info('Game completed', { gameId: lobby.gameId, result, reason });
}

function removePlayerFromLobby(player) {
  if (!player || !player.gameId) return;
  const lobby = LOBBIES.get(player.gameId);
  if (!lobby) {
    player.gameId = null;
    player.color = null;
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    return;
  }

  if (lobby.host?.playerId === player.playerId) {
    lobby.host = null;
  }
  if (lobby.guest?.playerId === player.playerId) {
    lobby.guest = null;
  }

  player.gameId = null;
  player.color = null;
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }

  if (!lobby.host && !lobby.guest) {
    LOBBIES.delete(lobby.gameId);
    log.info('Lobby removed (empty)', { gameId: lobby.gameId });
  } else {
    lobby.status = 'waiting';
  }
}

function handleHello(ws, payload = {}) {
  const { playerId: requestedPlayerId, userId, username, gameId } = payload;

  let player = null;
  if (requestedPlayerId && PLAYERS.has(requestedPlayerId)) {
    player = PLAYERS.get(requestedPlayerId);
    player.ws = ws;
    player.lastPongAt = Date.now();
    player.awaitingPong = false;
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    if (username) player.username = username;
    if (userId) player.userId = userId;
    ws.__playerId = player.playerId;
    log.info('Player reconnected', { playerId: player.playerId, gameId: player.gameId });
  } else {
    const newPlayerId = uuidv4();
    player = {
      playerId: newPlayerId,
      ws,
      userId: userId || null,
      username: username || null,
      createdAt: new Date().toISOString(),
      lastPongAt: Date.now(),
      awaitingPong: false,
      gameId: null,
      color: null,
      disconnectTimer: null,
    };
    ws.__playerId = newPlayerId;
    PLAYERS.set(newPlayerId, player);
    log.info('Player connected', { playerId: newPlayerId });
  }

  safeSend(ws, {
    type: 'hello',
    playerId: player.playerId,
  });

  if (gameId && player.gameId === gameId) {
    const lobby = LOBBIES.get(gameId);
    if (lobby) {
      const fen = lobby.chess.fen();
      const turn = lobby.chess.turn() === 'w' ? 'white' : 'black';
      sendToPlayer(player, {
        type: 'resume',
        gameId,
        fen,
        turn,
        color: player.color,
        moves: lobby.moves.slice(),
        result: lobby.result || null,
        reason: lobby.resultReason || null,
      });
    }
  }
}

function handleCreate(ws, payload = {}) {
  const player = getPlayer(ws);
  if (!player) {
    safeSend(ws, { type: 'error', code: 'NOT_IDENTIFIED', msg: 'Send hello first' });
    return;
  }
  if (player.gameId) {
    safeSend(ws, { type: 'error', code: 'ALREADY_IN_GAME', msg: 'Leave current game before creating a new one' });
    return;
  }

  createLobby(player, payload.color);
}

function attachPlayerToLobby(lobby, player) {
  if (!lobby || !player) return;

  const hostColor = lobby.host.color;
  const guestColor = getOpponentColor(hostColor);

  player.gameId = lobby.gameId;
  player.color = guestColor;
  lobby.guest = player;

  log.info('Player joined lobby', { gameId: lobby.gameId, playerId: player.playerId, color: guestColor });
  startGame(lobby);
}

function handleJoin(ws, payload = {}) {
  const player = getPlayer(ws);
  if (!player) {
    safeSend(ws, { type: 'error', code: 'NOT_IDENTIFIED', msg: 'Send hello first' });
    return;
  }
  if (player.gameId) {
    safeSend(ws, { type: 'error', code: 'ALREADY_IN_GAME', msg: 'Leave current game before joining another' });
    return;
  }

  const { gameId } = payload;
  if (!gameId || typeof gameId !== 'string') {
    safeSend(ws, { type: 'error', code: 'INVALID_GAME_ID', msg: 'gameId is required to join a lobby' });
    return;
  }

  const lobby = LOBBIES.get(gameId);
  if (!lobby) {
    safeSend(ws, { type: 'error', code: 'GAME_NOT_FOUND', msg: 'Lobby not found' });
    return;
  }
  if (lobby.status !== 'waiting' || lobby.guest) {
    safeSend(ws, { type: 'error', code: 'LOBBY_FULL', msg: 'Lobby already has two players' });
    return;
  }

  attachPlayerToLobby(lobby, player);
}

function validateMovePayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return false;
  if (!payload.gameId) return false;
  if (!payload.playerId) return false;
  if (!payload.san && !payload.uci) return false;
  return true;
}

function resolveUciFromMove(move) {
  if (!move) return null;
  return `${move.from}${move.to}${move.promotion ? move.promotion : ''}`;
}

function determineGameOutcome(chessInstance, moverColor) {
  if (chessInstance.isCheckmate()) {
    return {
      result: moverColor === 'white' ? '1-0' : '0-1',
      reason: 'checkmate',
    };
  }
  if (chessInstance.isStalemate()) {
    return { result: '1/2-1/2', reason: 'stalemate' };
  }
  if (chessInstance.isThreefoldRepetition()) {
    return { result: '1/2-1/2', reason: 'threefold' };
  }
  if (chessInstance.isInsufficientMaterial()) {
    return { result: '1/2-1/2', reason: 'insufficient_material' };
  }
  if (chessInstance.isDraw()) {
    return { result: '1/2-1/2', reason: 'draw' };
  }
  return null;
}

function handleMove(ws, payload = {}) {
  if (!validateMovePayload(payload)) {
    safeSend(ws, { type: 'error', code: 'INVALID_PAYLOAD', msg: 'Invalid move payload' });
    return;
  }

  const { gameId, uci, playerId } = payload;
  const player = getPlayer(ws);
  if (!player || player.playerId !== playerId) {
    safeSend(ws, { type: 'error', code: 'PLAYER_MISMATCH', msg: 'Player not recognized for move' });
    return;
  }

  if (!player.gameId) {
    safeSend(ws, { type: 'error', code: 'NOT_IN_GAME', msg: 'Player not seated in a game' });
    return;
  }

  if (player.gameId !== gameId) {
    safeSend(ws, { type: 'error', code: 'NOT_IN_GAME', msg: 'Player not seated in this game' });
    return;
  }

  const lobby = LOBBIES.get(player.gameId);
  if (!lobby || lobby.status !== 'active') {
    safeSend(ws, { type: 'error', code: 'INVALID_LOBBY', msg: 'Game not found or not active' });
    return;
  }

  log.info('Move request', { gameId, playerId: player.playerId, uci });

  const moverColor = player.color;
  const chess = lobby.chess;
  const turn = chess.turn() === 'w' ? 'white' : 'black';
  if (moverColor !== turn) {
    safeSend(ws, { type: 'error', code: 'WRONG_TURN', msg: 'Not your turn' });
    return;
  }

  let moveResult = null;
  try {
    moveResult = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
  } catch (err) {
    moveResult = null;
  }

  if (!moveResult) {
    log.warn('Illegal move rejected', { gameId, playerId: player.playerId, uci });
    safeSend(ws, { type: 'error', code: 'ILLEGAL_MOVE', msg: 'Illegal move' });
    return;
  }

  lobby.moves.push({
    playerId: player.playerId,
    uci,
    fenAfter: chess.fen(),
    timestamp: Date.now(),
  });

  const fenAfter = chess.fen();
  const nextTurn = chess.turn() === 'w' ? 'white' : 'black';

  log.info('Move applied', {
    gameId,
    playerId: player.playerId,
    uci,
    fenAfter,
    nextTurn,
  });

  broadcastToLobby(lobby, {
    type: 'move',
    gameId,
    playerId: player.playerId,
    uci,
    fen: fenAfter,
    turn: nextTurn,
  });

  const outcome = determineGameOutcome(chess, moverColor);
  if (outcome) {
    finalizeGame(lobby, outcome.result, outcome.reason);
  }
}

function handleResign(ws, payload = {}) {
  const player = getPlayer(ws);
  if (!player) {
    safeSend(ws, { type: 'error', code: 'NOT_IDENTIFIED', msg: 'Send hello first' });
    return;
  }
  const { gameId } = payload;
  if (!gameId) {
    safeSend(ws, { type: 'error', code: 'INVALID_GAME_ID', msg: 'gameId is required' });
    return;
  }
  const lobby = LOBBIES.get(gameId);
  if (!lobby) {
    safeSend(ws, { type: 'error', code: 'GAME_NOT_FOUND', msg: 'Game not available' });
    return;
  }
  if (player.gameId !== lobby.gameId) {
    safeSend(ws, { type: 'error', code: 'NOT_IN_GAME', msg: 'Player not seated in this game' });
    return;
  }
  const result = player.color === 'white' ? '0-1' : '1-0';
  finalizeGame(lobby, result, 'resign');
}

function handleLeave(ws, payload = {}) {
  const player = getPlayer(ws);
  if (!player) {
    safeSend(ws, { type: 'error', code: 'NOT_IDENTIFIED', msg: 'Send hello first' });
    return;
  }

  if (!player.gameId) {
    safeSend(ws, { type: 'left', gameId: null });
    return;
  }

  const lobby = LOBBIES.get(player.gameId);
  if (!lobby) {
    player.gameId = null;
    player.color = null;
    safeSend(ws, { type: 'left', gameId: null });
    return;
  }

  const { gameId } = lobby;

  if (lobby.status === 'active') {
    const result = player.color === 'white' ? '0-1' : '1-0';
    finalizeGame(lobby, result, 'left');
  } else {
    broadcastToLobby(lobby, {
      type: 'opponent_disconnect',
      gameId,
      playerId: player.playerId,
    }, { excludePlayerId: player.playerId });
    removePlayerFromLobby(player);
  }

  safeSend(ws, {
    type: 'left',
    gameId,
  });
  log.info('Player left lobby', { playerId: player.playerId, gameId });
}

function handlePong(ws) {
  const player = getPlayer(ws);
  if (!player) return;
  player.lastPongAt = Date.now();
  player.awaitingPong = false;
}

function handleDisconnect(ws) {
  const player = getPlayer(ws);
  if (!player) return;

  player.ws = null;
  player.awaitingPong = false;

  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
  }

  player.disconnectTimer = setTimeout(() => {
    if (player.ws) return;
    if (!player.gameId) return;
    const lobby = LOBBIES.get(player.gameId);
    if (!lobby) {
      player.gameId = null;
      player.color = null;
      return;
    }
    if (lobby.status === 'active') {
      const result = player.color === 'white' ? '0-1' : '1-0';
      finalizeGame(lobby, result, 'disconnect_timeout');
    } else {
      removePlayerFromLobby(player);
    }
  }, 60_000);

  const lobby = player.gameId ? LOBBIES.get(player.gameId) : null;
  if (lobby && lobby.status === 'active') {
    broadcastToLobby(lobby, {
      type: 'opponent_disconnect',
      gameId: lobby.gameId,
      playerId: player.playerId,
    }, { excludePlayerId: player.playerId });
  }

  log.info('Player disconnected', { playerId: player.playerId, gameId: player.gameId });
}

function handleMessage(ws, message) {
  let payload = null;
  try {
    payload = JSON.parse(message);
  } catch (err) {
    safeSend(ws, { type: 'error', code: 'INVALID_JSON', msg: 'Message must be valid JSON' });
    return;
  }

  const { type } = payload || {};
  switch (type) {
    case 'hello':
      handleHello(ws, payload);
      break;
    case 'create':
      handleCreate(ws, payload);
      break;
    case 'join':
      handleJoin(ws, payload);
      break;
    case 'move':
      handleMove(ws, payload);
      break;
    case 'resign':
      handleResign(ws, payload);
      break;
    case 'leave':
      handleLeave(ws, payload);
      break;
    case 'pong':
      handlePong(ws);
      break;
    default:
      safeSend(ws, { type: 'error', code: 'UNKNOWN_TYPE', msg: `Unknown message type: ${type}` });
      break;
  }
}

function scheduleCleanup() {
  const now = Date.now();
  const stalePlayers = [];
  PLAYERS.forEach((player) => {
    if (!player.ws && !player.gameId && now - new Date(player.createdAt).getTime() > 60 * 60 * 1000) {
      stalePlayers.push(player.playerId);
    }
  });
  stalePlayers.forEach((playerId) => PLAYERS.delete(playerId));
}

function initOnlinePlayServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  log.info('WebSocket server mounted on /ws');

  wss.on('connection', (ws) => {
    ws.__playerId = null;
    ws.on('message', (raw) => handleMessage(ws, raw));
    ws.on('close', () => handleDisconnect(ws));
    ws.on('error', (err) => {
      log.warn('WebSocket error', err?.message || err);
      handleDisconnect(ws);
    });
  });

  const pingTimer = setInterval(() => {
    wss.clients.forEach((client) => {
      const player = getPlayer(client);
      if (!player) return;
      const now = Date.now();
      if (player.awaitingPong && player.lastPingAt && now - player.lastPingAt > PONG_GRACE_MS) {
        log.warn('Terminating unresponsive client', { playerId: player.playerId });
        client.terminate();
        return;
      }
      try {
        safeSend(client, { type: 'ping' });
        player.awaitingPong = true;
        player.lastPingAt = now;
      } catch (err) {
        log.warn('Failed to ping client', err?.message || err);
      }
    });

    scheduleCleanup();
  }, PING_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(pingTimer);
    log.info('WebSocket server closed');
  });

  return wss;
}

module.exports = {
  initOnlinePlayServer,
};
