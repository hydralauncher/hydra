import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { ClassicLevel } from "classic-level";
import {
  EPIC_CONNECTION_ID_MIN_LENGTH,
  EPIC_CONNECTION_ID_MAX_LENGTH,
} from "./auth-protocol.ts";
import {
  EpicConnectionStore,
  EPIC_STORE_MAX_RECORD_BYTES,
  type EpicStoreDatabase,
} from "./store.ts";
import {
  bundle,
  connection,
  deferred,
  MemoryDatabase,
} from "./store-test-helpers.ts";

const scope = { environment: "https://api.example.test", userId: "HydraA" };
const current = () => true;
const nextBundle = {
  ...bundle,
  user: { ...bundle.user, refresh_token: "secret-next" },
};

test("cached UUID execution metadata does not invalidate the linked session", async (t) => {
  const database = new MemoryDatabase();
  const f = fixture(t, database);
  await f.store.save(scope, connection, bundle, current);
  const key = [...database.records.keys()][0];
  database.records.set(key, {
    schemaVersion: 1,
    connection: {
      ...connection,
      lastSyncedAt: "2026-10-12T00:00:00Z",
      latestSyncRun: { id: "00000000-0000-4000-8000-000000000001" },
    },
    bundle,
  });
  const stored = await f.store.read(scope);
  assert.equal(stored?.sessionState, "ready");
  assert.equal(stored?.connection.connectionId, connection.connectionId);
  assert.equal(stored?.connection.lastSyncedAt, "2026-10-12T00:00:00Z");
  assert.equal(stored?.connection.latestSyncRun, null);
  assert.deepEqual(stored?.bundle, bundle);
  await f.store.refreshSession(scope, connection, nextBundle, current);
  assert.equal(
    (database.records.get(key) as { connection: { latestSyncRun: unknown } })
      .connection.latestSyncRun,
    null
  );
  assert.deepEqual((await f.store.read(scope))?.bundle, nextBundle);
});

