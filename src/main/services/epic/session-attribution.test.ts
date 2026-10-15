import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  isEpicInstallExecutable,
  parseLegendaryInstalledGame,
} from "./session-attribution.js";
import { getContextualEpicGame } from "./import-visibility.js";
import type { Game } from "@types";

test("uses an explicit installation manifest and rejects aliases, sibling paths and realpath escapes", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-attribution-")
  );
  const previous = process.env.LEGENDARY_CONFIG_PATH;
  const previousProgramData = process.env.PROGRAMDATA;
  try {
    const config = path.join(root, "config");
    const install = path.join(root, "game");
    const outside = path.join(root, "game-other");
    await Promise.all([fs.mkdir(config), fs.mkdir(install), fs.mkdir(outside)]);
    const executable = path.join(install, "game.exe");
    const otherExecutable = path.join(outside, "game.exe");
    await Promise.all([
      fs.writeFile(executable, "fixture"),
      fs.writeFile(otherExecutable, "fixture"),
    ]);
    await fs.writeFile(
      path.join(config, "installed.json"),
      JSON.stringify({
        Artifact: {
          app_name: "Artifact",
          install_path: install,
          is_dlc: false,
          needs_verification: false,
          is_preloaded: false,
        },
      })
    );
    process.env.LEGENDARY_CONFIG_PATH = config;
    process.env.PROGRAMDATA = root;
    assert.equal(
      await isEpicInstallExecutable("Namespace:Item", ["Artifact"], executable),
      true
    );
    assert.equal(
      await isEpicInstallExecutable("Namespace:Item", ["Unknown"], executable),
      false
    );
    assert.equal(
      await isEpicInstallExecutable(
        "Namespace:Item",
        ["Artifact"],
        otherExecutable
      ),
      false
    );
    const link = path.join(install, "outside");
    await fs.symlink(outside, link, "junction");
    try {
      assert.equal(
        await isEpicInstallExecutable(
          "Namespace:Item",
          ["Artifact"],
          path.join(link, "game.exe")
        ),
        false
      );
    } finally {
      await fs.unlink(link);
    }
    const controller = new AbortController();
    controller.abort();
    assert.equal(
      await isEpicInstallExecutable(
        "Namespace:Item",
        ["Artifact"],
        executable,
        null,
        controller.signal
      ),
      false
    );
  } finally {
    if (previous === undefined) delete process.env.LEGENDARY_CONFIG_PATH;
    else process.env.LEGENDARY_CONFIG_PATH = previous;
    if (previousProgramData === undefined) delete process.env.PROGRAMDATA;
    else process.env.PROGRAMDATA = previousProgramData;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("does not attribute incomplete, preloaded or DLC Legendary installations", () => {
  const installation = {
    app_name: "Artifact",
    install_path: "C:\\Games\\Game",
  };
  assert.ok(parseLegendaryInstalledGame(installation));
  for (const flag of ["is_dlc", "needs_verification", "is_preloaded"]) {
    assert.equal(
      parseLegendaryInstalledGame({ ...installation, [flag]: true }),
      null
    );
  }
  assert.equal(parseLegendaryInstalledGame({ app_name: "Artifact" }), null);
});

test("recognizes the Hydra managed workspace only with exact metadata identity", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-managed-attribution-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const install = path.join(root, "install"),
    workspace = path.join(root, "managed");
  await Promise.all([
    fs.mkdir(install),
    fs.mkdir(path.join(workspace, "metadata"), { recursive: true }),
  ]);
  const executable = path.join(install, "game.exe");
  await fs.writeFile(executable, "fixture");
  await fs.writeFile(
    path.join(workspace, "installed.json"),
    JSON.stringify({
      Artifact: {
        app_name: "Artifact",
        install_path: install,
        is_dlc: false,
        needs_verification: false,
      },
    })
  );
  const metadata = path.join(workspace, "metadata", "Artifact.json");
  await fs.writeFile(
    metadata,
    JSON.stringify({
      app_name: "Artifact",
      metadata: { namespace: "Namespace", id: "Item" },
    })
  );
  assert.equal(
    await isEpicInstallExecutable(
      "Namespace:Item",
      ["Artifact"],
      executable,
      null,
      undefined,
      [workspace]
    ),
    true
  );
  await fs.writeFile(
    metadata,
    JSON.stringify({
      app_name: "Artifact",
      metadata: { namespace: "Namespace", id: "Other" },
    })
  );
  assert.equal(
    await isEpicInstallExecutable(
      "Namespace:Item",
      ["Artifact"],
      executable,
      null,
      undefined,
      [workspace]
    ),
    false
  );
  await fs.rm(metadata);
  assert.equal(
    await isEpicInstallExecutable(
      "Namespace:Item",
      ["Artifact"],
      executable,
      null,
      undefined,
      [workspace]
    ),
    false
  );
});

test("hides stale exclusive imports and preserves Hydra data across A to B to A", () => {
  const context = { environment: "staging", userId: "A" };
  const game = {
    title: "Game",
    shop: "epic",
    objectId: "Namespace:Item",
    source: "epic",
    isDeleted: false,
    playTimeInMilliseconds: 100,
    steamPlayTimeInMilliseconds: 200,
    epicPlayTimeInMilliseconds: 300,
    hasActiveEpicImport: true,
    favorite: true,
    executablePath: "C:\\Games\\game.exe",
    epicImportScope: { ...context, connectionId: "connection" },
  } as Game;
  assert.equal(getContextualEpicGame(game, context), game);
  for (const other of [
    null,
    { ...context, userId: "B" },
    { ...context, environment: "production" },
  ]) {
    const hidden = getContextualEpicGame(game, other);
    assert.equal(hidden.isDeleted, true);
    assert.equal(hidden.epicPlayTimeInMilliseconds, 0);
    assert.equal(hidden.hasActiveEpicImport, false);
    assert.equal(hidden.playTimeInMilliseconds, 100);
    assert.equal(hidden.steamPlayTimeInMilliseconds, 200);
    assert.equal(hidden.favorite, true);
    assert.equal(hidden.executablePath, game.executablePath);
    assert.equal(
      getContextualEpicGame({ ...game, source: "hydra" }, other).isDeleted,
      false
    );
  }
  assert.equal(getContextualEpicGame(game, context), game);
});
