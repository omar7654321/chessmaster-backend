const { Client } = require('pg');

function parseFen(fen) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const boardRows = parts[0].split('/');
  if (boardRows.length !== 8) return null;
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 8; r += 1) {
    let file = 0;
    for (const ch of boardRows[r]) {
      if (/[1-8]/.test(ch)) {
        file += Number.parseInt(ch, 10);
      } else {
        const color = ch === ch.toUpperCase() ? 'white' : 'black';
        const symbol = ch.toLowerCase();
        board[r][file] = `${color}:${symbol}`;
        file += 1;
      }
    }
  }
  const sideToMove = parts[1] === 'b' ? 'black' : 'white';
  return { board, sideToMove };
}

function squareToCoords(square) {
  if (!square || square.length < 2) return null;
  const files = 'abcdefgh';
  const file = files.indexOf(square[0]);
  const rank = Number.parseInt(square[1], 10);
  if (file < 0 || !Number.isFinite(rank)) return null;
  const row = 8 - rank;
  const col = file;
  if (row < 0 || row > 7 || col < 0 || col > 7) return null;
  return { row, col };
}

(async () => {
  const connectionString = process.env.DATABASE_URL || 'postgresql://postgres.fhtpcgrrlrnzfsjmbmjw:fJsQVNJVxfyO4Fcv@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';
  const client = new Client({ connectionString, ssl: connectionString.includes('supabase.co') ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  const res = await client.query('SELECT puzzle_id, fen, moves FROM puzzles LIMIT 200');
  let mismatch = 0;
  for (const row of res.rows) {
    const parsed = parseFen(row.fen);
    if (!parsed) continue;
    const moves = String(row.moves).trim().split(/\s+/).filter(Boolean);
    if (!moves.length) continue;
    const firstMove = moves[0];
    const from = firstMove.slice(0, 2);
    const coords = squareToCoords(from);
    if (!coords) continue;
    const piece = parsed.board[coords.row][coords.col];
    if (!piece) continue;
    const [color] = piece.split(':');
    if (color !== parsed.sideToMove) {
      mismatch += 1;
      console.log('Mismatch', row.puzzle_id, parsed.sideToMove, color, firstMove);
    }
  }
  console.log('Total mismatches:', mismatch);
  await client.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
