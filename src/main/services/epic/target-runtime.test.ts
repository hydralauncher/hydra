import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  EpicManagedError,
  LegendaryManagedRuntime,
  type EpicManagedTarget,
  type executeManagedLegendary,
} from "./legendary-managed-runtime.js";
import { EpicConnectionStore } from "./store.js";
import { EpicSessionProvider } from "./session-provider.js";
import {
  MemoryDatabase,
  bundle,
  connection,
  deferred,
} from "./store-test-helpers.js";

const auth = {
  environment: "https://api.example.test",
  userId: "targeted-runtime-test",
  generation: 1,
};
const objectId = "namespace:catalog-item";
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
type Execute = typeof executeManagedLegendary;
type Request = {
  operation: string;
  target: {
    namespace: string;
    catalogItemId: string;
    artifactId: string;
    platform: string;
  };
  receipt?: { manifestPath: string };
  args?: string[];
};

async function request(directory: string): Promise<Request> {
  return JSON.parse(
    await fs.readFile(path.join(directory, "managed-request.json"), "utf8")
  );
}

async function response(directory: string, supplied?: Request["target"]) {
  const item = supplied ?? (await request(directory)).target;
  const manifests = path.join(directory, "managed-manifests");
  await fs.mkdir(manifests, { recursive: true });
  const manifestPath = path.join(manifests, "fixture.manifest");
  const data = Buffer.from(`manifest for ${item.artifactId}`);
  await fs.writeFile(manifestPath, data);
  const receipt = {
    manifestPath,
    sha256: createHash("sha256").update(data).digest("hex"),
    sourceHash: createHash("sha1").update(data).digest("hex"),
    version: "1.0.0",
  };
  await fs.writeFile(
    `${manifestPath}.json`,
    JSON.stringify({
      target: item,
      sourceHash: receipt.sourceHash,
      version: receipt.version,
    })
  );
  return {
    protocolVersion: 1,
    info: {
      game: {
        app_name: item.artifactId,
        version: receipt.version,
        is_dlc: false,
        external_activation: null,
        cloud_saves_supported: true,
      },
      manifest: { is_preloaded: false, download_size: 10, disk_size: 20 },
    },
    metadata: {
      app_name: item.artifactId,
      metadata: {
        namespace: item.namespace,
        id: item.catalogItemId,
        categories: [{ path: "games" }],
        customAttributes: {},
      },
      asset_infos: {
        Windows: {
          app_name: item.artifactId,
          namespace: item.namespace,
          catalog_item_id: item.catalogItemId,
        },
      },
    },
    receipt,
  };
}

