import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { parseEpicLaunchParameters } from "./launch-protocol.js";

const fixture = () => ({
  launch_command: [],
  game_directory: "C:\\Games\\Epic Game",
  game_executable: "bin\\Game.exe",
  working_directory: "C:\\Games\\Epic Game\\bin",
  game_parameters: ["-AUTH_PASSWORD=private value", "-epicapp=Artifact"],
  user_parameters: ["-language=pt"],
  egl_parameters: ["-epicportal"],
  environment: { EXAMPLE: "one two" },
});
test("keeps Legendary structured authentication and paths with spaces as argv, exclusively main", () => {
  const value = parseEpicLaunchParameters(
    fixture(),
    "C:\\Games\\Epic Game",
    "C:\\Games\\Epic Game\\bin\\Game.exe",
    path.win32
  );
  assert.equal(value.executable, "C:\\Games\\Epic Game\\bin\\Game.exe");
  assert.deepEqual(value.args, [
    "-AUTH_PASSWORD=private value",
    "-epicapp=Artifact",
    "-language=pt",
    "-epicportal",
  ]);
  assert.deepEqual(value.environment, { EXAMPLE: "one two" });
});
test("rejects executable/working-directory escapes, shell wrappers and unstructured parameters", () => {
  const parse = (value: unknown) =>
    parseEpicLaunchParameters(
      value,
      "C:\\Games\\Epic Game",
      "C:\\Games\\Epic Game\\bin\\Game.exe",
      path.win32
    );
  assert.throws(() =>
    parse({ ...fixture(), game_executable: "..\\other.exe" })
  );
  assert.throws(() =>
    parse({ ...fixture(), working_directory: "C:\\Games\\Other" })
  );
  assert.throws(() => parse({ ...fixture(), launch_command: ["cmd", "/c"] }));
  assert.throws(() => parse({ ...fixture(), game_parameters: "shell string" }));
  assert.throws(() =>
    parse({ ...fixture(), environment: { LEGENDARY_WRAPPER_EXE: "arbitrary" } })
  );
  assert.throws(() => parse({ ...fixture(), environment: { TOKEN: "a\0b" } }));
});
