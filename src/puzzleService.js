const puzzleRepository = require('./puzzleRepository');

const DEFAULT_MIN_RATING = 0;
const DEFAULT_MAX_RATING = 4000;

function toInteger(value) {
  if (value == null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeRatingBounds(minRaw, maxRaw) {
  const min = toInteger(minRaw);
  const max = toInteger(maxRaw);

  if (min == null && max == null) {
    return { ratingMin: DEFAULT_MIN_RATING, ratingMax: DEFAULT_MAX_RATING };
  }

  if (min == null) {
    return {
      ratingMin: DEFAULT_MIN_RATING,
      ratingMax: max,
    };
  }

  if (max == null) {
    return {
      ratingMin: min,
      ratingMax: DEFAULT_MAX_RATING,
    };
  }

  if (min > max) {
    return { ratingMin: max, ratingMax: min };
  }

  return { ratingMin: min, ratingMax: max };
}

async function getRandomPuzzle({ ratingMin, ratingMax, theme } = {}) {
  const bounds = sanitizeRatingBounds(ratingMin, ratingMax);
  const normalizedTheme = typeof theme === 'string' && theme.trim().length ? theme.trim() : null;

  const puzzle = await puzzleRepository.getRandomPuzzle({
    ...bounds,
    theme: normalizedTheme,
  });

  if (!puzzle) {
    throw new Error('No puzzle found for the provided filters.');
  }

  return puzzle;
}

async function getPuzzleById(id) {
  if (!id) {
    throw new Error('Puzzle id is required.');
  }

  const puzzle = await puzzleRepository.getPuzzleById(String(id).trim());
  if (!puzzle) {
    throw new Error(`Puzzle ${id} not found.`);
  }
  return puzzle;
}

module.exports = {
  getRandomPuzzle,
  getPuzzleById,
};
