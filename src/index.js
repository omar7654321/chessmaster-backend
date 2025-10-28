const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const config = require('./config');
const {
  loadPuzzleSample,
  getPuzzleSummary,
  getRandomPuzzle,
  getPuzzleById,
} = require('./puzzleService');
const {
  createGame,
  getGame,
  joinGame,
  listGames,
  recordCompletedGame,
  listCompletedGames,
  clearCompletedGames,
} = require('./gameService');
const {
  getBestMove: getStockfishBestMove,
  analyzeGame: analyzeStockfishGame,
} = require('./stockfishService');
const {
  createUser,
  findUserByUsername,
  findUserByEmail,
  findUserById,
  verifyPassword,
  mapUserRow,
  updateUserRatings,
} = require('./userService');
const { signAccessToken, parseAuthorizationHeader, verifyAccessToken } = require('./authService');
const {
  recordCompletedGame: persistGame,
  listGamesForUser,
  clearGamesForUser,
} = require('./gameStore');
const {
  recordPuzzleAttempt,
  listPuzzleHistory,
  clearPuzzleHistory,
} = require('./puzzleHistoryStore');

async function bootstrap() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(express.json());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || config.allowCorsOrigins.includes('*')) {
          return callback(null, true);
        }
        if (config.allowCorsOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
      },
    })
  );

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  function authenticate(req, res, next) {
    try {
      const token = parseAuthorizationHeader(req.headers.authorization || '');
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

  app.post('/auth/signup', (req, res) => {
    try {
      const { username, email, password } = req.body || {};
      const user = createUser({ username, email, password });
      const token = signAccessToken({ userId: user.id });
      res.status(201).json({ user, token });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to create user' });
    }
  });

  app.post('/auth/login', (req, res) => {
    try {
      const { username, email, password } = req.body || {};
      let userRow = null;
      if (username) {
        userRow = findUserByUsername(username);
      }
      if (!userRow && email) {
        userRow = findUserByEmail(email);
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

  app.get('/games/completed', (req, res) => {
    res.json(listCompletedGames());
  });

  app.post('/games/:id/complete', (req, res) => {
    const { result, reason, winner, moves, metadata } = req.body || {};
    const existing = getGame(req.params.id);
    const record = recordCompletedGame({
      id: req.params.id,
      createdAt: existing?.createdAt,
      players: existing?.players,
      timeControl: existing?.timeControl,
      moves: moves || existing?.moves,
      result,
      reason,
      winner,
      metadata: {
        ...(existing?.metadata || {}),
        ...(typeof metadata === 'object' && metadata !== null ? metadata : {}),
      },
      status: 'completed',
    });
    res.status(201).json(record);
  });

  app.delete('/games/completed', (req, res) => {
    clearCompletedGames();
    res.status(204).send();
  });

  app.get('/puzzles/summary', (req, res) => {
    res.json(getPuzzleSummary());
  });

  app.get('/puzzles/random', (req, res) => {
    try {
      const { ratingMin, ratingMax, theme } = req.query;
      const puzzle = getRandomPuzzle({
        ratingMin: ratingMin ? Number(ratingMin) : undefined,
        ratingMax: ratingMax ? Number(ratingMax) : undefined,
        theme,
      });
      res.json(puzzle);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/puzzles/:id', (req, res) => {
    const puzzle = getPuzzleById(req.params.id);
    if (!puzzle) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }
    return res.json(puzzle);
  });

  app.post('/engines/stockfish/move', async (req, res) => {
    try {
      const {
        fen,
        moves = [],
        movetime,
        depth,
        skillLevel,
        timeoutMs,
        multiPv,
      } = req.body || {};
      if (!fen || typeof fen !== 'string') {
        return res.status(400).json({ error: 'FEN is required.' });
      }
      const result = await getStockfishBestMove({
        fen,
        moves,
        movetime,
        depth,
        skillLevel,
        timeoutMs,
        multiPv,
      });
      return res.json(result);
    } catch (err) {
      console.error('Stockfish move error:', err.message || err);
      return res.status(500).json({ error: err.message || 'Engine failure' });
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
      if (!pgn || typeof pgn !== 'string') {
        return res.status(400).json({ error: 'PGN is required.' });
      }
      const result = await analyzeStockfishGame({
        pgn,
        depth,
        movetime,
        skillLevel,
        timeoutMs,
        multiPv,
        maxPlies,
        thresholds,
      });
      return res.json(result);
    } catch (err) {
      console.error('Stockfish analysis error:', err.message || err);
      return res.status(500).json({ error: err.message || 'Analysis failure' });
    }
  });

  app.post('/games', (req, res) => {
    const { timeControl, metadata } = req.body || {};
    const game = createGame({ timeControl, metadata });
    res.status(201).json(game);
  });

  app.get('/games', (req, res) => {
    res.json(listGames());
  });

  app.get('/games/:id', (req, res) => {
    const game = getGame(req.params.id);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    return res.json(game);
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

  app.use('/users/:id', authenticate);

  app.get('/users/:id', (req, res) => {
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const user = findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(user);
  });

  app.get('/users/:id/history', (req, res) => {
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const games = listGamesForUser(req.user.id, { limit: 200 });
    const puzzles = listPuzzleHistory(req.user.id, { limit: 500 });
    res.json({ games, puzzles });
  });

  app.post('/users/:id/history', (req, res) => {
    if (req.params.id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    try {
      const { type, payload = {} } = req.body || {};
      if (type === 'game') {
        if (payload.clear) {
          clearGamesForUser(req.user.id);
          return res.status(200).json({ type: 'game', status: 'cleared' });
        }
        const record = persistGame({ userId: req.user.id, ...payload });
        return res.status(201).json({ type: 'game', record });
      }
      if (type === 'puzzle') {
        if (payload.clear) {
          clearPuzzleHistory(req.user.id);
          if (typeof payload.rating === 'number' && typeof payload.streak === 'number') {
            updateUserRatings({ userId: req.user.id, rating: payload.rating, streak: payload.streak });
          }
          return res.status(200).json({ type: 'puzzle', status: 'cleared' });
        }
        if (!payload.puzzleId) {
          return res.status(400).json({ error: 'puzzleId is required for puzzle history entries' });
        }
        recordPuzzleAttempt({
          userId: req.user.id,
          puzzleId: payload.puzzleId,
          solved: !!payload.solved,
          streakDelta: Number.isFinite(payload.streakDelta) ? payload.streakDelta : 0,
          ratingDelta: Number.isFinite(payload.ratingDelta) ? payload.ratingDelta : 0,
          ratingAfter: Number.isFinite(payload.ratingAfter) ? payload.ratingAfter : (Number.isFinite(payload.rating) ? payload.rating : null),
          attemptedAt: payload.attemptedAt || new Date().toISOString(),
        });
        if (typeof payload.rating === 'number' && typeof payload.streak === 'number') {
          updateUserRatings({ userId: req.user.id, rating: payload.rating, streak: payload.streak });
        }
        return res.status(201).json({ type: 'puzzle', status: 'ok' });
      }
      return res.status(400).json({ error: 'Invalid history type' });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Unable to record history' });
    }
  });

  wss.on('connection', (socket) => {
    socket.on('message', (message) => {
      // TODO: Add game-specific dispatch
      socket.send(message);
    });
  });

  server.listen(config.port, async () => {
    console.log(`Server listening on port ${config.port}`);
    try {
      await loadPuzzleSample({
        filePath: config.puzzleCsvPath,
        sampleSize: config.puzzleSampleSize,
      });
      console.log('Puzzle sample loaded');
    } catch (err) {
      console.error('Failed to load puzzle sample:', err.message);
    }
  });
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap server:', err);
  process.exit(1);
});
