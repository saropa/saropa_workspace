// Unit tests for the pure port-unwedge detection and parsing (portUnwedge.ts). The
// process lookup/kill themselves touch the OS, so they are not exercised here; this
// covers the host-free, deterministic core: reading the port from run output,
// parsing netstat/tasklist/lsof, and the kill-safety guard. No VS Code, no spawning.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectBlockedPort,
  parseNetstatPid,
  parseTasklistImage,
  parseLsofPid,
  isKillablePid,
} from "../exec/portUnwedge";

test("detectBlockedPort: Node EADDRINUSE with :::port", () => {
  const out = "Error: listen EADDRINUSE: address already in use :::3000\n    at Server.setupListenHandle";
  assert.equal(detectBlockedPort(out), 3000);
});

test("detectBlockedPort: Node EADDRINUSE with host:port", () => {
  assert.equal(
    detectBlockedPort("listen EADDRINUSE: address already in use 127.0.0.1:8080"),
    8080
  );
});

test("detectBlockedPort: dotnet bind failure naming an http url", () => {
  const out =
    "Failed to bind to address http://127.0.0.1:5000: address already in use.";
  assert.equal(detectBlockedPort(out), 5000);
});

test("detectBlockedPort: 0.0.0.0:port form", () => {
  assert.equal(
    detectBlockedPort("EADDRINUSE: address already in use 0.0.0.0:4200"),
    4200
  );
});

test("detectBlockedPort: 'port N' phrasing", () => {
  assert.equal(
    detectBlockedPort("bind: address already in use on port 6006"),
    6006
  );
});

test("detectBlockedPort: an in-use error with no port yields undefined", () => {
  // Python's "[Errno 98] Address already in use" names no port; degrade to no toast
  // rather than guessing a port from elsewhere in the output.
  assert.equal(
    detectBlockedPort("OSError: [Errno 98] Address already in use"),
    undefined
  );
});

test("detectBlockedPort: a ':port' outside an in-use line does not trigger", () => {
  // Only lines carrying the in-use marker are considered — an unrelated URL must
  // not be read as a blocked port.
  const out = "Serving at http://localhost:3000\nBuild failed: missing module";
  assert.equal(detectBlockedPort(out), undefined);
});

test("detectBlockedPort: rejects an out-of-range port", () => {
  assert.equal(
    detectBlockedPort("EADDRINUSE: address already in use :::99999"),
    undefined
  );
});

test("detectBlockedPort: empty output yields undefined", () => {
  assert.equal(detectBlockedPort(""), undefined);
});

test("parseNetstatPid: reads the PID of the TCP LISTENING row for the port", () => {
  const output = [
    "Active Connections",
    "",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4512",
    "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4512",
  ].join("\r\n");
  assert.equal(parseNetstatPid(output, 3000), 4512);
});

test("parseNetstatPid: ignores an ESTABLISHED row and a foreign-address match", () => {
  // A client connected FROM port 3000 (foreign column) or a non-LISTENING row must
  // not be mistaken for the listener holding the local port.
  const output = [
    "  TCP    127.0.0.1:55012        127.0.0.1:3000         ESTABLISHED     9000",
    "  TCP    0.0.0.0:9229           0.0.0.0:0              LISTENING       7777",
  ].join("\r\n");
  assert.equal(parseNetstatPid(output, 3000), undefined);
});

test("parseNetstatPid: returns undefined when the port is not listed", () => {
  const output =
    "  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       100";
  assert.equal(parseNetstatPid(output, 3000), undefined);
});

test("parseTasklistImage: reads the image name from CSV", () => {
  assert.equal(
    parseTasklistImage('"node.exe","4512","Console","1","52,140 K"'),
    "node.exe"
  );
});

test("parseTasklistImage: handles the 'no tasks' message", () => {
  assert.equal(
    parseTasklistImage("INFO: No tasks are running which match the specified criteria."),
    undefined
  );
});

test("parseLsofPid: reads the first PID", () => {
  assert.equal(parseLsofPid("4512\n4513\n"), 4512);
});

test("parseLsofPid: returns undefined on empty output", () => {
  assert.equal(parseLsofPid("\n  \n"), undefined);
});

test("isKillablePid: refuses 0, 1, negatives, and our own PID", () => {
  assert.equal(isKillablePid(0), false);
  assert.equal(isKillablePid(1), false);
  assert.equal(isKillablePid(-5), false);
  assert.equal(isKillablePid(1.5), false);
  assert.equal(isKillablePid(process.pid), false);
});

test("isKillablePid: accepts an ordinary other PID", () => {
  // Pick a PID that is not ours and within range; the guard is about identity and
  // shape, not liveness.
  const other = process.pid + 1;
  assert.equal(isKillablePid(other), true);
});
