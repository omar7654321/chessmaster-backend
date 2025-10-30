const fs = require("fs");
const readline = require("readline");

const input = fs.createReadStream("lichess_db_puzzle.csv");
const output = fs.createWriteStream("lichess_db_puzzle_fixed.csv");

const rl = readline.createInterface({ input });

rl.on("line", (line) => {
  if (line.startsWith("PuzzleId")) {
    output.write(line + "\n");
    return;
  }

  const parts = line.split(",");
  if (parts.length < 10) return;

  // Fix themes and opening_tags
  parts[7] = `{${parts[7].split(" ").join(",")}}`;
  parts[9] = `{${parts[9].split(" ").join(",")}}`;

  output.write(parts.join(",") + "\n");
});

rl.on("close", () => {
  console.log("Fixed CSV written to lichess_db_puzzle_fixed.csv");
});