async function fixture(
  t: TestContext,
  execute: Execute = async (_binary, _args, directory) => ({
    stdout: JSON.stringify(await response(directory)),
    stderr: "",
  })
) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-target-runtime-")
  );
  const store = new EpicConnectionStore({
    userDataPath: directory,
    createDatabase: () => new MemoryDatabase(),
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
    managedCommand: async () => ({
      binary: "fixture-python",
      prefixArgs: ["fixture-adapter", "fixture-archive"],
    }),
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

const signal = () => new AbortController().signal;
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false
  );

test("target inspection uses only access credentials, exact identity and the managed protocol", async (t) => {
  let preview = "";
  const f = await fixture(t, async (binary, args, directory) => {
    preview = directory;
    assert.equal(binary, "fixture-python");
    assert.deepEqual(args.slice(0, 3), [
      "fixture-adapter",
      "fixture-archive",
      "--request",
    ]);
    const user = JSON.parse(
      await fs.readFile(path.join(directory, "user.json"), "utf8")
    );
    assert.equal(user.access_token, bundle.user.access_token);
    assert.equal(user.account_id, connection.epicAccountId);
    assert.equal(Object.hasOwn(user, "refresh_token"), false);
    assert.equal(Object.hasOwn(user, "refresh_expires_at"), false);
    assert.deepEqual((await request(directory)).target, {
      namespace: "namespace",
      catalogItemId: "catalog-item",
      artifactId: "Artifact1",
      platform: "Windows",
    });
    return { stdout: JSON.stringify(await response(directory)), stderr: "" };
  });
  const result = await f.runtime.inspect(target, objectId, signal());
  assert.ok(result.manifest);
  for (const name of ["user.json", "version.json", "managed-request.json"])
    assert.equal(await exists(path.join(preview, name)), false);
  assert.equal(
    await exists(path.join(preview, "managed-manifests", "fixture.manifest")),
    true
  );
});

test(
  "Windows namespaced manifest receipts are accepted without losing workspace containment",
  { skip: process.platform !== "win32" },
  async (t) => {
    const f = await fixture(t, async (_binary, _args, directory) => {
      if ((await request(directory)).operation === "install")
        return { stdout: "", stderr: "" };
      const value = await response(directory);
      value.receipt.manifestPath = path.toNamespacedPath(
        value.receipt.manifestPath
      );
      return { stdout: JSON.stringify(value), stderr: "" };
    });
    const inspection = await f.runtime.inspect(target, objectId, signal());
    await f.runtime.streamInstall(
      target,
      objectId,
      inspection,
      ["-y", "install", target.artifactId],
      { signal: signal(), onLine: () => {} }
    );
  }
);

for (const escape of ["traversal", "drive", "unc"] as const) {
  test(
    `Windows namespaced receipts reject ${escape} outside the workspace`,
    { skip: process.platform !== "win32" },
    async (t) => {
      const f = await fixture(t, async (_binary, _args, directory) => {
        const value = await response(directory);
        const file =
          escape === "traversal"
            ? path.join(directory, "..", "outside.manifest")
            : escape === "drive"
              ? `${path.parse(directory).root[0] === "Z" ? "Y" : "Z"}:\\outside.manifest`
              : "\\\\untrusted-host\\share\\outside.manifest";
        value.receipt.manifestPath = path.toNamespacedPath(file);
        return { stdout: JSON.stringify(value), stderr: "" };
      });
      await assert.rejects(f.runtime.inspect(target, objectId, signal()), {
        code: "invalid-response",
      });
    }
  );
}

test("target preview config symlinks cannot overwrite outside files", async (t) => {
  let preview = "";
  let calls = 0;
  const f = await fixture(t, async (_binary, _args, directory) => {
    preview = directory;
    calls++;
    return { stdout: JSON.stringify(await response(directory)), stderr: "" };
  });
  await f.runtime.inspect(target, objectId, signal());
  const outside = path.join(f.directory, "outside-config");
  await fs.writeFile(outside, "preserve this config");
  const config = path.join(preview, "config.ini");
  await fs.unlink(config);
  try {
    await fs.symlink(outside, config);
  } catch (error) {
    if (
      process.platform === "win32" &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      t.skip(
        "Windows file symlinks require a privilege unavailable to this test; covered on Linux"
      );
      return;
    }
    throw error;
  }
  await assert.rejects(f.runtime.inspect(target, objectId, signal()), {
    code: "invalid-path",
  });
  assert.equal(calls, 1);
  assert.equal(await fs.readFile(outside, "utf8"), "preserve this config");
});

test("central refresh rejects a response with an incompatible protocol", async (t) => {
  let workspace = "";
  const f = await fixture(t, async (_binary, _args, directory) => {
    workspace = directory;
    return { stdout: JSON.stringify({ protocolVersion: 2 }), stderr: "" };
  });
  await assert.rejects(
    f.runtime.refreshSession(auth, connection, bundle, signal()),
    { code: "invalid-response" }
  );
  for (const name of ["user.json", "version.json", "managed-request.json"])
    assert.equal(await exists(path.join(workspace, name)), false);
});

test("central refresh preserves a completed rotation when its last consumer cancels", async (t) => {
  const entered = deferred<void>();
  const aborted = deferred<void>();
  const closed = deferred<void>();
  let workspace = "";
  const f = await fixture(t, async (_binary, _args, directory, options) => {
    workspace = directory;
    const user = JSON.parse(
      await fs.readFile(path.join(directory, "user.json"), "utf8")
    );
    await fs.writeFile(
      path.join(directory, "user.json"),
      JSON.stringify({
        ...user,
        expires_at: bundle.user.expires_at,
        access_token: "completed-access",
        refresh_token: "completed-refresh",
      })
    );
    options.signal.addEventListener("abort", () => aborted.resolve(), {
      once: true,
    });
    entered.resolve();
    await closed.promise;
    throw new EpicManagedError("operation-cancelled");
  });
  await f.store.save(
    auth,
    connection,
    { ...bundle, user: { ...bundle.user, expires_at: "2000-01-01T00:00:00Z" } },
    () => true
  );
  f.session.setRefreshOperation((context, selected, source, refreshSignal) =>
    f.runtime.refreshSession(context, selected, source, refreshSignal)
  );
  const controller = new AbortController();
  const operation = f.session.accessSnapshot(
    auth,
    connection,
    controller.signal
  );
  const rejected = assert.rejects(operation, { code: "operation-cancelled" });
  await entered.promise;
  controller.abort();
  await Promise.all([rejected, aborted.promise]);
  closed.resolve();
  await f.session.serialize(async () => {});
  assert.equal(
    (await f.store.read(auth))?.bundle?.user.refresh_token,
    "completed-refresh"
  );
  assert.equal(await exists(path.join(workspace, "user.json")), false);
});

test("two target inspections finish while the global session lease is held", async (t) => {
  const f = await fixture(t);
  const release = deferred<void>();
  const entered = deferred<void>();
  const lease = f.session.serialize(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([
        f.runtime.inspect(target, objectId, signal()),
        f.runtime.inspect(
          { ...target, artifactId: "Artifact2" },
          objectId,
          signal()
        ),
      ]),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error("inspection waited for the global session lease")),
          2000
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    release.resolve();
    await lease;
  }
});

