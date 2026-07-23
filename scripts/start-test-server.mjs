import { openSync } from "node:fs";
import { spawn } from "node:child_process";

const out = openSync("test-server.out.log", "a");
const error = openSync("test-server.err.log", "a");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3210"], {
  cwd: process.cwd(),
  detached: true,
  stdio: ["ignore", out, error],
  windowsHide: true,
});
child.unref();
process.stdout.write(`${child.pid}\n`);
