const { getDb } = require('./db');

function recordPuzzleAttempt({
  userId,
  puzzleId,
  solved,
  streakDelta,
  ratingDelta,
  ratingAfter,
  attemptedAt = new Date().toISOString(),
}) {
  if (!userId || !puzzleId) {
    throw new Error('userId and puzzleId are required');
  }
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO puzzle_history (
      user_id,
      puzzle_id,
      solved,
      streak_delta,
      rating_delta,
      attempted_at,
      rating_after
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const normalizedRatingAfter = Number.isFinite(ratingAfter) ? Math.round(ratingAfter) : null;
  stmt.run(userId, puzzleId, solved ? 1 : 0, streakDelta, ratingDelta, attemptedAt, normalizedRatingAfter);
}

function listPuzzleHistory(userId, { limit = 200, offset = 0 } = {}) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM puzzle_history
    WHERE user_id = ?
    ORDER BY attempted_at DESC
    LIMIT ? OFFSET ?
  `);
  const rows = stmt.all(userId, limit, offset);
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    puzzleId: row.puzzle_id,
    solved: !!row.solved,
    streakDelta: row.streak_delta,
    ratingDelta: row.rating_delta,
    attemptedAt: row.attempted_at,
    ratingAfter: row.rating_after,
  }));
}

function clearPuzzleHistory(userId) {
  if (!userId) return;
  const db = getDb();
  const stmt = db.prepare('DELETE FROM puzzle_history WHERE user_id = ?');
  stmt.run(userId);
}

module.exports = {
  recordPuzzleAttempt,
  listPuzzleHistory,
  clearPuzzleHistory,
};
