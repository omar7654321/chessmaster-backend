const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { query } = require('./db');

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

async function createUser({ username, email, password }) {
  if (!username || !email || !password) {
    throw new Error('username, email, and password are required');
  }

  const existing = await query(
    'SELECT id FROM users WHERE username = $1 OR email = $2 LIMIT 1',
    [username, email]
  );
  if (existing.rows.length) {
    throw new Error('User already exists with that username or email');
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();

  try {
    const result = await query(
      `INSERT INTO users (id, username, email, password_hash, rating, streak, created_at)
       VALUES ($1, $2, $3, $4, 1500, 0, $5)
       RETURNING *`,
      [id, username, email, passwordHash, now]
    );
    return mapUserRow(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      throw new Error('User already exists with that username or email');
    }
    throw err;
  }
}

async function findUserByUsername(username) {
  if (!username) return null;
  const result = await query('SELECT * FROM users WHERE username = $1 LIMIT 1', [username]);
  return result.rows[0] ? { ...result.rows[0] } : null;
}

async function findUserByEmail(email) {
  if (!email) return null;
  const result = await query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  return result.rows[0] ? { ...result.rows[0] } : null;
}

async function findUserById(id) {
  if (!id) return null;
  const result = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] ? mapUserRow(result.rows[0]) : null;
}

function verifyPassword(userRow, password) {
  if (!userRow) return false;
  return bcrypt.compareSync(password, userRow.password_hash);
}

async function updateUserRatings({ userId, rating, streak }) {
  if (!userId) return;
  await query('UPDATE users SET rating = $1, streak = $2 WHERE id = $3', [rating, streak, userId]);
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
