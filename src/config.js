const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath, override: false });

function resolveStockfishPath(rawPath) {
  const candidates = [];
  if (rawPath) {
    candidates.push(rawPath);
    if (!path.isAbsolute(rawPath)) {
      candidates.push(path.resolve(process.cwd(), rawPath));
    }
  }

  const stockfishDir = path.resolve(process.cwd(), 'bin', 'stockfish');
  const platformBinary = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish';
  const alternateBinary = process.platform === 'win32' ? 'stockfish' : 'stockfish.exe';
  candidates.push(
    path.resolve(stockfishDir, platformBinary),
    path.resolve(stockfishDir, alternateBinary)
  );

  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  for (const candidate of uniqueCandidates) {
    try {
      if (fs.existsSync(candidate)) {
        return { resolved: candidate, candidates: uniqueCandidates };
      }
    } catch (err) {
      // Ignore filesystem access errors and continue.
    }
  }
  return { resolved: '', candidates: uniqueCandidates };
}

const {
  resolved: stockfishPath,
  candidates: stockfishCandidates,
} = resolveStockfishPath(process.env.STOCKFISH_PATH);

const config = {
  port: Number(process.env.PORT) || 4000,
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || 'http://localhost:3000',
  allowCorsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  stockfishPath,
  stockfishPathRaw: process.env.STOCKFISH_PATH || '',
  stockfishCandidates,
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'chessmaster.db'),
  dbUrl: process.env.DATABASE_URL || process.env.DB_URL || '',
  dbSsl:
    process.env.DB_SSL?.toLowerCase() === 'require'
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : undefined,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
};

module.exports = config;
