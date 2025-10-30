const { query } = require('./db');

async function recordPuzzleAttempt({
  userId,
  puzzleId,
  solved,
  streakDelta,
  ratingDelta,
  ratingAfter,
  attemptedAt,
}) {
  if (!userId) {
    throw new Error('userId is required to record puzzle history');
  }
  if (!puzzleId) {
    throw new Error('puzzleId is required to record puzzle history');
  }

  await query(
    `INSERT INTO puzzle_history (
      user_id,
      puzzle_id,
      solved,
      streak_delta,
      rating_delta,
      rating_after,
      attempted_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)`
      ,
    [
      userId,
      puzzleId,
      solved ? 1 : 0,
      Number.isFinite(streakDelta) ? streakDelta : 0,
      Number.isFinite(ratingDelta) ? ratingDelta : 0,
      Number.isFinite(ratingAfter) ? ratingAfter : null,
      attemptedAt || new Date().toISOString(),
    ]
  );
}

async function listPuzzleHistory(userId, { limit = 100 } = {}) {
  if (!userId) return [];
  const result = await query(
    `SELECT puzzle_id, solved, streak_delta, rating_delta, rating_after, attempted_at
     FROM puzzle_history
     WHERE user_id = $1
     ORDER BY attempted_at DESC
     LIMIT $2`,
    [userId, Math.max(1, Math.min(500, Number(limit) || 100))]
  );

  return result.rows.map((row) => ({
    puzzleId: row.puzzle_id,
    solved: !!row.solved,
    streakDelta: row.streak_delta,
    ratingDelta: row.rating_delta,
    ratingAfter: row.rating_after,
    attemptedAt: row.attempted_at,
  }));
}

async function clearPuzzleHistory(userId) {
  if (!userId) return;
  await query('DELETE FROM puzzle_history WHERE user_id = $1', [userId]);
}

module.exports = {
  recordPuzzleAttempt,
  listPuzzleHistory,
  clearPuzzleHistory,
};
