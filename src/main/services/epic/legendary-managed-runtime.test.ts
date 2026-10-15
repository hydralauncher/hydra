import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  LegendaryLineDecoder,
  LegendaryManagedRuntime,
  executeManagedLegendary,
  managedWorkspacePath,
  type EpicManagedTarget,
} from "./legendary-managed-runtime.js";
import { EpicConnectionStore } from "./store.js";
import { EpicSessionProvider } from "./session-provider.js";
import { EPIC_PROCESS_MAX_LINE_BYTES } from "./constants.js";
import { configureEpicTiming, type EpicTimingEntry } from "./timing.js";
import {
  MemoryDatabase,
  bundle,
  connection,
  deferred,
} from "./store-test-helpers.js";

const auth = {
  environment: "https://api.example.test",
  userId: "managed-test",
  generation: 1,
};
const target: EpicManagedTarget = {
  auth,
  connection,
  owner: {
    environment: auth.environment,
    userId: auth.userId,
    epicAccountId: connection.epicAccountId,
  },
  artifactId: "Artifact1",
  platform: "Windows",
};
async function fixture(
  t: TestContext,
  execute: typeof executeManagedLegendary
) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-managed-")
  );
  const database = new MemoryDatabase();
  const store = new EpicConnectionStore({
    userDataPath: directory,
    createDatabase: () => database,
  });
  await store.save(auth, connection, bundle, () => true);
  let current = true;
  const session = new EpicSessionProvider(
    store,
    directory,
    async () => "fixture",
    () => current
  );
  const runtime = new LegendaryManagedRuntime({
    userData: directory,
    binary: async () => "fixture",
    session,
    current: () => current,
    execute,
  });
  t.after(async () => {
    await runtime.stop();
    await store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    store,
    session,
    runtime,
    invalidate: () => {
      current = false;
    },
  };
}

test("install timing identifies the real command behind the global yes flag", async (t) => {
  const entries: EpicTimingEntry[] = [];
  const f = await fixture(t, async () => ({ stdout: "{}", stderr: "" }));
  configureEpicTiming((entry) => entries.push(entry), true);
  t.after(() => configureEpicTiming(() => undefined, false));
  await f.runtime.runRaw(target, ["-y", "install", "Artifact1"], {
    signal: new AbortController().signal,
  });
  assert.ok(
    entries.some(
      (entry) => entry.stage === "runtime.raw" && entry.command === "install"
    )
  );
});

test("stream decoder handles fragmented Unicode, CR/LF, and bounded lines", () => {
  const lines: string[] = [];
  const decoder = new LegendaryLineDecoder((line) => lines.push(line));
  const text = Buffer.from("Jogo aç\rProgress: 25%\r\nFinished\n尾");
  decoder.push(text.subarray(0, 8));
  decoder.push(text.subarray(8, 11));
  decoder.push(text.subarray(11));
  decoder.end();
  assert.deepEqual(lines, ["Jogo aç", "Progress: 25%", "Finished", "尾"]);
  assert.throws(
    () =>
      new LegendaryLineDecoder(() => {}).push(
        Buffer.alloc(EPIC_PROCESS_MAX_LINE_BYTES + 1, 97)
      ),
    { code: "invalid-response" }
  );
});

test("managed workspace isolates account, environment, artifact and platform", () => {
  const root = path.resolve("managed-test-root");
  const first = managedWorkspacePath(
    root,
    target.owner,
    "Artifact1",
    "Windows"
  );
  for (const [owner, artifact, platform] of [
    [{ ...target.owner, userId: "other" }, "Artifact1", "Windows"],
    [
      { ...target.owner, environment: "https://staging.example.test" },
      "Artifact1",
      "Windows",
    ],
    [
      { ...target.owner, epicAccountId: "b".repeat(32) },
      "Artifact1",
      "Windows",
    ],
    [target.owner, "Artifact2", "Windows"],
    [target.owner, "Artifact1", "Mac"],
  ] as const)
    assert.notEqual(
      managedWorkspacePath(root, owner, artifact, platform),
      first
    );
  assert.ok(first.startsWith(path.join(root, "epic-managed")));
  assert.ok(!first.includes(target.owner.epicAccountId));
});

