const fs = require("fs");
const readline = require("readline");

const input = fs.createReadStream("lichess_db_puzzle.csv");
const rl = readline.createInterface({ input });

let fileIndex = 0;
let lineCount = 0;
let output = fs.createWriteStream(`chunk_${fileIndex}.csv`);

rl.on("line", (line) => {
  if (lineCount === 0) {
    // Write header to each chunk
    output.write(line + "\n");
    lineCount++;
    return;
  }

  if (lineCount >= 10000) {
    output.end();
    fileIndex++;
    output = fs.createWriteStream(`chunk_${fileIndex}.csv`);
    output.write(line + "\n");
    lineCount = 1;
  } else {
    output.write(line + "\n");
    lineCount++;
  }
});

rl.on("close", () => {
  output.end();
  console.log(`Split into ${fileIndex + 1} chunks.`);
});
