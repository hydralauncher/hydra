import fs from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import {
  classifyEpicItem,
  normalizeEpicLibrary,
  normalizeEpicPlaytime,
  applyEpicPlaytime,
  getEpicGamePlaytime,
} from "./library-normalizer.js";
import { buildEpicSnapshotChunks } from "./sync-snapshot.js";
import { epicRetryAfter, fetchEpicWithRetry } from "./source-retry.js";
import { EpicPlaytimeSource } from "./playtime-source.js";
import {
  parseEpicInstallManifest,
  isPathInside,
} from "./session-attribution.js";
import { resolveEpicSessionPlaytimePolicy } from "./playtime-policy.js";
import {
  EpicSyncOrchestrator,
  type EpicSyncDependencies,
  type EpicSyncJournal,
} from "./sync-orchestrator.js";
import {
  EPIC_SNAPSHOT_MAX_CHUNK_BYTES,
  EPIC_SNAPSHOT_CHUNK_GAMES,
  EPIC_NETWORK_BACKOFF_MS,
  EPIC_RATE_LIMIT_BACKOFF_MS,
  EPIC_PENDING_EXPIRATION_MS,
} from "./constants.js";
import { EpicIntegrationError } from "./auth-protocol.js";
import type {
  EpicSyncFinished,
  EpicSyncRun,
} from "../../../types/epic-integration.types";

const connection = {
  connected: true as const,
  connectionId: "AbCdEfG1",
  epicAccountId: "a".repeat(32),
  displayName: "Test",
  connectedAt: "2026-10-12T00:00:00Z",
};
const auth = {
  environment: "https://api.test",
  userId: "HydraA",
  generation: 1,
};
const context = { auth, connection };
const item = (artifact = "Artifact", id = "Item") => ({
  app_name: artifact,
  app_title: "Game",
  metadata: {
    namespace: "Namespace",
    id,
    categories: [{ path: "games" }, { path: "applications" }],
  },
  asset_infos: {
    Windows: {
      app_name: artifact,
      namespace: "Namespace",
      catalog_item_id: id,
    },
  },
});
const row = (artifactId = "Artifact", totalTime = 100) => ({
  artifactId,
  totalTime,
  accountId: connection.epicAccountId,
});

