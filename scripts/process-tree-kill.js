/**
 * Kills a process and all of its descendants (children, grandchildren, ...).
 *
 * `child.kill(signal)` only signals the direct child. When that child is a
 * multi-hop launcher (pnpm -> nest CLI -> compiled app), each hop must
 * cooperatively forward the signal before it exits itself; if any hop is
 * slow (e.g. mid file-watch restart) it can exit before its own child does,
 * orphaning a grandchild that still holds a listening port. Walking the
 * process table and signalling every descendant directly removes that
 * dependency on cooperative forwarding.
 */
const { execFileSync } = require("child_process");

function listDescendantPids(rootPid) {
  let output;
  try {
    output = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  } catch {
    return [];
  }

  const childrenByParent = new Map();
  for (const line of output.trim().split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!childrenByParent.has(ppid)) childrenByParent.set(ppid, []);
    childrenByParent.get(ppid).push(pid);
  }

  const descendants = [];
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop();
    for (const childPid of childrenByParent.get(pid) ?? []) {
      descendants.push(childPid);
      stack.push(childPid);
    }
  }
  return descendants;
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (err) {
    if (err.code !== "ESRCH") throw err;
  }
}

function killProcessTree(pid, signal = "SIGTERM") {
  if (!pid) return;
  // Descendants must be listed before any signal is sent: killing a parent
  // first can make `ps` reparent/reap its children before they're found.
  for (const descendantPid of listDescendantPids(pid)) {
    killPid(descendantPid, signal);
  }
  killPid(pid, signal);
}

module.exports = { killProcessTree, listDescendantPids };
