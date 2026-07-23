import assert from "node:assert/strict";
import test from "node:test";
import { hasUsableCodexAuth, parseDeviceLoginOutput, parseLoginExitMarker } from "../../lib/sandbox-runtime";

test("extracts a clean Codex device URL and code from ANSI terminal output", () => {
  const parsed = parseDeviceLoginOutput("Open \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\nCode: \u001b[94mJX2U-ZYXKN\u001b[0m");
  assert.equal(parsed.deviceUrl, "https://auth.openai.com/codex/device");
  assert.equal(parsed.userCode, "JX2U-ZYXKN");
  assert.doesNotMatch(parsed.output, /\u001b/);
});

test("uses the sandbox exit marker as the login completion authority", () => {
  assert.equal(parseLoginExitMarker("0"), 0);
  assert.equal(parseLoginExitMarker("17\n"), 17);
  assert.equal(parseLoginExitMarker(""), null);
  assert.equal(parseLoginExitMarker("still running"), null);
});

test("requires a parsed Codex credential payload before connection", () => {
  assert.equal(hasUsableCodexAuth(JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "present" } })), true);
  assert.equal(hasUsableCodexAuth(JSON.stringify({ auth_mode: "apiKey", OPENAI_API_KEY: "present" })), true);
  assert.equal(hasUsableCodexAuth(JSON.stringify({ auth_mode: "chatgpt", tokens: {} })), false);
  assert.equal(hasUsableCodexAuth("not json"), false);
});
