import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { getNemirtingasSaveRoot } from "./nemirtingas-save-root.ts";

const roots: string[] = [];

const createGame = (
  config?: string,
  location = ["NemirtingasEpicEmu.json"]
) => {
  const gameDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "hydra-nemirtingas-")
  );
  roots.push(gameDirectory);

  if (config !== undefined) {
    const configPath = path.join(gameDirectory, ...location);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, config);
  }

  return {
    gameDirectory,
    executablePath: path.join(gameDirectory, "Game.exe"),
  };
};

const resolve = async (config?: string, location?: string[]) => {
  const { gameDirectory, executablePath } = createGame(config, location);
  const warnings: string[] = [];
  const saveRoot = await getNemirtingasSaveRoot(executablePath, (message) =>
    warnings.push(message)
  );

  return { gameDirectory, saveRoot, warnings };
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("getNemirtingasSaveRoot", () => {
  it("keeps AppData without an executable or configuration", async () => {
    assert.equal(await getNemirtingasSaveRoot(null), undefined);
    assert.equal(await getNemirtingasSaveRoot("Game.exe"), undefined);
    assert.equal((await resolve()).saveRoot, undefined);
  });

  it("keeps AppData when the configuration does not move saves", async () => {
    assert.equal((await resolve("{}")).saveRoot, undefined);
    assert.equal(
      (await resolve(JSON.stringify({ savepath: "appdata" }))).saveRoot,
      undefined
    );
  });

  it("resolves a relative savepath inside the game directory", async () => {
    const { gameDirectory, saveRoot, warnings } = await resolve(
      JSON.stringify({ savepath: "saves\\nemirtingas" })
    );

    assert.equal(saveRoot, path.join(gameDirectory, "saves", "nemirtingas"));
    assert.deepEqual(warnings, []);
  });

  it("reads the configuration from nepice_settings", async () => {
    const { gameDirectory, saveRoot } = await resolve(
      JSON.stringify({ savepath: "saves" }),
      ["nepice_settings", "NemirtingasEpicEmu.json"]
    );

    assert.equal(saveRoot, path.join(gameDirectory, "saves"));
  });

  for (const [scenario, config] of [
    ["unreadable JSON", "{"],
    ["a non-object configuration", "[]"],
    ["a non-string savepath", JSON.stringify({ savepath: 1 })],
    ["an absolute savepath", JSON.stringify({ savepath: "C:\\Saves" })],
    ["a POSIX absolute savepath", JSON.stringify({ savepath: "/saves" })],
    ["a savepath leaving the game", JSON.stringify({ savepath: "..\\saves" })],
  ] as const) {
    it(`skips the emulator state for ${scenario}`, async () => {
      const { saveRoot, warnings } = await resolve(config);

      assert.equal(saveRoot, null);
      assert.equal(warnings.length, 1);
    });
  }

  it("skips the emulator state when the configuration is a folder", async () => {
    const { gameDirectory, executablePath } = createGame();
    fs.mkdirSync(path.join(gameDirectory, "NemirtingasEpicEmu.json"));

    assert.equal(await getNemirtingasSaveRoot(executablePath), null);
  });
});
