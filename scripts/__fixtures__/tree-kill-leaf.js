// Test fixture: opens a real TCP listener and reports {pid, port} to the file
// given as argv[2], so a test process can verify the listener's lifecycle
// from the outside (black-box) without relying on any internal signal.
const net = require("net");
const fs = require("fs");

const infoFilePath = process.argv[2];

const server = net.createServer(() => {});
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(
    infoFilePath,
    JSON.stringify({ pid: process.pid, port: server.address().port })
  );
});

setInterval(() => {}, 60000);
