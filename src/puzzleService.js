const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

let puzzleSample = [];
let lastLoadSummary = null;

function parseThemes(rawThemes = '') {
  return rawThemes
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function mapRowToPuzzle(row) {
  return {
    id: row.PuzzleId,
    fen: row.FEN,
    moves: row.Moves ? row.Moves.trim().split(/\s+/) : [],
    rating: row.Rating ? Number(row.Rating) : null,
    ratingDeviation: row.RatingDeviation ? Number(row.RatingDeviation) : null,
    popularity: row.Popularity ? Number(row.Popularity) : null,
    plays: row.NbPlays ? Number(row.NbPlays) : null,
    themes: parseThemes(row.Themes),
    gameUrl: row.GameUrl || null,
    openingTags: parseThemes(row.OpeningTags || row.OpeningTags || ''),
  };
}

async function loadPuzzleSample({ filePath, sampleSize = 1000 } = {}) {
  if (!filePath) {
    throw new Error('PUZZLE_CSV_PATH is not configured.');
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Puzzle CSV not found at ${resolved}`);
  }

  return new Promise((resolve, reject) => {
    const sample = [];
    let processed = 0;

    const stream = fs
      .createReadStream(resolved)
      .on('error', reject)
      .pipe(csv())
      .on('data', (row) => {
        processed += 1;
        const puzzle = mapRowToPuzzle(row);

        if (sample.length < sampleSize) {
          sample.push(puzzle);
        } else {
          const idx = Math.floor(Math.random() * processed);
          if (idx < sampleSize) {
            sample[idx] = puzzle;
          }
        }
      })
      .on('end', () => {
        puzzleSample = sample;
        lastLoadSummary = {
          loadedAt: new Date().toISOString(),
          sampleSize: sample.length,
          processedRows: processed,
          source: resolved,
        };
        resolve(puzzleSample);
      });
  });
}

function getPuzzleSummary() {
  return {
    count: puzzleSample.length,
    lastLoad: lastLoadSummary,
  };
}

function getRandomPuzzle(filters = {}) {
  if (!puzzleSample.length) {
    throw new Error('Puzzle sample is empty. Did you call loadPuzzleSample()?');
  }

  const { ratingMin, ratingMax, theme } = filters;

  const filtered = puzzleSample.filter((puzzle) => {
    if (ratingMin && puzzle.rating !== null && puzzle.rating < ratingMin) {
      return false;
    }
    if (ratingMax && puzzle.rating !== null && puzzle.rating > ratingMax) {
      return false;
    }
    if (theme && theme.length) {
      return puzzle.themes.includes(theme);
    }
    return true;
  });

  const pool = filtered.length ? filtered : puzzleSample;
  const choice = pool[Math.floor(Math.random() * pool.length)];
  return choice;
}

function getPuzzleById(id) {
  if (!id) return null;
  return puzzleSample.find((p) => p.id === id) || null;
}

module.exports = {
  loadPuzzleSample,
  getPuzzleSummary,
  getRandomPuzzle,
  getPuzzleById,
};
