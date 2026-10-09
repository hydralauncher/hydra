import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { ClassicLevel } from "classic-level";
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

test("open failure is sanitized and a new authentication attempt can retry", async (t) => {
  const f = fixture(t);
  let attempts = 0;
  const store = new EpicConnectionStore({
    userDataPath: f.root,
    createDatabase: () => {
      const db = new MemoryDatabase();
      if (++attempts === 1)
        db.onOpen = async () => {
          throw new Error("secret-refresh");
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

test("read/write failures and corrupt records do not leak secrets or recreate the database", async (t) => {
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
  db.onGet = async () => {
    throw new Error("secret-access");
  };
  await assert.rejects(f.store.read(scope), {
    code: "persistence-failed",
    message: "persistence-failed",
  });
  db.onGet = async () => {};
  const key = [...db.records.keys()][0];
  db.records.set(key, { schemaVersion: 999, connection, bundle });
  await assert.rejects(f.store.read(scope), { code: "persistence-failed" });
  assert.equal(db.records.size, 1);
});

for (const hasPrevious of [false, true])
  test(`native cancellation compensates inside the queue (previous=${hasPrevious})`, async (t) => {
    const db = new MemoryDatabase(),
      f = fixture(t, db);
    if (hasPrevious) await f.store.save(scope, connection, bundle, current);
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
    assert.deepEqual((await read)?.bundle ?? null, hasPrevious ? bundle : null);
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

test("failed compensation blocks the record until explicit successful cleanup", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db),
    started = deferred<void>(),
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
  await assert.rejects(f.store.read(scope), { code: "persistence-failed" });
  assert.equal(db.closed, false);
  release.resolve();
  await Promise.all([first, second, closing]);
  assert.equal(writes, 2);
  assert.equal(db.closed, true);
  await assert.rejects(f.store.open(), { code: "persistence-failed" });
});

test("cancellation during read does not reach put or delete", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  await f.store.save(scope, connection, bundle, current);
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
  assert.deepEqual((await f.store.read(scope))?.bundle, bundle);
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