function fixture(t: TestContext, database?: EpicStoreDatabase) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epic-store-"));
  const stores: EpicConnectionStore[] = [];
  const create = () => {
    const store = new EpicConnectionStore({
      userDataPath: root,
      ...(database ? { createDatabase: () => database } : {}),
    });
    stores.push(store);
    return store;
  };
  t.after(async () => {
    await Promise.all(stores.map((store) => store.close()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store: create(), create };
}

for (const length of [
  EPIC_CONNECTION_ID_MIN_LENGTH,
  EPIC_CONNECTION_ID_MAX_LENGTH,
]) {
  test(`stored connection IDs at length ${length} remain accessible after restart`, async (t) => {
    const f = fixture(t);
    const linked = {
      ...connection,
      connectionId: "Ab0".repeat(length).slice(0, length),
    };
    await f.store.save(scope, linked, bundle, current);
    await f.store.close();
    const reopened = f.create();
    assert.deepEqual(await reopened.read(scope), {
      connection: linked,
      sessionState: "ready",
      bundle,
    });
    await reopened.remove(scope, current, linked.connectionId);
    assert.equal(await reopened.read(scope), null);
  });
}

for (const [description, connectionId] of [
  ["below minimum", "a".repeat(EPIC_CONNECTION_ID_MIN_LENGTH - 1)],
  ["above maximum", "a".repeat(EPIC_CONNECTION_ID_MAX_LENGTH + 1)],
  ["non-alphanumeric", "a".repeat(EPIC_CONNECTION_ID_MIN_LENGTH - 1) + "_"],
]) {
  test(`invalid ${description} connection ID is rejected on writes and absent on reads`, async (t) => {
    const db = new MemoryDatabase();
    const f = fixture(t, db);
    await f.store.save(scope, connection, bundle, current);
    const linked = { ...connection, connectionId };
    let mutations = 0;
    db.onPut = db.onDel = async () => {
      mutations++;
    };
    await assert.rejects(f.store.save(scope, linked, bundle, current), {
      code: "invalid-response",
    });
    await assert.rejects(f.store.cacheConnection(scope, linked, current), {
      code: "invalid-response",
    });
    assert.deepEqual((await f.store.read(scope))?.bundle, bundle);
    const key = [...db.records.keys()][0];
    const invalid = { schemaVersion: 1, connection: linked, bundle };
    db.records.set(key, invalid);
    assert.equal(await f.store.read(scope), null);
    assert.deepEqual(db.records.get(key), invalid);
    assert.equal(mutations, 0);
  });
}

test("real LevelDB survives restart, normalizes URL and isolates environment/user", async (t) => {
  const f = fixture(t);
  await f.store.save(scope, connection, bundle, current);
  assert.equal(await f.store.read({ ...scope, userId: "HydraB" }), null);
  assert.equal(
    await f.store.read({ ...scope, environment: "https://other.example.test" }),
    null
  );
  await f.store.close();
  const reopened = f.create();
  assert.deepEqual(
    (await reopened.read({ ...scope, environment: `${scope.environment}/` }))
      ?.bundle,
    bundle
  );
  await reopened.remove(scope, current, connection.connectionId);
  await reopened.close();
  assert.equal(await f.create().read(scope), null);
});

test("shared LevelDB cannot read or delete Epic sessions", async (t) => {
  const f = fixture(t);
  const shared = new ClassicLevel<string, unknown>(
    path.join(f.root, "hydra-db"),
    { valueEncoding: "json" }
  );
  try {
    await shared.open();
    await f.store.save(scope, connection, bundle, current);
    assert.deepEqual(await shared.iterator().all(), []);
    assert.deepEqual(
      await shared.sublevel("epic-sessions-db").iterator().all(),
      []
    );
    await shared.clear();
    assert.deepEqual((await f.store.read(scope))?.bundle, bundle);
  } finally {
    await shared.close();
  }
});

test("previous scope keys retain the same identity and session after normalization", async (t) => {
  const f = fixture(t);
  const environments = [scope.environment, `${scope.environment}/v1//epic`];
  const previousDatabase = new ClassicLevel<string, unknown>(
    path.join(f.root, "epic-sessions-db"),
    { valueEncoding: "json" }
  );
  try {
    for (const environment of environments) {
      const previousKey = createHash("sha256")
        .update(JSON.stringify([environment, scope.userId]))
        .digest("hex");
      await previousDatabase.put(
        previousKey,
        { schemaVersion: 1, connection, bundle },
        { sync: true }
      );
    }
  } finally {
    await previousDatabase.close();
  }
  for (const environment of environments) {
    for (const suffix of ["", "/", "///"]) {
      assert.deepEqual(
        await f.store.read({
          ...scope,
          environment: `${environment}${suffix}`,
        }),
        { connection, sessionState: "ready", bundle }
      );
    }
  }
});

test("legacy files are ignored and directory protection precedes native construction", async (t) => {
  const f = fixture(t);
  const legacy = path.join(f.root, "epic-connections", "prototype.json");
  fs.mkdirSync(path.dirname(legacy));
  fs.writeFileSync(legacy, "invalid legacy ciphertext");
  const db = new MemoryDatabase();
  const store = new EpicConnectionStore({
    userDataPath: f.root,
    createDatabase: (directory) => {
      const stat = fs.lstatSync(directory);
      assert.equal(stat.isDirectory(), true);
      assert.equal(stat.isSymbolicLink(), false);
      if (process.platform !== "win32") assert.equal(stat.mode & 0o777, 0o700);
      return db;
    },
  });
  try {
    assert.equal(await store.read(scope), null);
    assert.equal(fs.readFileSync(legacy, "utf8"), "invalid legacy ciphertext");
  } finally {
    await store.close();
  }
});

test("symlink/junction database directory is rejected before native construction", async (t) => {
  const f = fixture(t);
  const target = path.join(f.root, "target");
  fs.mkdirSync(target);
  try {
    fs.symlinkSync(target, path.join(f.root, "epic-sessions-db"), "junction");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlinks not permitted by this host");
      return;
    }
    throw error;
  }
  await assert.rejects(f.store.open(), { code: "persistence-failed" });
  assert.deepEqual(fs.readdirSync(target), []);
});

test("locked native database fails without destroying the existing session", async (t) => {
  const f = fixture(t);
  await f.store.save(scope, connection, bundle, current);
  await assert.rejects(f.create().open(), { code: "persistence-failed" });
  assert.deepEqual((await f.store.read(scope))?.bundle, bundle);
});

test("metadata preserves tokens only for the same connection and Epic identity", async (t) => {
  const f = fixture(t);
  await f.store.save(scope, connection, bundle, current);
  assert.deepEqual(
    (
      await f.store.cacheConnection(
        scope,
        { ...connection, displayName: "New name" },
        current
      )
    ).bundle,
    bundle
  );
  assert.equal(
    (
      await f.store.cacheConnection(
        scope,
        { ...connection, connectionId: "NewLink12" },
        current
      )
    ).sessionState,
    "missing"
  );
  await f.store.save(scope, connection, bundle, current);
  assert.equal(
    (
      await f.store.cacheConnection(
        scope,
        { ...connection, epicAccountId: "b".repeat(32) },
        current
      )
    ).sessionState,
    "missing"
  );
});

test("expired and invalid bundles retain identity without exposing usable tokens", async (t) => {
  const db = new MemoryDatabase();
  const f = fixture(t, db);
  const expired = {
    ...bundle,
    user: { ...bundle.user, refresh_expires_at: "2000-01-01T00:00:00Z" },
  };
  await f.store.save(scope, connection, expired, current);
  assert.deepEqual(await f.store.read(scope), {
    connection,
    sessionState: "expired",
  });
  await f.store.save(scope, connection, bundle, current);
  const key = [...db.records.keys()][0];
  db.records.set(key, {
    schemaVersion: 1,
    connection,
    bundle: { ...bundle, user: { ...bundle.user, account_id: "b".repeat(32) } },
  });
  assert.deepEqual(await f.store.read(scope), {
    connection,
    sessionState: "unavailable",
  });
});

test("identity, expiry, OAuth configuration and size validation reject candidates", async (t) => {
  const f = fixture(t);
  for (const invalid of [
    { ...bundle, user: { ...bundle.user, account_id: "b".repeat(32) } },
    { ...bundle, user: { ...bundle.user, refresh_expires_at: "invalid" } },
    { ...bundle, version: { data: { egl_config: { client_id: "wrong" } } } },
    {
      ...bundle,
      user: { ...bundle.user, extra: "x".repeat(EPIC_STORE_MAX_RECORD_BYTES) },
    },
  ])
    await assert.rejects(f.store.save(scope, connection, invalid, current), {
      code: "invalid-response",
    });
  await f.store.save(scope, connection, bundle, current);
  assert.deepEqual((await f.store.read(scope))?.bundle, bundle);
});

for (const code of [undefined, "LEVEL_DECODE_ERROR"])
  test(`open failure is sanitized and a new authentication attempt can retry (code=${code})`, async (t) => {
    const f = fixture(t);
    let attempts = 0;
    const store = new EpicConnectionStore({
      userDataPath: f.root,
      createDatabase: () => {
        const db = new MemoryDatabase();
        if (++attempts === 1)
          db.onOpen = async () => {
            throw Object.assign(new Error("secret-refresh"), { code });
          };
        return db;
      },
    });
    try {
      await assert.rejects(store.open(), {
        code: "persistence-failed",
        message: "persistence-failed",
      });
      await store.save(scope, connection, bundle, current);
      assert.equal(attempts, 2);
    } finally {
      await store.close();
    }
  });

test("read/write failures preserve records without leaking secrets or mutating after failed reads", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  db.onPut = async () => {
    throw new Error("secret-refresh");
  };
  await assert.rejects(f.store.save(scope, connection, bundle, current), {
    code: "persistence-failed",
    message: "persistence-failed",
  });
  db.onPut = async () => {};
  await f.store.save(scope, connection, bundle, current);
  const previous = structuredClone([...db.records.entries()]);
  let writes = 0,
    deletions = 0;
  db.onPut = async () => {
    writes++;
  };
  db.onDel = async () => {
    deletions++;
  };
  for (const cause of [
    new Error("secret-access"),
    new SyntaxError("secret-access"),
    Object.assign(new Error("secret-access"), { code: "LEVEL_IO_ERROR" }),
    Object.assign(new Error("secret-access"), { code: "LEVEL_CORRUPTION" }),
  ]) {
    db.onGet = async () => {
      throw cause;
    };
    for (const operation of [
      () => f.store.read(scope),
      () => f.store.cacheConnection(scope, connection, current),
      () => f.store.save(scope, connection, nextBundle, current),
      () => f.store.remove(scope, current, connection.connectionId),
    ])
      await assert.rejects(operation(), {
        code: "persistence-failed",
        message: "persistence-failed",
      });
  }
  assert.equal(writes, 0);
  assert.equal(deletions, 0);
  assert.deepEqual([...db.records.entries()], previous);
  db.onGet = async () => {};
  assert.deepEqual((await f.store.read(scope))?.bundle, bundle);
});

