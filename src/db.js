const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

let instance = null;

function resolveDatabasePath() {
  const configured = config.dbPath || path.join('data', 'chessmaster.db');
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

function ensureDirectoryExists(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function runMigrations(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT 1500,
      streak INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      players_json TEXT NOT NULL,
      moves_json TEXT NOT NULL,
      result TEXT,
      reason TEXT,
      metadata_json TEXT,
      started_at TEXT,
      finished_at TEXT,
      winner TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS puzzle_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      puzzle_id TEXT NOT NULL,
      solved INTEGER NOT NULL,
      streak_delta INTEGER NOT NULL,
      rating_delta INTEGER NOT NULL,
      attempted_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id, finished_at DESC);
    CREATE INDEX IF NOT EXISTS idx_puzzle_history_user ON puzzle_history(user_id, attempted_at DESC);
  `);

  const puzzleColumns = db
    .prepare('PRAGMA table_info(puzzle_history)')
    .all()
    .map((column) => column.name);
  if (!puzzleColumns.includes('rating_after')) {
    db.exec('ALTER TABLE puzzle_history ADD COLUMN rating_after INTEGER');
  }
}

function getDb() {
  if (instance) {
    return instance;
  }

  const dbPath = resolveDatabasePath();
  ensureDirectoryExists(dbPath);
  instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  runMigrations(instance);
  return instance;
}

module.exports = {
  getDb,
};
