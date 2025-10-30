const fs = require("fs");

let out = "";
for (let i = 0; i < 543; i++) {
  out += `\\COPY puzzles FROM 'chunk_${i}.csv' WITH (FORMAT csv, HEADER true);\n`;
}

fs.writeFileSync("import_chunks.sql", out);
console.log("import_chunks.sql created with 543 COPY commands");
