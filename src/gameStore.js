const { v4: uuidv4 } = require('uuid');
const { query } = require('./db');

async function recordCompletedGame({
  userId,
  playersJson,
  movesJson,
  result,
  reason,
  metadataJson,
  startedAt,
  finishedAt,
  winner,
}) {
  if (!userId) {
    throw new Error('userId is required to record a completed game');
  }

  const id = uuidv4();
  await query(
    `INSERT INTO games (
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
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      userId,
      playersJson || JSON.stringify({}),
      movesJson || JSON.stringify([]),
      result || null,
      reason || null,
      metadataJson || null,
      startedAt || null,
      finishedAt || null,
      winner || null,
    ]
  );

  return {
    id,
    userId,
    result,
    reason,
    winner,
    startedAt,
    finishedAt,
  };
}

async function listGamesForUser(userId, { limit = 100 } = {}) {
  if (!userId) return [];
  const result = await query(
    `SELECT id, result, reason, winner, started_at, finished_at
     FROM games
     WHERE user_id = $1
     ORDER BY finished_at DESC NULLS LAST
     LIMIT $2`,
    [userId, Math.max(1, Math.min(500, Number(limit) || 100))]
  );

  return result.rows.map((row) => ({
    id: row.id,
    result: row.result,
    reason: row.reason,
    winner: row.winner,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
}

async function clearGamesForUser(userId) {
  if (!userId) return;
  await query('DELETE FROM games WHERE user_id = $1', [userId]);
}

module.exports = {
  recordCompletedGame,
  listGamesForUser,
  clearGamesForUser,
};