test("an obsolete preview waiting for the session cancels before running Legendary", async (t) => {
  let executed = false;
  const f = await fixture(t, async () => {
    executed = true;
    return { stdout: "{}", stderr: "" };
  });
  const release = deferred<void>();
  const leased = deferred<void>();
  const blocker = f.session.serialize(async () => {
    leased.resolve();
    await release.promise;
  });
  await leased.promise;
  const controller = new AbortController();
  const request = f.runtime.runRaw(target, ["info", "Artifact1", "--json"], {
    signal: controller.signal,
  });
  const cancelled = assert.rejects(request, { code: "operation-cancelled" });
  controller.abort();
  await cancelled;
  assert.equal(executed, false);
  release.resolve();
  await blocker;
  await f.session.serialize(async () => {});
  assert.equal(executed, false);
  await f.runtime.runRaw(target, ["info", "Artifact1", "--json"], {
    signal: new AbortController().signal,
  });
  assert.equal(executed, true);
});

test("an obsolete preview waiting for its workspace cancels without releasing the active task", async (t) => {
  let executed = false;
  const f = await fixture(t, async () => {
    executed = true;
    return { stdout: "{}", stderr: "" };
  });
  const release = deferred<void>();
  const leased = deferred<void>();
  const blocker = f.runtime.serializeWorkspace(target, async () => {
    leased.resolve();
    await release.promise;
  });
  await leased.promise;
  const controller = new AbortController();
  const request = f.runtime.runRaw(target, ["info", "Artifact1", "--json"], {
    signal: controller.signal,
  });
  const cancelled = assert.rejects(request, { code: "operation-cancelled" });
  controller.abort();
  await cancelled;
  const latest = f.runtime.runRaw(target, ["info", "Artifact1", "--json"], {
    signal: new AbortController().signal,
  });
  await Promise.resolve();
  assert.equal(executed, false);
  release.resolve();
  await blocker;
  await latest;
  assert.equal(executed, true);
});