test("target inspection retries authentication once using a centrally rotated access token", async (t) => {
  let attempts = 0;
  let refreshes = 0;
  const f = await fixture(t, async (_binary, _args, directory) => {
    attempts++;
    const user = JSON.parse(
      await fs.readFile(path.join(directory, "user.json"), "utf8")
    );
    assert.equal(Object.hasOwn(user, "refresh_token"), false);
    if (attempts === 1) throw new EpicManagedError("session-expired");
    assert.equal(user.access_token, "fresh-access");
    return { stdout: JSON.stringify(await response(directory)), stderr: "" };
  });
  f.session.setRefreshOperation(async () => {
    refreshes++;
    return {
      ...bundle,
      user: {
        ...bundle.user,
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
      },
    };
  });
  await f.runtime.inspect(target, objectId, signal());
  assert.equal(attempts, 2);
  assert.equal(refreshes, 1);
  assert.equal(
    (await f.store.read(auth))?.bundle?.user.refresh_token,
    "fresh-refresh"
  );
});

test("stopping the runtime aborts central refresh and waits for worker closure and credential cleanup", async (t) => {
  const entered = deferred<void>();
  const aborted = deferred<void>();
  const closed = deferred<void>();
  let directory = "";
  const f = await fixture(t, async (_binary, _args, workspace, options) => {
    directory = workspace;
    assert.equal((await request(workspace)).operation, "refresh");
    options.signal.addEventListener("abort", () => aborted.resolve(), {
      once: true,
    });
    entered.resolve();
    await closed.promise;
    throw new EpicManagedError("operation-cancelled");
  });
  await f.store.save(
    auth,
    connection,
    { ...bundle, user: { ...bundle.user, expires_at: "2000-01-01T00:00:00Z" } },
    () => true
  );
  f.session.setRefreshOperation((context, selected, source, refreshSignal) =>
    f.runtime.refreshSession(context, selected, source, refreshSignal)
  );
  const operation = f.session.accessSnapshot(auth, connection, signal());
  const rejected = assert.rejects(operation, { code: "operation-cancelled" });
  await entered.promise;
  let stopped = false;
  const stopping = f.runtime.stop().then(() => {
    stopped = true;
  });
  await aborted.promise;
  assert.equal(stopped, false);
  assert.equal(await exists(path.join(directory, "user.json")), true);
  closed.resolve();
  await Promise.all([stopping, rejected]);
  assert.equal(await exists(path.join(directory, "user.json")), false);
});

test("queued target inspection cancels without starting later", async (t) => {
  const entered = deferred<void>();
  const release = deferred<void>();
  let count = 0;
  const f = await fixture(t, async (_binary, _args, directory) => {
    count++;
    entered.resolve();
    await release.promise;
    return { stdout: JSON.stringify(await response(directory)), stderr: "" };
  });
  const first = f.runtime.inspect(target, objectId, signal());
  await entered.promise;
  const controller = new AbortController();
  const next = f.runtime.inspect(target, objectId, controller.signal);
  const rejected = assert.rejects(next, { code: "operation-cancelled" });
  controller.abort();
  await rejected;
  assert.equal(count, 1);
  release.resolve();
  await first;
  await f.runtime.inspect(target, objectId, signal());
  assert.equal(count, 2);
});

