// Test fixture: mimics the real dev process chain (start-dev.js -> pnpm ->
// nest CLI -> dist/main), where a "root" process spawns a "leaf" process
// (not detached, so it shares the parent's process group) and the leaf is
// the one actually holding a port open.
const { spawn } = require("child_process");
const path = require("path");

const infoFilePath = process.argv[2];

spawn(process.execPath, [path.join(__dirname, "tree-kill-leaf.js"), infoFilePath], {
  stdio: "ignore",
});

setInterval(() => {}, 60000);