for (const [description, invalid] of [
  ["schema", { schemaVersion: 999, connection, bundle }],
  [
    "connection ID",
    {
      schemaVersion: 1,
      connection: { ...connection, connectionId: "invalid!" },
      bundle,
    },
  ],
  [
    "Epic ID",
    {
      schemaVersion: 1,
      connection: { ...connection, epicAccountId: "not-an-epic-id" },
      bundle,
    },
  ],
  [
    "name",
    {
      schemaVersion: 1,
      connection: { ...connection, displayName: "  " },
      bundle,
    },
  ],
  [
    "date",
    {
      schemaVersion: 1,
      connection: { ...connection, connectedAt: "invalid" },
      bundle,
    },
  ],
  ["shape", "secret-refresh"],
  [
    "size",
    {
      schemaVersion: 1,
      connection,
      bundle,
      extra: "x".repeat(EPIC_STORE_MAX_RECORD_BYTES),
    },
  ],
] as const)
  test(`invalid ${description} is absent without writes and can be replaced or removed`, async (t) => {
    const db = new MemoryDatabase(),
      f = fixture(t, db);
    await f.store.save(scope, connection, bundle, current);
    const key = [...db.records.keys()][0];
    db.records.set(key, invalid);
    let mutations = 0;
    db.onPut = db.onDel = async () => {
      mutations++;
    };
    assert.equal(await f.store.read(scope), null);
    assert.equal(mutations, 0);
    assert.deepEqual(db.records.get(key), invalid);

    assert.deepEqual(
      await f.store.cacheConnection(scope, connection, current),
      { connection, sessionState: "missing" }
    );
    assert.deepEqual(db.records.get(key), { schemaVersion: 1, connection });

    db.records.set(key, invalid);
    assert.deepEqual(
      await f.store.save(scope, connection, nextBundle, current),
      {
        connection,
        sessionState: "ready",
        bundle: nextBundle,
      }
    );

    db.records.set(key, invalid);
    await f.store.remove(scope, current, connection.connectionId);
    assert.equal(await f.store.read(scope), null);
    assert.equal(db.records.size, 0);
  });