test("stop covers preview filesystem preparation before any command can start", async (t) => {
  const entered = deferred<void>();
  const release = deferred<void>();
  let executions = 0;
  const f = await fixture(t, async (_binary, _args, directory) => {
    executions++;
    return { stdout: JSON.stringify(await response(directory)), stderr: "" };
  });
  const original = fs.mkdir;
  let intercepted = false;
  t.mock.method(fs, "mkdir", (async (...args: Parameters<typeof fs.mkdir>) => {
    if (
      !intercepted &&
      String(args[0]) === path.join(f.directory, "epic-managed-previews")
    ) {
      intercepted = true;
      entered.resolve();
      await release.promise;
    }
    return original(...args);
  }) as typeof fs.mkdir);
  const request = f.runtime.inspect(target, objectId, signal());
  const rejected = assert.rejects(request, { code: "operation-cancelled" });
  await entered.promise;
  let stopped = false;
  const stopping = f.runtime.stop().then(() => {
    stopped = true;
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stopped, false, "stop waits for the registered preparation");
  } finally {
    release.resolve();
    await Promise.all([rejected, stopping]);
  }
  assert.equal(executions, 0);
});

test("stop aborts both active and queued previews without a later command", async (t) => {
  const entered = deferred<void>();
  const aborted = deferred<void>();
  const closed = deferred<void>();
  let executions = 0;
  const f = await fixture(t, async (_binary, _args, _directory, options) => {
    executions++;
    options.signal.addEventListener("abort", () => aborted.resolve(), {
      once: true,
    });
    entered.resolve();
    await closed.promise;
    throw new EpicManagedError("operation-cancelled");
  });
  const first = f.runtime.inspect(target, objectId, signal());
  const firstRejected = assert.rejects(first, { code: "operation-cancelled" });
  await entered.promise;
  const second = f.runtime.inspect(target, objectId, signal());
  const secondRejected = assert.rejects(second, {
    code: "operation-cancelled",
  });
  const stopping = f.runtime.stop();
  await Promise.all([aborted.promise, secondRejected]);
  closed.resolve();
  await Promise.all([stopping, firstRejected]);
  assert.equal(executions, 1);
});

test("target install centrally refreshes expired access before entering the credential lease", async (t) => {
  let refreshes = 0;
  let executions = 0;
  const f = await fixture(t, async (_binary, _args, directory, options) => {
    executions++;
    const user = JSON.parse(
      await fs.readFile(path.join(directory, "user.json"), "utf8")
    );
    assert.equal(user.access_token, "fresh-install-access");
    options.onLine?.("Download size: 1 MiB");
    return { stdout: "", stderr: "" };
  });
  await f.store.save(
    auth,
    connection,
    { ...bundle, user: { ...bundle.user, expires_at: "2000-01-01T00:00:00Z" } },
    () => true
  );
  f.session.setRefreshOperation(async () => {
    refreshes++;
    return {
      ...bundle,
      user: { ...bundle.user, access_token: "fresh-install-access" },
    };
  });
  await f.runtime.streamInstall(
    target,
    objectId,
    {},
    ["-y", "install", target.artifactId],
    { signal: signal(), onLine: () => {} }
  );
  assert.equal(refreshes, 1);
  assert.equal(executions, 1);
});

test("access expiring while install waits for its lease refreshes outside that lease", async (t) => {
  let refreshes = 0;
  let executions = 0;
  const f = await fixture(t, async (_binary, _args, _directory, options) => {
    executions++;
    options.onLine?.("Download size: 1 MiB");
    return { stdout: "", stderr: "" };
  });
  const held = deferred<void>();
  const release = deferred<void>();
  const snapshotReady = deferred<void>();
  const lease = f.session.serialize(async () => {
    held.resolve();
    await release.promise;
  });
  await held.promise;
  const original = f.session.accessSnapshot.bind(f.session);
  t.mock.method(
    f.session,
    "accessSnapshot",
    async (...args: Parameters<typeof original>) => {
      const value = await original(...args);
      snapshotReady.resolve();
      return value;
    }
  );
  f.session.setRefreshOperation(async () => {
    refreshes++;
    return bundle;
  });
  const operation = f.runtime.streamInstall(
    target,
    objectId,
    {},
    ["-y", "install", target.artifactId],
    { signal: signal(), onLine: () => {} }
  );
  await snapshotReady.promise;
  await f.store.save(
    auth,
    connection,
    { ...bundle, user: { ...bundle.user, expires_at: "2000-01-01T00:00:00Z" } },
    () => true
  );
  release.resolve();
  await lease;
  await operation;
  assert.equal(refreshes, 1);
  assert.equal(executions, 1, "no command ran with expired access");
});

