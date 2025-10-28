const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath, override: false });

const config = {
  port: Number(process.env.PORT) || 4000,
  puzzleCsvPath: process.env.PUZZLE_CSV_PATH || '',
  puzzleSampleSize: Number(process.env.PUZZLE_SAMPLE_SIZE) || 5000,
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || 'http://localhost:3000',
  allowCorsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  stockfishPath: process.env.STOCKFISH_PATH || '',
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'chessmaster.db'),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
};

module.exports = config;
