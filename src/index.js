/*
 * ChessMaster backend entry point.
 */

const http = require('http');
const express = require('express');
const cors = require('cors');

const config = require('./config');
const stockfishService = require('./stockfishService');
const { initOnlinePlayServer } = require('./onlinePlayServer');
const {
  analyzeGame,
  createGame,
  joinGame,
  listGames,
  recordCompletedGame: recordLocalGame,
  listCompletedGames,
  clearCompletedGames,
} = require('./gameService');
const puzzleService = require('./puzzleService');
const {
  recordCompletedGame: recordGame,
  clearGamesForUser,
  listGamesForUser,
} = require('./gameStore');
const {
  recordPuzzleAttempt,
  listPuzzleHistory,
  clearPuzzleHistory,
} = require('./puzzleHistoryStore');
const {
  createUser,
  findUserByUsername,
  findUserByEmail,
  findUserById,
  verifyPassword,
  updateUserRatings,
  mapUserRow,
} = require('./userService');
const {
  signAccessToken,
  verifyAccessToken,
  parseAuthorizationHeader,
} = require('./authService');

const app = express();
const server = http.createServer(app);

const allowOrigins = config.allowCorsOrigins;
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowOrigins.includes('*') || allowOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'ChessMaster backend running' });
});

app.get('/puzzles/random', async (req, res) => {
  try {
    const { ratingMin, ratingMax, theme } = req.query || {};
    const puzzle = await puzzleService.getRandomPuzzle({ ratingMin, ratingMax, theme });
    res.json(puzzle);
  } catch (err) {
    const status = err?.message?.includes('No puzzle found') ? 404 : 500;
    res.status(status).json({ error: err.message || 'Unable to fetch puzzle' });
  }
});

app.get('/puzzles/:id', async (req, res) => {
  try {
    const puzzle = await puzzleService.getPuzzleById(req.params.id);
    res.json(puzzle);
  } catch (err) {
    const status = err?.message?.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message || 'Unable to fetch puzzle' });
  }
});

app.post('/games', (req, res) => {
  try {
    const game = createGame(req.body || {});
    res.status(201).json(game);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/games', (req, res) => {
  res.json(listGames());
});

app.get('/games/:id', (req, res) => {
  try {
    const game = joinGame(req.params.id, req.body || {});
    res.json(game);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/games/:id/join', (req, res) => {
  try {
    const player = req.body || {};
    const game = joinGame(req.params.id, player);
    res.json(game);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/games/completed', (req, res) => {
  res.json(listCompletedGames());
});

app.post('/games/completed', (req, res) => {
  try {
    const record = recordLocalGame(req.body || {});
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/games/completed', (req, res) => {
  clearCompletedGames();
  res.status(204).end();
});

app.post('/engines/stockfish/move', async (req, res) => {
  try {
    const { fen, moves, movetime, depth, skillLevel, timeoutMs, multiPv } = req.body || {};
    const data = await stockfishService.getBestMove({
      fen,
      moves,
      movetime,
      depth,
      skillLevel,
      timeoutMs,
      multiPv,
    });
    res.json(data);
  } catch (err) {
    const status = err?.message === 'FEN is required to request a Stockfish move.' ? 400 : 500;
    res.status(status).json({ error: err.message || 'Stockfish failed to compute move' });
  }
});

app.post('/engines/stockfish/analyze', async (req, res) => {
  try {
    const {
      pgn,
      depth,
      movetime,
      skillLevel,
      timeoutMs,
      multiPv,
      maxPlies,
      thresholds,
    } = req.body || {};
    const data = await stockfishService.analyzeGame({
      pgn,
      depth,
      movetime,
      skillLevel,
      timeoutMs,
      multiPv,
      maxPlies,
      thresholds,
    });
    res.json({ ok: true, data });
  } catch (err) {
    const status = err?.message === 'PGN is required for analysis.' ? 400 : 500;
    res.status(status).json({ error: err.message || 'Stockfish analysis failed' });
  }
});

app.post('/auth/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    const user = await createUser({ username, email, password });
    const token = signAccessToken({ userId: user.id });
    res.status(201).json({ user, token });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to create user' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    let userRow = null;
    if (username) {
      userRow = await findUserByUsername(username);
    }
    if (!userRow && email) {
      userRow = await findUserByEmail(email);
    }
    if (!userRow || !verifyPassword(userRow, password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = mapUserRow(userRow);
    const token = signAccessToken({ userId: user.id });
    return res.json({ user, token });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Unable to login' });
  }
});

app.post('/auth/token/verify', (req, res) => {
  try {
    const { token } = req.body || {};
    const payload = verifyAccessToken(token);
    res.json({ ok: true, payload });
  } catch (err) {
    res.status(401).json({ error: err.message || 'Invalid token' });
  }
});

function authenticate(req, res, next) {
  try {
    const token = parseAuthorizationHeader(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

app.use('/users/:id', authenticate);

app.get('/users/:id', async (req, res) => {
  if (req.params.id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unable to fetch user' });
  }
});

app.get('/users/:id/history', async (req, res) => {
  if (req.params.id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const [games, puzzles] = await Promise.all([
      listGamesForUser(req.user.id, { limit: 200 }),
      listPuzzleHistory(req.user.id, { limit: 500 }),
    ]);
    res.json({ games, puzzles });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to fetch history' });
  }
});

app.post('/users/:id/history', async (req, res) => {
  if (req.params.id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { type, payload = {} } = req.body || {};
    if (type === 'game') {
      if (payload.clear) {
        await clearGamesForUser(req.user.id);
        return res.status(200).json({ type: 'game', status: 'cleared' });
      }
      const record = await recordGame({ userId: req.user.id, ...payload });
      return res.status(201).json({ type: 'game', record });
    }
    if (type === 'puzzle') {
      if (payload.clear) {
        await clearPuzzleHistory(req.user.id);
        if (typeof payload.rating === 'number' && typeof payload.streak === 'number') {
          await updateUserRatings({ userId: req.user.id, rating: payload.rating, streak: payload.streak });
        }
        return res.status(200).json({ type: 'puzzle', status: 'cleared' });
      }
      if (!payload.puzzleId) {
        return res.status(400).json({ error: 'puzzleId is required for puzzle history entries' });
      }
      await recordPuzzleAttempt({
        userId: req.user.id,
        puzzleId: payload.puzzleId,
        solved: !!payload.solved,
        streakDelta: Number.isFinite(payload.streakDelta) ? payload.streakDelta : 0,
        ratingDelta: Number.isFinite(payload.ratingDelta) ? payload.ratingDelta : 0,
        ratingAfter: Number.isFinite(payload.ratingAfter) ? payload.ratingAfter : (Number.isFinite(payload.rating) ? payload.rating : null),
        attemptedAt: payload.attemptedAt || new Date().toISOString(),
      });
      if (typeof payload.rating === 'number' && typeof payload.streak === 'number') {
        await updateUserRatings({ userId: req.user.id, rating: payload.rating, streak: payload.streak });
      }
      return res.status(201).json({ type: 'puzzle', status: 'ok' });
    }
    return res.status(400).json({ error: 'Invalid history type' });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Unable to record history' });
  }
});

const PORT = config.port;
server.listen(PORT, () => {
  /* eslint-disable no-console */
  console.log(`ChessMaster backend listening on port ${PORT}`);
  /* eslint-enable no-console */
});

initOnlinePlayServer(server);

module.exports = { app, server };