describe("Epic library normalization", () => {
  it("uses item identity, accepts applications alongside games and takes max across aliases/platforms", () => {
    const library = normalizeEpicLibrary([
      [item("Windows")],
      [item("Mac"), item("Windows")],
    ]);
    const snapshot = applyEpicPlaytime(
      library,
      normalizeEpicPlaytime(
        [
          row("Windows", 50),
          row("Mac", 60),
          row("Windows", 40),
          row("Unknown", 999),
        ],
        connection.epicAccountId
      )
    );
    assert.deepEqual(snapshot, [
      {
        namespace: "Namespace",
        catalogItemId: "Item",
        artifactIds: ["Mac", "Windows"],
        name: "Game",
        playTimeInSeconds: 60,
      },
    ]);
  });
  it("distinguishes complete empty library from malformed/partial source", () => {
    assert.deepEqual(normalizeEpicLibrary([[], []]), []);
    assert.throws(() => normalizeEpicLibrary([[], undefined]));
  });
  it("never uses a matching title to merge identities", () =>
    assert.equal(
      normalizeEpicLibrary([[item("A", "A"), item("B", "B")]]).length,
      2
    ));
  it("sorts aliases and names alphabetically without depending on platform or input order", () => {
    const entries = ["Zebra", "zebra", "Álpha", "alpha"].map((name) => ({
      ...item(name),
      app_title: name,
    }));
    const other = { ...item("Other", "Other"), app_title: "alpha" };
    const library = normalizeEpicLibrary([entries, [other]]);
    assert.deepEqual(
      library,
      normalizeEpicLibrary([[other], [...entries].reverse()])
    );
    assert.equal(library.length, 2);
    assert.deepEqual(library[0].artifactIds, [
      "alpha",
      "Álpha",
      "zebra",
      "Zebra",
    ]);
    assert.equal(library[0].name, "alpha");
    assert.equal(library[0].catalogItemId, "Item");
    assert.equal(library[1].catalogItemId, "Other");
  });
  it("breaks Unicode collation ties consistently without collapsing distinct artifacts", () => {
    const composed = "Café";
    const decomposed = "Cafe\u0301";
    const entries = [composed, decomposed].map((name) => ({
      ...item(name),
      app_title: name,
    }));
    const library = normalizeEpicLibrary([entries]);
    assert.deepEqual(library, normalizeEpicLibrary([[...entries].reverse()]));
    assert.deepEqual(library[0].artifactIds, [decomposed, composed]);
    assert.equal(library[0].name, decomposed);
  });
  it("rejects conflicting artifacts, asset identities and unknown product kinds", () => {
    assert.throws(() =>
      normalizeEpicLibrary([[item("A", "A"), item("A", "B")]])
    );
    const invalid = item();
    invalid.asset_infos.Windows.catalog_item_id = "Wrong";
    assert.throws(() => normalizeEpicLibrary([[invalid]]));
    assert.throws(() =>
      normalizeEpicLibrary([
        [
          {
            ...item(),
            metadata: {
              namespace: "N",
              id: "I",
              categories: [{ path: "applications" }],
            },
          },
        ],
      ])
    );
  });
  for (const category of ["addons", "addons/launchable"]) {
    it(`excludes verified non-game category ${category}`, () =>
      assert.equal(
        classifyEpicItem({ categories: [{ path: category }] }),
        "exclude"
      ));
  }
  it("blocks conflicting and unproven classification instead of inventing tool or demo categories", () => {
    for (const category of ["software", "mods", "games/demo", "games/test"]) {
      assert.equal(
        classifyEpicItem({ categories: [{ path: category }] }),
        "unknown"
      );
      assert.equal(
        classifyEpicItem({
          categories: [{ path: "games" }, { path: category }],
        }),
        "unknown"
      );
    }
    assert.equal(
      classifyEpicItem({
        categories: [{ path: "games" }, { path: "addons/launchable" }],
      }),
      "unknown"
    );
    assert.equal(
      classifyEpicItem({ categories: [{ path: "games" }, {}] }),
      "unknown"
    );
  });
  it("excludes DLC relationship and Unreal namespace", () => {
    assert.equal(
      classifyEpicItem({ ...item().metadata, mainGameItem: { id: "Base" } }),
      "exclude"
    );
    assert.equal(
      classifyEpicItem({ ...item().metadata, namespace: "ue" }),
      "exclude"
    );
  });
  for (const total of [-1, 1.5, NaN, Infinity, 2_147_483_648])
    it(`rejects invalid accumulated time ${total}`, () =>
      assert.throws(() =>
        normalizeEpicPlaytime(
          [row("Artifact", total)],
          connection.epicAccountId
        )
      ));
  it("rejects the complete reply when one row belongs to another account", () =>
    assert.throws(() =>
      normalizeEpicPlaytime(
        [row(), { ...row(), accountId: "b".repeat(32) }],
        connection.epicAccountId
      )
    ));
  it("uses zero only for complete snapshots; missing individual history remains null", () => {
    assert.equal(
      applyEpicPlaytime(normalizeEpicLibrary([[item()]]), new Map())[0]
        .playTimeInSeconds,
      0
    );
    assert.equal(getEpicGamePlaytime(["Artifact"], new Map()), null);
  });
});

describe("Epic snapshot transport", () => {
  it("publishes a single empty chunk", () =>
    assert.deepEqual(buildEpicSnapshotChunks(connection.connectionId, []), [
      { connectionId: connection.connectionId, totalChunks: 1, games: [] },
    ]));
  it("bounds both game count and actual UTF-8 bytes", () => {
    const base = normalizeEpicLibrary([[item()]])[0];
    const games = Array.from({ length: 600 }, (_, index) => ({
      ...base,
      catalogItemId: String(index),
      name: "界".repeat(256),
      artifactIds: Array.from({ length: 16 }, (_, n) =>
        `${n}`.padEnd(255, "x")
      ),
    }));
    const chunks = buildEpicSnapshotChunks(connection.connectionId, games);
    assert.equal(chunks.flatMap((chunk) => chunk.games).length, games.length);
    for (const chunk of chunks) {
      assert.ok(chunk.games.length <= EPIC_SNAPSHOT_CHUNK_GAMES);
      assert.ok(
        Buffer.byteLength(JSON.stringify(chunk), "utf8") <=
          EPIC_SNAPSHOT_MAX_CHUNK_BYTES
      );
      assert.equal(chunk.totalChunks, chunks.length);
    }
  });
});