test("target install retries one authentication failure only before transfer preparation", async (t) => {
  let refreshes = 0;
  let executions = 0;
  const f = await fixture(t, async (_binary, _args, _directory, options) => {
    executions++;
    if (executions === 1) throw new EpicManagedError("session-expired");
    options.onLine?.("Download size: 1 MiB");
    return { stdout: "", stderr: "" };
  });
  f.session.setRefreshOperation(async () => {
    refreshes++;
    return bundle;
  });
  await f.runtime.streamInstall(
    target,
    objectId,
    {},
    ["-y", "install", target.artifactId],
    { signal: signal(), onLine: () => {} }
  );
  assert.equal(executions, 2);
  assert.equal(refreshes, 1);
});

test("target install never retries authentication after Download size started the transfer", async (t) => {
  let refreshes = 0;
  let executions = 0;
  const f = await fixture(t, async (_binary, _args, _directory, options) => {
    executions++;
    options.onLine?.("Download size: 1 MiB");
    throw new EpicManagedError("session-expired");
  });
  f.session.setRefreshOperation(async () => {
    refreshes++;
    return bundle;
  });
  await assert.rejects(
    f.runtime.streamInstall(
      target,
      objectId,
      {},
      ["-y", "install", target.artifactId],
      { signal: signal(), onLine: () => {} }
    ),
    { code: "session-expired" }
  );
  assert.equal(executions, 1);
  assert.equal(refreshes, 0);
});

test("stopping target inspection awaits process closure before cleaning access credentials", async (t) => {
  const entered = deferred<void>();
  const aborted = deferred<void>();
  const closed = deferred<void>();
  let preview = "";
  const f = await fixture(t, async (_binary, _args, directory, options) => {
    preview = directory;
    entered.resolve();
    options.signal.addEventListener("abort", () => aborted.resolve(), {
      once: true,
    });
    await closed.promise;
    throw new EpicManagedError("operation-cancelled");
  });
  const operation = f.runtime.inspect(target, objectId, signal());
  const rejected = assert.rejects(operation, { code: "operation-cancelled" });
  await entered.promise;
  let stopped = false;
  const stopping = f.runtime.stop().then(() => {
    stopped = true;
  });
  await aborted.promise;
  assert.equal(stopped, false);
  assert.equal(await exists(path.join(preview, "user.json")), true);
  closed.resolve();
  await Promise.all([stopping, rejected]);
  assert.equal(await exists(path.join(preview, "user.json")), false);
});

test("obsolete target inspections discard late results", async (t) => {
  const entered = deferred<void>();
  const release = deferred<void>();
  const f = await fixture(t, async (_binary, _args, directory) => {
    entered.resolve();
    await release.promise;
    return { stdout: JSON.stringify(await response(directory)), stderr: "" };
  });
  const operation = f.runtime.inspect(target, objectId, signal());
  const rejected = assert.rejects(operation, { code: "operation-cancelled" });
  await entered.promise;
  f.invalidate();
  release.resolve();
  await rejected;
});

for (const fault of [
  "protocol",
  "hash",
  "contents",
  "source-target",
  "path",
  "metadata-target",
  "info-target",
  "sidecar-target",
] as const) {
  test(`target inspection rejects an invalid ${fault}`, async (t) => {
    const f = await fixture(t, async (_binary, _args, directory) => {
      const value = await response(directory);
      if (fault === "protocol") value.protocolVersion = 2;
      if (fault === "hash") value.receipt.sha256 = "0".repeat(64);
      if (fault === "contents")
        await fs.writeFile(value.receipt.manifestPath, "modified manifest");
      if (fault === "source-target") value.receipt.sourceHash = "0".repeat(40);
      if (fault === "path")
        value.receipt.manifestPath = path.join(
          directory,
          "..",
          "outside.manifest"
        );
      if (fault === "metadata-target")
        value.metadata.metadata.id = "another-item";
      if (fault === "info-target")
        value.info.game.app_name = "another-artifact";
      if (fault === "sidecar-target")
        await fs.writeFile(
          `${value.receipt.manifestPath}.json`,
          JSON.stringify({
            target: {
              ...(await request(directory)).target,
              artifactId: "another-artifact",
            },
            sourceHash: value.receipt.sourceHash,
            version: value.receipt.version,
          })
        );
      return { stdout: JSON.stringify(value), stderr: "" };
    });
    await assert.rejects(f.runtime.inspect(target, objectId, signal()), {
      code: fault.endsWith("target") ? "invalid-artifact" : "invalid-response",
    });
  });
}

