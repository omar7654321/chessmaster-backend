const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');
const config = require('./config');

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    rating: row.rating,
    streak: row.streak,
    createdAt: row.created_at,
  };
}

function createUser({ username, email, password }) {
  if (!username || !email || !password) {
    throw new Error('username, email, and password are required');
  }

  const db = getDb();
  const existingStmt = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?');
  const existing = existingStmt.get(username, email);
  if (existing) {
    throw new Error('User already exists with that username or email');
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO users (id, username, email, password_hash, rating, streak, created_at)
    VALUES (?, ?, ?, ?, 1500, 0, ?)
  `);
  insert.run(id, username, email, passwordHash, now);

  return mapUserRow({
    id,
    username,
    email,
    rating: 1500,
    streak: 0,
    created_at: now,
  });
}

function findUserByUsername(username) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  const row = stmt.get(username);
  return row ? { ...row } : null;
}

function findUserByEmail(email) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  const row = stmt.get(email);
  return row ? { ...row } : null;
}

function findUserById(id) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const row = stmt.get(id);
  return row ? mapUserRow(row) : null;
}

function verifyPassword(userRow, password) {
  if (!userRow) return false;
  return bcrypt.compareSync(password, userRow.password_hash);
}

function updateUserRatings({ userId, rating, streak }) {
  const db = getDb();
  const stmt = db.prepare('UPDATE users SET rating = ?, streak = ? WHERE id = ?');
  stmt.run(rating, streak, userId);
}

module.exports = {
  createUser,
  findUserByUsername,
  findUserByEmail,
  findUserById,
  verifyPassword,
  updateUserRatings,
  mapUserRow,
};