for (const kind of ["offline launch", "download stream"] as const) {
  test(`a queued ${kind} cancels without executing Legendary or releasing the active workspace`, async (t) => {
    let executed = false;
    const f = await fixture(t, async () => {
      executed = true;
      return { stdout: "{}", stderr: "" };
    });
    const release = deferred<void>();
    const entered = deferred<void>();
    const active = f.runtime.serializeWorkspace(target, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const controller = new AbortController();
    const operation =
      kind === "offline launch"
        ? f.runtime.runOfflineLaunch(
            { ...target, localOnly: true },
            { signal: controller.signal }
          )
        : f.runtime.stream(target, ["-y", "install", target.artifactId], {
            signal: controller.signal,
            onLine: () => {},
          });
    const cancelled = assert.rejects(operation, {
      code: "operation-cancelled",
    });
    let nextRan = false;
    const next = f.runtime.serializeWorkspace(target, async () => {
      nextRan = true;
    });
    try {
      controller.abort();
      await cancelled;
      assert.equal(executed, false);
      assert.equal(nextRan, false);
    } finally {
      release.resolve();
      await active;
      await next;
    }
    assert.equal(executed, false);
    await assert.rejects(
      fs.stat(path.join(f.runtime.workspace(target), "user.json")),
      { code: "ENOENT" }
    );
  });
}

test("download releases credential lease at preparation and persists rotation before transfer ends", async (t) => {
  const transfer = deferred<void>();
  const prepared = deferred<void>();
  const f = await fixture(t, async (_binary, _args, directory, options) => {
    const user = JSON.parse(
      await fs.readFile(path.join(directory, "user.json"), "utf8")
    );
    await fs.writeFile(
      path.join(directory, "user.json"),
      JSON.stringify({
        ...user,
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
      })
    );
    options.onLine?.("[cli] INFO: Download size: 20.00 MiB");
    prepared.resolve();
    await transfer.promise;
    return { stdout: "", stderr: "" };
  });
  const operation = f.runtime.stream(target, ["-y", "install", "Artifact1"], {
    signal: new AbortController().signal,
    onLine: () => {},
  });
  await prepared.promise;
  await f.session.serialize(async () => {
    assert.equal(
      (await f.store.read(auth))?.bundle?.user.refresh_token,
      "rotated-refresh"
    );
    await assert.rejects(
      fs.access(path.join(f.runtime.workspace(target), "user.json")),
      { code: "ENOENT" }
    );
  });
  let finished = false;
  void operation.then(() => {
    finished = true;
  });
  assert.equal(finished, false);
  transfer.resolve();
  await operation;
});

test("failed authenticated preparation saves rotated credentials and removes only credential copies", async (t) => {
  const f = await fixture(t, async (_binary, _args, directory) => {
    const user = JSON.parse(
      await fs.readFile(path.join(directory, "user.json"), "utf8")
    );
    await fs.writeFile(
      path.join(directory, "user.json"),
      JSON.stringify({ ...user, refresh_token: "rotated-before-error" })
    );
    await fs.writeFile(path.join(directory, "installed.json"), "{}");
    throw new Error("failed");
  });
  await assert.rejects(
    f.runtime.runJson(target, ["info", "Artifact1", "--json"], {
      signal: new AbortController().signal,
    })
  );
  assert.equal(
    (await f.store.read(auth))?.bundle?.user.refresh_token,
    "rotated-before-error"
  );
  assert.equal(
    await fs.readFile(
      path.join(f.runtime.workspace(target), "installed.json"),
      "utf8"
    ),
    "{}"
  );
  await assert.rejects(
    fs.access(path.join(f.runtime.workspace(target), "user.json")),
    { code: "ENOENT" }
  );
});

test("offline launch uses local account identity with expired credentials, no login or refresh", async (t) => {
  const f = await fixture(t, async (_binary, args, directory) => {
    assert.deepEqual(args.slice(2), [
      "launch",
      "Artifact1",
      "--offline",
      "--json",
      "--no-wine",
    ]);
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(directory, "user.json"), "utf8")),
      {
        account_id: connection.epicAccountId,
        displayName: connection.displayName,
      }
    );
    return {
      stdout: JSON.stringify({ command: ["Game.exe"], game_parameters: [] }),
      stderr: "",
    };
  });
  await f.store.save(
    auth,
    connection,
    {
      ...bundle,
      user: {
        ...bundle.user,
        expires_at: "2020-01-01T00:00:00Z",
        refresh_expires_at: "2020-01-01T00:00:00Z",
      },
    },
    () => true
  );
  assert.equal((await f.store.read(auth))?.sessionState, "expired");
  const result = await f.runtime.runOfflineLaunch(
    { ...target, localOnly: true },
    { signal: new AbortController().signal }
  );
  assert.deepEqual(result, { command: ["Game.exe"], game_parameters: [] });
  await assert.rejects(
    fs.access(path.join(f.runtime.workspace(target), "user.json")),
    { code: "ENOENT" }
  );
  await assert.rejects(
    f.runtime.runOfflineLaunch(target, {
      signal: new AbortController().signal,
    }),
    { code: "invalid-operation" }
  );
});

test("old operation cannot overwrite credentials rotated by a newer source lease", async (t) => {
  const f = await fixture(t, async () => ({ stdout: "[]", stderr: "" }));
  const newer = {
    ...bundle,
    user: {
      ...bundle.user,
      access_token: "new-access",
      refresh_token: "new-refresh",
    },
  };
  await f.store.refreshSession(auth, connection, newer, () => true, bundle);
  await f.store.refreshSession(
    auth,
    connection,
    { ...bundle, user: { ...bundle.user, refresh_token: "stale-refresh" } },
    () => true,
    bundle
  );
  assert.equal(
    (await f.store.read(auth))?.bundle?.user.refresh_token,
    "new-refresh"
  );
});

