(async () => {
  const { Client } = require('pg');
  const connectionString = process.env.DATABASE_URL || 'postgresql://postgres.fhtpcgrrlrnzfsjmbmjw:fJsQVNJVxfyO4Fcv@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';
  const client = new Client({ connectionString, ssl: connectionString.includes('supabase.co') ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  const res = await client.query('SELECT puzzle_id, fen, moves FROM puzzles LIMIT 5');
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
