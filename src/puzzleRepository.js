const { query } = require('./db');

const BASE_SELECT = `
  SELECT
    puzzle_id,
    fen,
    moves,
    rating,
    rating_deviation,
    popularity,
    nb_plays,
    themes,
    game_url,
    opening_tags
  FROM puzzles
`;

const DEFAULT_LIMIT = 1;
const CACHE_BATCH_SIZE = 20;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache window

const puzzleCache = new Map();
const cacheInflight = new Map();

function makeCacheKey(min, max, theme) {
  return `${min}:${max}:${theme || ''}`;
}

async function fetchPuzzleBatch({ min, max, theme }) {
  const sql = `
    ${BASE_SELECT}
    WHERE rating BETWEEN $1 AND $2
      AND ($3::text IS NULL OR themes ILIKE '%' || $3 || '%')
    ORDER BY random()
    LIMIT $4
  `;
  const result = await query(sql, [min, max, theme, CACHE_BATCH_SIZE]);
  return result.rows.map(mapRow).filter(Boolean);
}

async function ensureCacheEntry(key, params) {
  const existing = puzzleCache.get(key);
  if (existing && existing.items.length && existing.expiresAt > Date.now()) {
    return existing;
  }

  if (cacheInflight.has(key)) {
    await cacheInflight.get(key);
    return puzzleCache.get(key) || null;
  }

  const loadPromise = (async () => {
    const items = await fetchPuzzleBatch(params);
    if (items.length) {
      puzzleCache.set(key, {
        items,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    } else {
      puzzleCache.delete(key);
    }
  })()
    .catch((err) => {
      cacheInflight.delete(key);
      throw err;
    })
    .finally(() => {
      cacheInflight.delete(key);
    });

  cacheInflight.set(key, loadPromise);
  await loadPromise;
  return puzzleCache.get(key) || null;
}

function parseMoveList(rawMoves) {
  if (!rawMoves) return [];
  if (Array.isArray(rawMoves)) {
    return rawMoves.map((move) => String(move).trim()).filter(Boolean);
  }

  const text = String(rawMoves).trim();
  if (!text) return [];

  if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
    try {
      const parsed = JSON.parse(text.replace(/^{|}$/g, (match) => (match === '{' ? '[' : ']')));
      if (Array.isArray(parsed)) {
        return parsed.map((move) => String(move).trim()).filter(Boolean);
      }
    } catch (err) {
      // fall through to delimiter-based parsing
    }
  }

  return text
    .split(/[\s,;]+/)
    .map((move) => move.trim())
    .filter(Boolean);
}

function parseTagList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[;,]+|\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.puzzle_id,
    fen: row.fen,
    moves: parseMoveList(row.moves),
    rating: row.rating,
    ratingDeviation: row.rating_deviation,
    popularity: row.popularity,
    plays: row.nb_plays,
    themes: parseTagList(row.themes),
    gameUrl: row.game_url,
    openingTags: parseTagList(row.opening_tags),
  };
}

async function getRandomPuzzle({ ratingMin = 0, ratingMax = 4000, theme = null } = {}) {
  const min = Number.isFinite(ratingMin) ? ratingMin : 0;
  const max = Number.isFinite(ratingMax) ? ratingMax : 4000;
  const themeFilter = theme ? String(theme).trim() : null;
  const key = makeCacheKey(min, max, themeFilter);
  await ensureCacheEntry(key, { min, max, theme: themeFilter });
  const entry = puzzleCache.get(key);
  if (!entry || !entry.items.length) {
    return null;
  }
  return entry.items.pop() || null;
}

async function getPuzzleById(id) {
  if (!id) return null;
  const sql = `${BASE_SELECT} WHERE puzzle_id = $1 LIMIT 1`;
  const result = await query(sql, [id]);
  return mapRow(result.rows[0]);
}

module.exports = {
  getRandomPuzzle,
  getPuzzleById,
};
