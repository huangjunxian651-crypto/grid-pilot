/**
 * Resolves once a TCP connection to host:port succeeds; keeps retrying on
 * ECONNREFUSED (nobody listening yet) until timeoutMs elapses.
 *
 * Used to hold the Web dev server back until the API is actually accepting
 * connections, instead of both starting in parallel and the browser hitting
 * ECONNREFUSED on every /api/* proxy request during the API's boot window.
 */
const net = require("net");

function waitForPort(host, port, { timeoutMs = 60000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${host}:${port} to accept connections`));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });
}

module.exports = { waitForPort };