for (const recovery of ["cache", "save", "remove"] as const)
  test(`real LevelDB JSON decode failure stays untouched until ${recovery} recovery`, async (t) => {
    const f = fixture(t);
    const key = createHash("sha256")
      .update(JSON.stringify([scope.environment, scope.userId]))
      .digest("hex");
    const malformed = '{"refresh_token":"secret-refresh",';
    const database = new ClassicLevel<string, unknown>(
      path.join(f.root, "epic-sessions-db"),
      { valueEncoding: "json" }
    );
    try {
      await database.put(key, malformed, { valueEncoding: "utf8", sync: true });
    } finally {
      await database.close();
    }
    assert.equal(await f.store.read(scope), null);
    await f.store.close();
    try {
      await database.open();
      assert.equal(
        await database.get(key, { valueEncoding: "utf8" }),
        malformed
      );
    } finally {
      await database.close();
    }

    const reopened = f.create();
    if (recovery === "cache") {
      assert.deepEqual(
        await reopened.cacheConnection(scope, connection, current),
        { connection, sessionState: "missing" }
      );
      assert.deepEqual(await reopened.read(scope), {
        connection,
        sessionState: "missing",
      });
    } else if (recovery === "save") {
      await reopened.save(scope, connection, nextBundle, current);
      assert.deepEqual((await reopened.read(scope))?.bundle, nextBundle);
    } else {
      await reopened.remove(scope, current, connection.connectionId);
      assert.equal(await reopened.read(scope), null);
    }
  });

test("invalid-record recovery stays within its Hydra user and environment", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  await f.store.save(scope, connection, bundle, current);
  const key = [...db.records.keys()][0];
  const otherScopes = [
    { ...scope, userId: "HydraB" },
    { ...scope, environment: "https://other.example.test" },
  ];
  for (const other of otherScopes)
    await f.store.save(other, connection, bundle, current);
  const otherRecords = [...db.records.entries()].filter(([id]) => id !== key);
  db.records.set(key, { schemaVersion: 999, connection, bundle });
  await f.store.cacheConnection(scope, connection, current);
  await f.store.save(scope, connection, nextBundle, current);
  await f.store.remove(scope, current, connection.connectionId);
  assert.deepEqual([...db.records.entries()], otherRecords);
  for (const other of otherScopes)
    assert.deepEqual((await f.store.read(other))?.bundle, bundle);
});