describe("Epic retries and cache", () => {
  it("refreshes once on 401 and does not loop on revoked credentials", async () => {
    let calls = 0,
      refreshes = 0;
    await assert.rejects(
      fetchEpicWithRetry(
        async () => {
          calls++;
          return new Response(null, { status: 401 });
        },
        new AbortController().signal,
        async () => {
          refreshes++;
        }
      ),
      /session-expired/
    );
    assert.equal(calls, 2);
    assert.equal(refreshes, 1);
  });
  it("retries network/server/rate limits with named backoffs and Retry-After", async () => {
    const delays: number[] = [];
    const responses = [
      new Response(null, { status: 503 }),
      new Response(null, { status: 429, headers: { "Retry-After": "2" } }),
      new Response("[]"),
    ];
    await fetchEpicWithRetry(
      async () => responses.shift()!,
      new AbortController().signal,
      async () => {},
      async (ms) => {
        delays.push(ms);
      }
    );
    assert.deepEqual(delays, [EPIC_NETWORK_BACKOFF_MS, 2000]);
    assert.equal(epicRetryAfter("bad"), null);
    assert.equal(epicRetryAfter("2"), EPIC_RATE_LIMIT_BACKOFF_MS * 2);
    assert.equal(
      epicRetryAfter(
        "Mon, 12 Oct 2026 00:00:02 GMT",
        Date.parse("2026-10-12T00:00:00Z")
      ),
      2000
    );
  });
  it("does not retry 403 or fabricate data", async () => {
    let calls = 0;
    await assert.rejects(
      fetchEpicWithRetry(
        async () => {
          calls++;
          return new Response(null, { status: 403 });
        },
        new AbortController().signal,
        async () => {}
      ),
      /source-permission/
    );
    assert.equal(calls, 1);
  });
  it("coalesces consumers independently, isolates context, and makes fresh requests", async () => {
    let calls = 0;
    const source = new EpicPlaytimeSource(
      { token: async () => "private-token" },
      async (_url, options) => {
        calls++;
        assert.equal(options?.redirect, "error");
        assert.equal(
          (options?.headers as Record<string, string>).Authorization,
          "Bearer private-token"
        );
        await Promise.resolve();
        return new Response(JSON.stringify([row()]));
      }
    );
    const a = new AbortController(),
      b = new AbortController();
    const first = source.get(auth, connection, a.signal);
    const second = source.get(auth, connection, b.signal);
    a.abort();
    await assert.rejects(first);
    assert.equal((await second).get("Artifact"), 100);
    assert.equal(calls, 1);
    await source.get(auth, connection, b.signal);
    assert.equal(calls, 1);
    await source.get(auth, connection, b.signal, true);
    assert.equal(calls, 2);
    await source.get({ ...auth, generation: 3 }, connection, b.signal);
    assert.equal(calls, 3);
    source.invalidate();
  });
});

describe("Epic installation attribution", () => {
  it("requires complete manifest and exact alias, with optional identity", () => {
    assert.deepEqual(
      parseEpicInstallManifest({
        AppName: "Artifact",
        InstallLocation: "C:\\Games\\Game",
        CatalogNamespace: "Namespace",
        CatalogItemId: "Item",
      }),
      {
        artifactId: "Artifact",
        installLocation: "C:\\Games\\Game",
        namespace: "Namespace",
        itemId: "Item",
      }
    );
    assert.equal(
      parseEpicInstallManifest({
        AppName: "Artifact",
        InstallLocation: "C:\\Games",
        bIsIncompleteInstall: true,
      }),
      null
    );
    assert.equal(parseEpicInstallManifest({ AppName: "Artifact" }), null);
  });
  it("rejects sibling paths and traversal on Windows", () => {
    assert.equal(
      isPathInside(
        "C:\\Games\\Game",
        "C:\\Games\\Game\\bin\\game.exe",
        path.win32
      ),
      true
    );
    assert.equal(
      isPathInside("C:\\Games\\Game", "C:\\Games\\Game2\\game.exe", path.win32),
      false
    );
    assert.equal(
      isPathInside(
        "C:\\Games\\Game",
        "C:\\Games\\Game\\..\\other.exe",
        path.win32
      ),
      false
    );
  });
  it("suppresses only confirmed Epic sessions and keeps exit sync with Hydra opt-in", () => {
    assert.deepEqual(resolveEpicSessionPlaytimePolicy(true, true, false), {
      countHydraPlaytime: false,
      syncEpicOnExit: true,
    });
    assert.deepEqual(resolveEpicSessionPlaytimePolicy(true, true, true), {
      countHydraPlaytime: true,
      syncEpicOnExit: true,
    });
    assert.deepEqual(resolveEpicSessionPlaytimePolicy(true, false, false), {
      countHydraPlaytime: true,
      syncEpicOnExit: false,
    });
  });
});

