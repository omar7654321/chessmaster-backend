const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');

function mapGameRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    players: JSON.parse(row.players_json || '[]'),
    moves: JSON.parse(row.moves_json || '[]'),
    result: row.result,
    reason: row.reason,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    winner: row.winner,
  };
}

function recordCompletedGame({
  userId,
  players = [],
  moves = [],
  result = null,
  reason = null,
  metadata = {},
  startedAt = null,
  finishedAt = null,
  winner = null,
  id = uuidv4(),
}) {
  if (!userId) {
    throw new Error('userId is required to record a completed game');
  }
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO games (
      id,
      user_id,
      players_json,
      moves_json,
      result,
      reason,
      metadata_json,
      started_at,
      finished_at,
      winner
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    userId,
    JSON.stringify(players).slice(0, 20000),
    JSON.stringify(moves).slice(0, 50000),
    result,
    reason,
    JSON.stringify(metadata || {}),
    startedAt,
    finishedAt || new Date().toISOString(),
    winner
  );

  return mapGameRow({
    id,
    user_id: userId,
    players_json: JSON.stringify(players),
    moves_json: JSON.stringify(moves),
    result,
    reason,
    metadata_json: JSON.stringify(metadata || {}),
    started_at: startedAt,
    finished_at: finishedAt || new Date().toISOString(),
    winner,
  });
}

function clearGamesForUser(userId) {
  if (!userId) return;
  const db = getDb();
  const stmt = db.prepare('DELETE FROM games WHERE user_id = ?');
  stmt.run(userId);
}

function listGamesForUser(userId, { limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM games
    WHERE user_id = ?
    ORDER BY finished_at DESC
    LIMIT ? OFFSET ?
  `);
  const rows = stmt.all(userId, limit, offset);
  return rows.map(mapGameRow);
}

module.exports = {
  recordCompletedGame,
  clearGamesForUser,
  listGamesForUser,
  mapGameRow,
};