for (const previous of ["missing", "valid", "invalid"] as const)
  test(`native cancellation compensates inside the queue (previous=${previous})`, async (t) => {
    const db = new MemoryDatabase(),
      f = fixture(t, db);
    if (previous !== "missing")
      await f.store.save(scope, connection, bundle, current);
    if (previous === "invalid")
      db.records.set([...db.records.keys()][0], {
        schemaVersion: 999,
        connection,
        bundle,
      });
    const started = deferred<void>(),
      release = deferred<void>(),
      undoStarted = deferred<void>(),
      undoRelease = deferred<void>();
    let active = true,
      committed = false,
      puts = 0,
      readFinished = false;
    db.onPut = async () => {
      if (++puts === 1) {
        started.resolve();
        await release.promise;
      } else {
        undoStarted.resolve();
        await undoRelease.promise;
      }
    };
    db.onDel = async () => {
      undoStarted.resolve();
      await undoRelease.promise;
    };
    const save = f.store.save(
      scope,
      connection,
      nextBundle,
      () => active,
      () => {
        committed = true;
      }
    );
    const rejected = assert.rejects(save, { code: "operation-cancelled" });
    await started.promise;
    active = false;
    const read = f.store.read(scope).then((value) => {
      readFinished = true;
      return value;
    });
    release.resolve();
    await undoStarted.promise;
    assert.equal(readFinished, false);
    assert.equal(committed, false);
    undoRelease.resolve();
    await rejected;
    assert.deepEqual(
      (await read)?.bundle ?? null,
      previous === "valid" ? bundle : null
    );
  });

test("cancellation before put writes nothing and synchronous commit ends cancelability", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  let writes = 0,
    active = false;
  db.onPut = async () => {
    writes++;
  };
  await assert.rejects(
    f.store.save(scope, connection, bundle, () => active),
    { code: "operation-cancelled" }
  );
  assert.equal(writes, 0);
  active = true;
  await f.store.save(
    scope,
    connection,
    bundle,
    () => active,
    () => {
      active = false;
    }
  );
  assert.equal(writes, 1);
  assert.deepEqual((await f.store.read(scope))?.bundle, bundle);
});

test("failed compensation of an invalid record blocks it until explicit successful cleanup", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  await f.store.save(scope, connection, bundle, current);
  db.records.set([...db.records.keys()][0], {
    schemaVersion: 999,
    connection,
    bundle,
  });
  const started = deferred<void>(),
    release = deferred<void>();
  let active = true;
  db.onPut = async () => {
    started.resolve();
    await release.promise;
  };
  db.onDel = async () => {
    throw new Error("secret-refresh");
  };
  const save = f.store.save(scope, connection, bundle, () => active);
  const rejected = assert.rejects(save, {
    code: "cleanup-failed",
    message: "cleanup-failed",
  });
  await started.promise;
  active = false;
  release.resolve();
  await rejected;
  await assert.rejects(f.store.read(scope), { code: "cleanup-failed" });
  await assert.rejects(f.store.save(scope, connection, bundle, current), {
    code: "cleanup-failed",
  });
  db.onDel = async () => {};
  await f.store.remove(scope, current, connection.connectionId);
  assert.equal(await f.store.read(scope), null);
});

test("conditional deletion cannot erase another link; native delete errors are sanitized", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  await f.store.save(scope, connection, bundle, current);
  await assert.rejects(f.store.remove(scope, current, "OtherLink12"), {
    code: "stale-connection",
  });
  assert.deepEqual((await f.store.read(scope))?.bundle, bundle);
  db.onDel = async () => {
    throw new Error("secret-refresh");
  };
  await assert.rejects(
    f.store.remove(scope, current, connection.connectionId),
    { code: "cleanup-failed", message: "cleanup-failed" }
  );
  await assert.rejects(f.store.read(scope), { code: "cleanup-failed" });
  db.onDel = async () => {};
  await f.store.remove(scope, current, connection.connectionId);
  assert.equal(await f.store.read(scope), null);
});

test("queued deletion with an old ID cannot erase a replacement of an invalid record", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  await f.store.save(scope, connection, bundle, current);
  db.records.set([...db.records.keys()][0], {
    schemaVersion: 999,
    connection,
    bundle,
  });
  const replacement = { ...connection, connectionId: "NewLink12" };
  const started = deferred<void>(),
    release = deferred<void>();
  db.onPut = async () => {
    started.resolve();
    await release.promise;
  };
  const save = f.store.save(scope, replacement, nextBundle, current);
  await started.promise;
  const deletion = f.store.remove(scope, current, connection.connectionId);
  const rejected = assert.rejects(deletion, { code: "stale-connection" });
  release.resolve();
  await Promise.all([save, rejected]);
  assert.deepEqual(await f.store.read(scope), {
    connection: replacement,
    sessionState: "ready",
    bundle: nextBundle,
  });
});