test("target inspection rejects manifests reached through a directory symlink", async (t) => {
  const f = await fixture(t, async (_binary, _args, directory) => {
    const value = await response(directory);
    const outside = path.join(f.directory, "outside-manifests");
    await fs.mkdir(outside);
    for (const suffix of ["", ".json"])
      await fs.rename(
        `${value.receipt.manifestPath}${suffix}`,
        path.join(outside, `fixture.manifest${suffix}`)
      );
    await fs.rm(path.dirname(value.receipt.manifestPath), { recursive: true });
    await fs.symlink(
      outside,
      path.dirname(value.receipt.manifestPath),
      process.platform === "win32" ? "junction" : "dir"
    );
    return { stdout: JSON.stringify(value), stderr: "" };
  });
  await assert.rejects(f.runtime.inspect(target, objectId, signal()), {
    code: "invalid-response",
  });
});

test("target install copies its validated receipt and releases credentials at Download size, before transfer closes", async (t) => {
  const prepared = deferred<void>();
  const transfer = deferred<void>();
  let installDirectory = "";
  const f = await fixture(t, async (_binary, _args, directory, options) => {
    const item = await request(directory);
    if (item.operation === "inspect")
      return { stdout: JSON.stringify(await response(directory)), stderr: "" };
    installDirectory = directory;
    assert.equal(item.operation, "install");
    assert.ok(
      item.receipt?.manifestPath.startsWith(
        path.join(directory, "managed-manifests")
      )
    );
    assert.ok(await exists(item.receipt!.manifestPath));
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
  const inspection = await f.runtime.inspect(target, objectId, signal());
  let finished = false;
  const operation = f.runtime
    .streamInstall(
      target,
      objectId,
      inspection,
      ["-y", "install", target.artifactId],
      { signal: signal(), onLine: () => {} }
    )
    .then(() => {
      finished = true;
    });
  await prepared.promise;
  try {
    await f.session.serialize(async () => {
      assert.equal(
        (await f.store.read(auth))?.bundle?.user.refresh_token,
        "rotated-refresh"
      );
      assert.equal(
        await exists(path.join(installDirectory, "user.json")),
        false
      );
    });
    assert.equal(finished, false);
  } finally {
    transfer.resolve();
    await operation;
  }
});

test("failed target preparation holds the credential lease until process closure", async (t) => {
  const entered = deferred<void>();
  const closed = deferred<void>();
  const aborted = deferred<void>();
  const f = await fixture(t, async (_binary, _args, _directory, options) => {
    entered.resolve();
    options.signal.addEventListener("abort", () => aborted.resolve(), {
      once: true,
    });
    await closed.promise;
    throw new EpicManagedError("operation-cancelled");
  });
  const controller = new AbortController();
  const operation = f.runtime.streamInstall(
    target,
    objectId,
    {},
    ["-y", "install", target.artifactId],
    { signal: controller.signal, onLine: () => {} }
  );
  const rejected = assert.rejects(operation, { code: "operation-cancelled" });
  await entered.promise;
  let nextLease = false;
  const next = f.session.serialize(async () => {
    nextLease = true;
  });
  controller.abort();
  await aborted.promise;
  assert.equal(nextLease, false);
  closed.resolve();
  await Promise.all([rejected, next]);
  assert.equal(nextLease, true);
});

test("target install cannot overwrite a file outside its workspace through a destination symlink", async (t) => {
  const f = await fixture(t);
  const inspection = await f.runtime.inspect(target, objectId, signal());
  const receipt = inspection.manifest as { sha256: string };
  const outside = path.join(f.directory, "outside-private-file");
  await fs.writeFile(outside, "preserve");
  let canCreateSymlink = true;
  await f.runtime.serializeWorkspace(target, async (directory) => {
    const manifests = path.join(directory, "managed-manifests");
    await fs.mkdir(manifests);
    try {
      await fs.symlink(
        outside,
        path.join(manifests, `${receipt.sha256}.manifest`)
      );
    } catch (error) {
      if (
        process.platform === "win32" &&
        (error as NodeJS.ErrnoException).code === "EPERM"
      )
        canCreateSymlink = false;
      else throw error;
    }
  });
  if (!canCreateSymlink) {
    t.skip(
      "Windows file symlinks require a privilege unavailable to this test; covered on Linux"
    );
    return;
  }
  await f.runtime.streamInstall(
    target,
    objectId,
    inspection,
    ["-y", "install", target.artifactId],
    { signal: signal(), onLine: () => {} }
  );
  assert.equal(await fs.readFile(outside, "utf8"), "preserve");
});
