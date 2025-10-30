const { Pool } = require('pg');
const config = require('./config');

const connectionString = process.env.DATABASE_URL || config.dbUrl;

const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes('supabase.co')
    ? { rejectUnauthorized: false }
    : config.dbSsl || undefined,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};