test("close drains accepted writes and permanently prevents reopening", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db),
    started = deferred<void>(),
    release = deferred<void>();
  await f.store.open();
  let writes = 0;
  db.onPut = async () => {
    if (++writes === 1) {
      started.resolve();
      await release.promise;
    }
  };
  const first = f.store.save(scope, connection, bundle, current);
  const second = f.store.save(scope, connection, nextBundle, current);
  await started.promise;
  const closing = f.store.close();
  assert.equal(f.store.close(), closing);
  await assert.rejects(f.store.read(scope), { code: "persistence-failed" });
  assert.equal(db.closed, false);
  release.resolve();
  await Promise.all([first, second, closing]);
  assert.equal(writes, 2);
  assert.equal(db.closed, true);
  await assert.rejects(f.store.open(), { code: "persistence-failed" });
});

for (const invalid of [false, true])
  test(`cancellation during read does not reach put or delete (invalid=${invalid})`, async (t) => {
    const db = new MemoryDatabase(),
      f = fixture(t, db);
    await f.store.save(scope, connection, bundle, current);
    const key = [...db.records.keys()][0];
    if (invalid)
      db.records.set(key, { schemaVersion: 999, connection, bundle });
    const previous = structuredClone(db.records.get(key));
    const started = deferred<void>(),
      release = deferred<void>();
    let active = true,
      mutations = 0;
    db.onGet = async () => {
      started.resolve();
      await release.promise;
    };
    db.onPut = db.onDel = async () => {
      mutations++;
    };
    const save = f.store.save(scope, connection, nextBundle, () => active);
    const rejected = assert.rejects(save, { code: "operation-cancelled" });
    await started.promise;
    active = false;
    release.resolve();
    await rejected;
    assert.equal(mutations, 0);
    assert.deepEqual(db.records.get(key), previous);
    if (invalid) assert.equal(await f.store.read(scope), null);
    else assert.deepEqual((await f.store.read(scope))?.bundle, bundle);
  });

test("read failure before deletion stays persistence-failed and can be retried", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  await f.store.save(scope, connection, bundle, current);
  db.onGet = async () => {
    throw new Error("secret-refresh");
  };
  await assert.rejects(
    f.store.remove(scope, current, connection.connectionId),
    { code: "persistence-failed", message: "persistence-failed" }
  );
  db.onGet = async () => {};
  assert.deepEqual((await f.store.read(scope))?.bundle, bundle);
});

test("private store is not exported or wired into shared LevelDB IPC", () => {
  const main = new URL("../../", import.meta.url);
  for (const file of [
    "level/index.ts",
    "level/level.ts",
    "level/sublevels/index.ts",
    "events/leveldb/helpers.ts",
  ]) {
    assert.doesNotMatch(
      fs.readFileSync(new URL(file, main), "utf8"),
      /EpicConnectionStore|epic-sessions-db|services\/epic/
    );
  }
  for (const file of ["epic/index.ts", "epic/store.ts"]) {
    const source = fs.readFileSync(
      new URL(file, new URL("services/", main)),
      "utf8"
    );
    assert.doesNotMatch(source, /@main\/level|safeStorage/);
  }
});

test("refresh cannot replace the bundle of a newer connection", async (t) => {
  const f = fixture(t, new MemoryDatabase());
  await f.store.save(scope, connection, bundle, current);
  await f.store.save(
    scope,
    { ...connection, connectionId: "NewLink1" },
    bundle,
    current
  );
  await assert.rejects(
    f.store.refreshSession(scope, connection, nextBundle, current),
    /stale-connection/
  );
  assert.equal(
    (await f.store.read(scope))?.bundle?.user.refresh_token,
    bundle.user.refresh_token
  );
});
test("rotated session keeps server sync metadata and does not expose credentials", async (t) => {
  const f = fixture(t, new MemoryDatabase());
  const linked = {
    ...connection,
    lastSyncedAt: "2026-10-12T00:00:00Z",
    latestSyncRun: null,
  };
  await f.store.save(scope, linked, bundle, current);
  await f.store.refreshSession(scope, connection, nextBundle, current);
  const result = await f.store.read(scope);
  assert.equal(result?.connection.lastSyncedAt, linked.lastSyncedAt);
  assert.equal(
    result?.bundle?.user.refresh_token,
    nextBundle.user.refresh_token
  );
  assert.ok(!JSON.stringify(result?.connection).includes("secret"));
});
