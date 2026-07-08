// Sends ready but never responds to requests — simulates a hung Python process
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });

console.log(JSON.stringify({ ready: true }));

// Never read from stdin — requests pile up unresponded
rl.on("line", () => {
  // silently consume without responding
});