test("crash credential cleanup preserves install files in every scoped workspace", async (t) => {
  const f = await fixture(t, async () => ({ stdout: "[]", stderr: "" }));
  await f.runtime.serializeWorkspace(target, async (directory) => {
    await fs.writeFile(path.join(directory, "user.json"), "private");
    await fs.writeFile(path.join(directory, "version.json"), "private");
    await fs.writeFile(path.join(directory, "installed.json"), "installation");
  });
  await f.runtime.cleanupCredentials();
  assert.equal(
    await fs.readFile(
      path.join(f.runtime.workspace(target), "installed.json"),
      "utf8"
    ),
    "installation"
  );
  await assert.rejects(
    fs.access(path.join(f.runtime.workspace(target), "user.json")),
    { code: "ENOENT" }
  );
});

test("managed process treats nonzero exit as failure and classifies required updates", async () => {
  const controller = new AbortController();
  await assert.rejects(
    executeManagedLegendary(
      process.execPath,
      [
        "-e",
        "console.error('Game is out of date, please update before launching');process.exit(1)",
      ],
      os.tmpdir(),
      { signal: controller.signal }
    ),
    { code: "update-required" }
  );
});

test("managed process abort waits for actual tree termination", async () => {
  const controller = new AbortController();
  const operation = executeManagedLegendary(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    os.tmpdir(),
    { signal: controller.signal }
  );
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(operation, { code: "operation-cancelled" });
});

test("managed JSON commands retain early diagnostics beyond the streaming tail cap", async (t) => {
  const entries: EpicTimingEntry[] = [];
  configureEpicTiming((entry) => entries.push(entry), true);
  t.after(() => configureEpicTiming(() => undefined, false));
  const output = await executeManagedLegendary(
    process.execPath,
    [
      "-e",
      "console.error('[cli] ERROR: cloud save failed'); process.stderr.write('x'.repeat(256 * 1024)); console.log('{}')",
    ],
    os.tmpdir(),
    { signal: new AbortController().signal }
  );
  assert.ok(output.stderr.startsWith("[cli] ERROR: cloud save failed"));
  assert.deepEqual(JSON.parse(output.stdout), {});
  for (const stage of ["process.first-stdout", "process.first-stderr"])
    assert.equal(entries.filter((entry) => entry.stage === stage).length, 1);
  assert.ok(entries.some((entry) => entry.stage === "process.closed"));
  const diagnostics = JSON.stringify(entries);
  assert.equal(diagnostics.includes("cloud save failed"), false);
  assert.equal(diagnostics.includes("x".repeat(64)), false);
  assert.equal(diagnostics.includes(process.execPath), false);
});

test("managed process reports native missing-binary failure without leaking arguments", async () => {
  await assert.rejects(
    executeManagedLegendary(
      path.join(os.tmpdir(), "hydra-never-existent-epic.exe"),
      ["sensitive-argument"],
      os.tmpdir(),
      { signal: new AbortController().signal }
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "process-failed");
      assert.equal((error as { nativeCode?: string }).nativeCode, "ENOENT");
      return true;
    }
  );
});

test("failed credential injection removes the partial private user copy", async (t) => {
  let executed = false;
  const f = await fixture(t, async () => {
    executed = true;
    return { stdout: "{}", stderr: "" };
  });
  await f.runtime.serializeWorkspace(target, async (directory) => {
    await fs.mkdir(path.join(directory, "version.json"));
  });
  await assert.rejects(
    f.runtime.runJson(target, ["info", "Artifact1", "--json"], {
      signal: new AbortController().signal,
    })
  );
  assert.equal(executed, false);
  await assert.rejects(
    fs.access(path.join(f.runtime.workspace(target), "user.json")),
    { code: "ENOENT" }
  );
  await fs.rm(path.join(f.runtime.workspace(target), "version.json"), {
    recursive: true,
  });
});

test("managed JSON output preserves UTF-8 characters across separate chunks", async () => {
  const output = await executeManagedLegendary(
    process.execPath,
    [
      "-e",
      "const value=Buffer.from(JSON.stringify({name:'尾'})); const boundary=value.indexOf(Buffer.from('尾'))+1; process.stdout.write(value.subarray(0,boundary)); setTimeout(()=>process.stdout.write(value.subarray(boundary)),30)",
    ],
    os.tmpdir(),
    { signal: new AbortController().signal }
  );
  assert.deepEqual(JSON.parse(output.stdout), { name: "尾" });
});
