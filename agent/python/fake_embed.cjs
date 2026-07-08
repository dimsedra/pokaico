const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });

const DIM = parseInt(process.env.FAKE_EMBED_DIM || "384", 10);
const DELAY_MS = parseInt(process.env.FAKE_EMBED_DELAY || "0", 10);

console.log(JSON.stringify({ ready: true }));

rl.on("line", (line) => {
  const req = JSON.parse(line);
  setTimeout(() => {
    if (req.type === "embed") {
      const data = new Array(DIM).fill(0.01);
      console.log(JSON.stringify({ id: req.id, type: "result", data }));
    } else if (req.type === "embed_batch") {
      const data = req.texts.map(() => new Array(DIM).fill(0.01));
      console.log(JSON.stringify({ id: req.id, type: "result", data }));
    } else {
      console.log(JSON.stringify({ id: req.id, type: "error", message: "unknown type" }));
    }
  }, DELAY_MS);
});
