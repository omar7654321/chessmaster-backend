const { v4: uuidv4 } = require('uuid');

const games = new Map();
const completedGames = [];
const MAX_COMPLETED_GAMES = 200;

function createGame({ timeControl = null, metadata = {} } = {}) {
  const id = uuidv4();
  const game = {
    id,
    createdAt: new Date().toISOString(),
    status: 'waiting',
    players: [],
    moves: [],
    timeControl,
    metadata,
  };
  games.set(id, game);
  return game;
}

function getGame(id) {
  if (!id) return null;
  return games.get(id) || null;
}

function joinGame(id, player) {
  const game = games.get(id);
  if (!game) {
    throw new Error('Game not found');
  }
  if (game.players.length >= 2) {
    throw new Error('Game already has two players');
  }
  game.players.push({ ...player, joinedAt: new Date().toISOString() });
  if (game.players.length === 2) {
    game.status = 'active';
  }
  return game;
}

function listGames() {
  return Array.from(games.values());
}

function recordCompletedGame(entry = {}) {
  const record = {
    id: entry.id || uuidv4(),
    startedAt: entry.startedAt || entry.createdAt || null,
    finishedAt: entry.finishedAt || new Date().toISOString(),
    result: entry.result || 'unknown',
    reason: entry.reason || null,
    status: entry.status || 'completed',
    winner: entry.winner || null,
    players: Array.isArray(entry.players) ? entry.players.slice(0, 4) : [],
    moves: Array.isArray(entry.moves) ? entry.moves.slice(0, 1024) : [],
    metadata: typeof entry.metadata === 'object' && entry.metadata !== null
      ? { ...entry.metadata }
      : {},
  };

  completedGames.push(record);
  if (completedGames.length > MAX_COMPLETED_GAMES) {
    completedGames.splice(0, completedGames.length - MAX_COMPLETED_GAMES);
  }

  return record;
}

function listCompletedGames() {
  return completedGames.slice().reverse();
}

function clearCompletedGames() {
  completedGames.length = 0;
}

module.exports = {
  createGame,
  getGame,
  joinGame,
  listGames,
  recordCompletedGame,
  listCompletedGames,
  clearCompletedGames,
};