const runId = "RunAbCd1";
function syncFixture() {
  const state = {
    journal: null as EpicSyncJournal | null,
    status: "PENDING" as EpicSyncRun["status"],
    current: true,
    createdAt: new Date().toISOString(),
    starts: 0,
    cancels: 0,
    uploads: 0,
    commits: 0,
    merges: 0,
    collections: 0,
    mergeOk: true,
    result: null as EpicSyncFinished | null,
  };
  const deps: EpicSyncDependencies = {
    capture: async () => context,
    current: () => state.current,
    library: async () => {
      state.collections++;
      return normalizeEpicLibrary([[item()]]);
    },
    playtime: async () =>
      normalizeEpicPlaytime([row()], connection.epicAccountId),
    start: async () => {
      state.starts++;
      state.status = "PENDING";
      return runId;
    },
    run: async () => ({
      id: runId,
      status: state.status,
      trigger: "MANUAL",
      gamesCount: 1,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: state.createdAt,
    }),
    upload: async () => {
      state.uploads++;
    },
    commit: async () => {
      state.commits++;
      state.status = "SUCCEEDED";
    },
    cancel: async () => {
      state.cancels++;
      state.status = "FAILED";
    },
    journal: async () => state.journal,
    saveJournal: async (_context, journal) => {
      state.journal = journal;
    },
    merge: async () => {
      state.merges++;
      return state.mergeOk;
    },
    emit: () => {},
    finished: (result) => {
      state.result = result;
    },
  };
  return { state, deps, sync: new EpicSyncOrchestrator(deps) };
}
describe("Epic publication reconciliation", () => {
  it("serializes simultaneous preparation and publishes only one sync", async () => {
    const f = syncFixture();
    let releaseCapture!: () => void;
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    let releaseLibrary!: () => void;
    const libraryGate = new Promise<void>((resolve) => {
      releaseLibrary = resolve;
    });
    let captures = 0;
    f.deps.capture = async () => {
      captures++;
      await captureGate;
      return context;
    };
    const collectLibrary = f.deps.library;
    f.deps.library = async (...args) => {
      await libraryGate;
      return collectLibrary(...args);
    };
    try {
      const starts = Promise.all([
        f.sync.start(connection.connectionId),
        f.sync.start(connection.connectionId),
        f.sync.start(connection.connectionId),
      ]);
      assert.equal(captures, 1);
      releaseCapture();
      const states = await starts;
      assert.ok(states.every((state) => state.status === "running"));
      assert.equal(f.state.starts, 1);
      releaseLibrary();
      await f.sync.wait();
      assert.equal(f.state.collections, 1);
      assert.equal(f.state.uploads, 1);
      assert.equal(f.state.commits, 1);
      assert.equal(f.state.merges, 1);
      assert.equal(f.state.result?.ok, true);
    } finally {
      releaseCapture();
      releaseLibrary();
      await f.sync.abortAndWait();
    }
  });
  it("publishes accumulated time once and clears journal after merge", async () => {
    const f = syncFixture();
    await f.sync.start(connection.connectionId);
    await f.sync.wait();
    assert.equal(f.state.starts, 1);
    assert.equal(f.state.cancels, 0);
    assert.equal(f.state.commits, 1);
    assert.equal(f.state.merges, 1);
    assert.equal(f.state.journal, null);
    assert.equal(f.state.result?.ok, true);
  });
  it("retries only local merge after confirmed publication", async () => {
    const f = syncFixture();
    f.state.mergeOk = false;
    await f.sync.start(connection.connectionId);
    await f.sync.wait();
    assert.equal(f.state.result?.publication, "published");
    assert.equal(f.state.result?.requiresMerge, true);
    f.state.mergeOk = true;
    await f.sync.start(connection.connectionId);
    await f.sync.wait();
    assert.equal(f.state.collections, 1);
    assert.equal(f.state.commits, 1);
    assert.equal(f.state.merges, 2);
  });
  it("reconciles lost successful commit response", async () => {
    const f = syncFixture();
    f.deps.commit = async () => {
      f.state.status = "SUCCEEDED";
      throw new Error("response-lost");
    };
    await f.sync.start(connection.connectionId);
    await f.sync.wait();
    assert.equal(f.state.result?.ok, true);
    assert.equal(f.state.merges, 1);
  });
  it("cancels local merge after commit and resumes only that merge", async () => {
    const f = syncFixture();
    let began: () => void;
    const merging = new Promise<void>((resolve) => {
      began = resolve;
    });
    f.deps.merge = async (_context, _progress, signal) => {
      began();
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true })
      );
      return false;
    };
    await f.sync.start(connection.connectionId);
    await merging;
    await f.sync.cancel(connection.connectionId);
    assert.equal(f.state.result?.publication, "published");
    assert.equal(f.state.result?.requiresMerge, true);
    assert.equal(f.state.cancels, 0);
    assert.equal(f.state.journal?.mergePending, true);
    f.deps.merge = async () => true;
    await f.sync.start(connection.connectionId);
    await f.sync.wait();
    assert.equal(f.state.collections, 1);
    assert.equal(f.state.commits, 1);
    assert.equal(f.state.journal, null);
    assert.equal(f.state.result?.ok, true);
  });
  it("does not adopt an unknown active run", async () => {
    const f = syncFixture();
    f.deps.start = async () => {
      throw new EpicIntegrationError("sync-active");
    };
    await f.sync.start(connection.connectionId);
    await f.sync.wait();
    assert.equal(f.state.uploads, 0);
    assert.equal(f.state.cancels, 0);
    assert.equal(f.state.result?.error, "sync-active");
  });
  it("replaces owned staging when totalChunks changed or was unknown", async () => {
    for (const totalChunks of [null, 2]) {
      const f = syncFixture();
      f.state.journal = { syncRunId: runId, totalChunks, mergePending: false };
      await f.sync.start(connection.connectionId);
      await f.sync.wait();
      assert.equal(f.state.cancels, 1);
      assert.equal(f.state.starts, 1);
      assert.equal(f.state.uploads, 1);
    }
  });
  it("drops callbacks after a context change before publication", async () => {
    const f = syncFixture();
    f.deps.library = async () => {
      f.state.current = false;
      return [];
    };
    await f.sync.start(connection.connectionId);
    await f.sync.wait();
    assert.equal(f.state.uploads, 0);
    assert.equal(f.state.commits, 0);
    assert.equal(f.state.result, null);
  });
  it("preserves library when collection fails", async () => {
    const f = syncFixture();
    f.deps.playtime = async () => {
      throw new EpicIntegrationError("source-permission");
    };
    await f.sync.start(connection.connectionId);
    await f.sync.wait();
    assert.equal(f.state.commits, 0);
    assert.equal(f.state.merges, 0);
    assert.equal(f.state.result?.publication, "not-published");
  });
});

it("asks the server to expire an abandoned owned run before collecting", async () => {
  const f = syncFixture();
  f.state.journal = { syncRunId: runId, totalChunks: 1, mergePending: false };
  f.state.createdAt = new Date(
    Date.now() - 2 * EPIC_PENDING_EXPIRATION_MS
  ).toISOString();
  await f.sync.start(connection.connectionId);
  await f.sync.wait();
  assert.equal(f.state.starts, 1);
  assert.equal(f.state.cancels, 0);
  assert.equal(f.state.result?.ok, true);
});

it("normalizes the sanitized real Legendary library format", () => {
  const records = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/legendary-library.json", import.meta.url),
      "utf8"
    )
  );
  const games = normalizeEpicLibrary([records, records]);
  assert.equal(games.length, 13);
  assert.ok(
    games.every(
      (game) => game.artifactIds.length === 1 && game.playTimeInSeconds === 0
    )
  );
});
