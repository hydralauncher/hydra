import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Game } from "@types";
import { importEpicStoreInstallations } from "./egs-auto-import.js";
import { listEpicStoreInstallations } from "./session-attribution.js";

const epicGame = (objectId: string, patch: Partial<Game> = {}) =>
  ({
    objectId,
    shop: "epic",
    title: objectId,
    isDeleted: false,
    hasActiveEpicImport: true,
    ...patch,
  }) as Game;
const store = (namespace: string, itemId: string) => ({
  artifactId: `${namespace}-artifact`,
  installLocation: `C:/Epic/${namespace}`,
  namespace,
  itemId,
});

test("imports only owned, uninstalled, idle games installed by the Epic Games Store", async () => {
  const imported: string[] = [];
  let refreshed = 0;
  const count = await importEpicStoreInstallations(
    {
      listInstallations: async () => [
        store("Ready", "Item"),
        store("Installed", "Item"),
        store("Deleted", "Item"),
        store("Downloading", "Item"),
        store("NotOwned", "Item"),
        store("Unknown", "Item"),
        { artifactId: "NoCatalog", installLocation: "C:/Epic/NoCatalog" },
        store("Failing", "Item"),
      ],
      listGames: async () => [
        epicGame("Ready:Item"),
        epicGame("Installed:Item", {
          epicInstallation: {
            owner: { environment: "e", userId: "u", epicAccountId: "a" },
            artifactId: "Installed-artifact",
            platform: "Windows",
          },
        }),
        epicGame("Deleted:Item", { isDeleted: true }),
        epicGame("Downloading:Item"),
        epicGame("NotOwned:Item", { hasActiveEpicImport: false }),
        epicGame("Failing:Item"),
      ],
      hasDownload: async (objectId) => objectId === "Downloading:Item",
      importInstallation: async (objectId) => {
        if (objectId === "Failing:Item")
          throw Object.assign(new Error("failed"), {
            code: "installation-incomplete",
          });
        imported.push(objectId);
      },
      afterImported: () => refreshed++,
      warn: () => undefined,
    },
    new AbortController().signal
  );
  assert.equal(count, 1);
  assert.deepEqual(imported, ["Ready:Item"]);
  assert.equal(refreshed, 1);
});

test("nothing is refreshed when no installation is imported", async () => {
  let refreshed = 0;
  let listedGames = false;
  assert.equal(
    await importEpicStoreInstallations(
      {
        listInstallations: async () => [],
        listGames: async () => {
          listedGames = true;
          return [];
        },
        hasDownload: async () => false,
        importInstallation: async () => undefined,
        afterImported: () => refreshed++,
        warn: () => undefined,
      },
      new AbortController().signal
    ),
    0
  );
  assert.equal(listedGames, false);
  assert.equal(refreshed, 0);
});

test("Epic Games Store manifests are listed only on Windows and incomplete installs are skipped", async (t) => {
  const programData = await fs.mkdtemp(
    path.join(os.tmpdir(), "egs-manifests-")
  );
  t.after(() => fs.rm(programData, { recursive: true, force: true }));
  const manifests = path.join(
    programData,
    "Epic",
    "EpicGamesLauncher",
    "Data",
    "Manifests"
  );
  await fs.mkdir(manifests, { recursive: true });
  const item = (name: string, value: Record<string, unknown>) =>
    fs.writeFile(path.join(manifests, name), JSON.stringify(value));
  await item("complete.item", {
    AppName: "Complete",
    InstallLocation: "C:/Epic/Complete",
    CatalogNamespace: "Namespace",
    CatalogItemId: "Item",
  });
  await item("partial.item", {
    AppName: "Partial",
    InstallLocation: "C:/Epic/Partial",
    bIsIncompleteInstall: true,
  });
  await fs.writeFile(path.join(manifests, "broken.item"), "{");
  await item("ignored.json", { AppName: "Ignored", InstallLocation: "C:/x" });
  assert.deepEqual(
    await listEpicStoreInstallations(
      undefined,
      programData,
      "win32",
      programData
    ),
    [
      {
        artifactId: "Complete",
        installLocation: "C:/Epic/Complete",
        namespace: "Namespace",
        itemId: "Item",
      },
    ]
  );
  assert.deepEqual(
    await listEpicStoreInstallations(
      undefined,
      programData,
      "linux",
      programData
    ),
    []
  );
});

test("new Epic launcher installations are replayed and stale legacy entries are skipped", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "egs-v2-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const programData = path.join(root, "ProgramData");
  const localAppData = path.join(root, "Local");
  const dredge = path.join(root, "Games", "Dredge");
  const legacyOnly = path.join(root, "Games", "LegacyOnly");
  await fs.mkdir(dredge, { recursive: true });
  await fs.mkdir(legacyOnly, { recursive: true });
  await fs.mkdir(path.join(localAppData, "com.epicgames.eglv2"), {
    recursive: true,
  });
  await fs.mkdir(path.join(programData, "Epic", "UnrealEngineLauncher"), {
    recursive: true,
  });

  const record = (value: Record<string, unknown>) => JSON.stringify(value);
  await fs.writeFile(
    path.join(localAppData, "com.epicgames.eglv2", "installations.jsonl"),
    [
      record({ version: 1, entries: 3 }),
      record({
        installationId: "dredge",
        complete: true,
        dir: dredge,
        platform: "Windows",
        namespace: "dredge-namespace",
        itemId: "dredge-item",
        artifactId: "Dredge",
      }),
      record({
        installationId: "removed",
        complete: true,
        dir: path.join(root, "Games", "Removed"),
        platform: "Windows",
        artifactId: "Removed",
      }),
      record({ installationId: "removed", deleted: true }),
      "{",
    ].join("\n")
  );
  await fs.writeFile(
    path.join(
      programData,
      "Epic",
      "UnrealEngineLauncher",
      "LauncherInstalled.dat"
    ),
    JSON.stringify({
      InstallationList: [
        { AppName: "Dredge", InstallLocation: dredge },
        { AppName: "Removed", InstallLocation: legacyOnly },
        {
          AppName: "LegacyOnly",
          InstallLocation: legacyOnly,
          NamespaceId: "legacy-namespace",
          ItemId: "legacy-item",
        },
        { AppName: "Missing", InstallLocation: path.join(root, "Gone") },
      ],
    })
  );

  assert.deepEqual(
    await listEpicStoreInstallations(
      undefined,
      programData,
      "win32",
      localAppData
    ),
    [
      {
        artifactId: "Dredge",
        installLocation: dredge,
        namespace: "dredge-namespace",
        itemId: "dredge-item",
      },
      {
        artifactId: "LegacyOnly",
        installLocation: legacyOnly,
        namespace: "legacy-namespace",
        itemId: "legacy-item",
      },
    ]
  );
});
