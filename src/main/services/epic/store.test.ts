import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  EpicConnectionStore,
  EpicStoreError,
  getEpicStoreScopeKey,
  type EpicSessionBundle,
  type EpicStoreCrypto,
  type EpicStoreFileSystem,
  type EpicStoreScope,
} from "./store.ts";

const now = Date.parse("2026-10-07T15:00:00.000Z");
const scope: EpicStoreScope = {
  environment: "http://localhost:3000",
  userId: "HydraA",
};
const connection = {
  connected: true as const,
  connectionId: "EpicLinkA",
  epicAccountId: "a".repeat(32),
  displayName: "Epic Player",
  connectedAt: "2026-10-07T14:00:00.000Z",
};

const bundle = (user: Record<string, unknown> = {}): EpicSessionBundle => ({
  user: {
    account_id: connection.epicAccountId,
    access_token: "private-access-token",
    refresh_token: "private-refresh-token",
    expires_at: "2026-10-07T14:59:00.000Z",
    refresh_expires_at: "2026-11-07T15:00:00.000Z",
    ...user,
  },
  version: { egl_config: { client_id: "public-client-id" } },
});

const encryption = (): EpicStoreCrypto => {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString: (value) => {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        value.subarray(0, 12)
      );
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([
        decipher.update(value.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
};

const fixture = (
  t: TestContext,
  options: {
    crypto?: EpicStoreCrypto;
    fileSystem?: Partial<EpicStoreFileSystem>;
  } = {}
) => {
  const userDataPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "hydra-epic-store-")
  );
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const crypto = options.crypto ?? encryption();
  const store = new EpicConnectionStore({
    userDataPath,
    crypto,
    now: () => now,
    fileSystem: options.fileSystem,
  });
  const directory = path.join(userDataPath, "epic-connections");
  const filePath = (owner = scope, suffix = "json") =>
    path.join(directory, `${getEpicStoreScopeKey(owner)}.${suffix}`);
  return { store, crypto, userDataPath, directory, filePath };
};

const errorCode = (code: string) => (error: unknown) => {
  assert.ok(error instanceof EpicStoreError);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  assert.equal("cause" in error, false);
  return true;
};

test("scopes normalize API URL and preserve environment, path and Hydra ID identity", () => {
  assert.equal(
    getEpicStoreScopeKey({
      environment: "HTTPS://API.EXAMPLE.COM:443/",
      userId: "A",
    }),
    getEpicStoreScopeKey({
      environment: "https://api.example.com",
      userId: "A",
    })
  );
  const baseline = getEpicStoreScopeKey(scope);
  assert.match(baseline, /^[a-f0-9]{64}$/);
  for (const other of [
    { ...scope, userId: "HydraB" },
    { ...scope, userId: "hydraa" },
    { ...scope, environment: "https://api-staging.example.com" },
    { ...scope, environment: "http://localhost:3000/v2" },
    { ...scope, environment: "http://localhost:3001" },
  ]) {
    assert.notEqual(getEpicStoreScopeKey(other), baseline);
  }
  for (const environment of [
    "invalid",
    "file:///tmp/epic",
    "https://user:pass@example.com",
    "http://localhost:3000?token=secret",
    "http://localhost:3000#secret",
  ]) {
    assert.throws(
      () => getEpicStoreScopeKey({ ...scope, environment }),
      errorCode("invalid-response")
    );
  }
});

test("persists latest user and version only inside encrypted bundle, outside LevelDB", (t) => {
  const { store, filePath, directory, userDataPath } = fixture(t);
  fs.mkdirSync(path.join(userDataPath, "leveldb"));
  store.save(scope, connection, bundle(), () => true);
  const raw = fs.readFileSync(filePath(), "utf8");
  const value = JSON.parse(raw);
  assert.deepEqual(Object.keys(value).sort(), [
    "connection",
    "encryptedSession",
    "schemaVersion",
  ]);
  assert.equal(raw.includes("private-access-token"), false);
  assert.equal(raw.includes("private-refresh-token"), false);
  assert.equal(raw.includes("public-client-id"), false);
  assert.equal(
    Buffer.from(value.encryptedSession, "base64").includes(
      Buffer.from("private-refresh-token")
    ),
    false
  );
  assert.deepEqual(store.read(scope), {
    connection,
    sessionState: "ready",
    bundle: bundle(),
  });
  assert.deepEqual(fs.readdirSync(path.join(userDataPath, "leveldb")), []);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(filePath()).mode & 0o777, 0o600);
  }
});

test("expired access token remains usable while refresh lifetime has not ended", (t) => {
  const { store } = fixture(t);
  store.save(scope, connection, bundle(), () => true);
  assert.equal(store.read(scope)?.sessionState, "ready");
  for (const refresh_expires_at of [
    "2026-10-06T15:00:00.000Z",
    "2026-10-07T15:00:00.000Z",
  ]) {
    store.save(scope, connection, bundle({ refresh_expires_at }), () => true);
    const stored = store.read(scope);
    assert.equal(stored?.sessionState, "expired");
    assert.equal(stored?.bundle, undefined);
    assert.deepEqual(stored?.connection, connection);
  }
});

test("a stale owner never encrypts or commits a session", (t) => {
  let encryptCalls = 0;
  const crypto = encryption();
  const { store, directory } = fixture(t, {
    crypto: {
      ...crypto,
      encryptString: (value) => {
        encryptCalls += 1;
        return crypto.encryptString(value);
      },
    },
  });
  assert.throws(
    () => store.save(scope, connection, bundle(), () => false),
    errorCode("operation-cancelled")
  );
  assert.equal(encryptCalls, 0);
  assert.equal(fs.existsSync(directory), false);
});

test("owner switch during temporary write keeps prior session and removes candidate", (t) => {
  let current = true;
  let switchDuringWrite = false;
  const { store, filePath, directory } = fixture(t, {
    fileSystem: {
      writeFileSync: (file, value, options) => {
        fs.writeFileSync(file, value, options);
        if (switchDuringWrite && file.endsWith(".tmp")) current = false;
      },
    },
  });
  store.save(scope, connection, bundle(), () => current);
  const previous = fs.readFileSync(filePath(), "utf8");
  switchDuringWrite = true;
  assert.throws(
    () =>
      store.save(
        scope,
        connection,
        bundle({ access_token: "new-private-token" }),
        () => current
      ),
    errorCode("operation-cancelled")
  );
  assert.equal(fs.readFileSync(filePath(), "utf8"), previous);
  assert.equal(
    fs.readdirSync(directory).some((file) => file.endsWith(".tmp")),
    false
  );
});

test("write and rename failures preserve previous record and expose only safe error", (t) => {
  for (const failure of ["write", "rename"]) {
    let fail = false;
    const { store, filePath } = fixture(t, {
      fileSystem: {
        writeFileSync: (file, value, options) => {
          if (fail && failure === "write")
            throw new Error("secret-token from OS error");
          fs.writeFileSync(file, value, options);
        },
        renameSync: (from, to) => {
          if (fail && failure === "rename")
            throw new Error("secret-token from OS error");
          fs.renameSync(from, to);
        },
      },
    });
    store.save(scope, connection, bundle(), () => true);
    const previous = fs.readFileSync(filePath(), "utf8");
    fail = true;
    assert.throws(
      () =>
        store.save(
          scope,
          connection,
          bundle({ access_token: "new-token" }),
          () => true
        ),
      errorCode("persistence-failed")
    );
    assert.equal(fs.readFileSync(filePath(), "utf8"), previous);
  }
});

test("vault unavailable, encryption failure and different identity preserve prior session", (t) => {
  const crypto = encryption();
  let available = true;
  let failEncryption = false;
  const { store, filePath } = fixture(t, {
    crypto: {
      ...crypto,
      isEncryptionAvailable: () => available,
      encryptString: (value) => {
        if (failEncryption) throw new Error("private-refresh-token");
        return crypto.encryptString(value);
      },
    },
  });
  store.save(scope, connection, bundle(), () => true);
  const previous = fs.readFileSync(filePath(), "utf8");
  available = false;
  assert.throws(
    () => store.save(scope, connection, bundle(), () => true),
    errorCode("vault-unavailable")
  );
  assert.deepEqual(store.read(scope), {
    connection,
    sessionState: "unavailable",
  });
  available = true;
  failEncryption = true;
  assert.throws(
    () => store.save(scope, connection, bundle(), () => true),
    errorCode("vault-unavailable")
  );
  failEncryption = false;
  assert.throws(
    () =>
      store.save(
        scope,
        connection,
        bundle({ account_id: "b".repeat(32) }),
        () => true
      ),
    errorCode("invalid-response")
  );
  assert.equal(fs.readFileSync(filePath(), "utf8"), previous);
});

test("decryption failure preserves link and makes session unavailable without leaking error", (t) => {
  const crypto = encryption();
  let fail = false;
  const { store } = fixture(t, {
    crypto: {
      ...crypto,
      decryptString: (value) => {
        if (fail) throw new Error("private-refresh-token");
        return crypto.decryptString(value);
      },
    },
  });
  store.save(scope, connection, bundle(), () => true);
  fail = true;
  assert.deepEqual(store.read(scope), {
    connection,
    sessionState: "unavailable",
  });
});

test("missing or corrupted files are distinguished and reads cap JSON size", (t) => {
  const { store, filePath, directory } = fixture(t);
  assert.equal(store.read(scope), null);
  fs.mkdirSync(directory);
  for (const contents of [
    "not-json-private-refresh-token",
    JSON.stringify({ schemaVersion: 9, connection }),
    JSON.stringify({
      schemaVersion: 1,
      connection,
      encryptedSession: "invalid base64",
    }),
    "x".repeat(1024 * 1024 + 1),
  ]) {
    fs.writeFileSync(filePath(), contents);
    assert.throws(() => store.read(scope), errorCode("persistence-failed"));
  }
});

test("metadata caching needs no vault and only retains matching connection session", (t) => {
  const crypto = encryption();
  let available = false;
  const { store } = fixture(t, {
    crypto: { ...crypto, isEncryptionAvailable: () => available },
  });
  store.cacheConnection(scope, connection, () => true);
  assert.deepEqual(store.read(scope), { connection, sessionState: "missing" });
  available = true;
  store.save(scope, connection, bundle(), () => true);
  const renamed = { ...connection, displayName: "Renamed Player" };
  store.cacheConnection(scope, renamed, () => true);
  assert.equal(store.read(scope)?.sessionState, "ready");
  assert.deepEqual(store.read(scope)?.connection, renamed);
  const recreated = { ...renamed, connectionId: "EpicLinkB" };
  store.cacheConnection(scope, recreated, () => true);
  assert.deepEqual(store.read(scope), {
    connection: recreated,
    sessionState: "missing",
  });
});

test("removal and invalidation affect only matching environment and Hydra user", (t) => {
  const { store } = fixture(t);
  const userB = { ...scope, userId: "HydraB" };
  const staging = { ...scope, environment: "https://api-staging.example.com" };
  for (const owner of [scope, userB, staging]) {
    store.save(owner, connection, bundle(), () => true);
  }
  store.invalidateSession(scope);
  assert.deepEqual(store.read(scope), { connection, sessionState: "missing" });
  assert.equal(store.read(userB)?.sessionState, "ready");
  assert.equal(store.read(staging)?.sessionState, "ready");
  store.remove(scope);
  store.remove(scope);
  assert.equal(store.read(scope), null);
  assert.equal(store.read(userB)?.sessionState, "ready");
  assert.equal(store.read(staging)?.sessionState, "ready");
});

test("failed cleanup persists a block and restart retries removal before returning cache", (t) => {
  let fail = false;
  const { store, crypto, filePath, userDataPath } = fixture(t, {
    fileSystem: {
      unlinkSync: (file) => {
        if (fail && (file.endsWith(".json") || file.endsWith(".quarantine")))
          throw new Error("locked private-refresh-token");
        fs.unlinkSync(file);
      },
    },
  });
  store.save(scope, connection, bundle(), () => true);
  fail = true;
  assert.throws(() => store.remove(scope), errorCode("cleanup-failed"));
  assert.equal(fs.existsSync(filePath(scope, "cleanup")), true);
  assert.throws(() => store.read(scope), errorCode("cleanup-failed"));
  const restarted = new EpicConnectionStore({
    userDataPath,
    crypto,
    now: () => now,
  });
  assert.equal(restarted.read(scope), null);
  assert.equal(fs.existsSync(filePath()), false);
  assert.equal(fs.existsSync(filePath(scope, "quarantine")), false);
  assert.equal(fs.existsSync(filePath(scope, "cleanup")), false);
});

test("session invalidation failure blocks ciphertext across restart while retaining link", (t) => {
  let fail = false;
  const { store, crypto, userDataPath, filePath } = fixture(t, {
    fileSystem: {
      renameSync: (from, to) => {
        if (fail) throw new Error("locked private-refresh-token");
        fs.renameSync(from, to);
      },
    },
  });
  store.save(scope, connection, bundle(), () => true);
  fail = true;
  assert.throws(
    () => store.invalidateSession(scope),
    errorCode("cleanup-failed")
  );
  assert.equal(fs.existsSync(filePath(scope, "session-invalid")), true);
  assert.deepEqual(store.read(scope), { connection, sessionState: "missing" });
  const restarted = new EpicConnectionStore({
    userDataPath,
    crypto,
    now: () => now,
  });
  assert.deepEqual(restarted.read(scope), {
    connection,
    sessionState: "missing",
  });
  assert.equal(
    "encryptedSession" in JSON.parse(fs.readFileSync(filePath(), "utf8")),
    false
  );
  assert.equal(fs.existsSync(filePath(scope, "session-invalid")), false);
});

test("failed marker creation quarantines old record so restart never decrypts it", (t) => {
  let fail = false;
  const { store, crypto, userDataPath, filePath } = fixture(t, {
    fileSystem: {
      writeFileSync: (file, value, options) => {
        if (fail && file.endsWith(".cleanup"))
          throw new Error("marker write unavailable");
        fs.writeFileSync(file, value, options);
      },
    },
  });
  store.save(scope, connection, bundle(), () => true);
  fail = true;
  assert.throws(() => store.remove(scope), errorCode("cleanup-failed"));
  assert.equal(fs.existsSync(filePath()), false);
  assert.equal(fs.existsSync(filePath(scope, "quarantine")), true);
  const restarted = new EpicConnectionStore({
    userDataPath,
    crypto,
    now: () => now,
  });
  assert.equal(restarted.read(scope), null);
});

test("an unreadable record is not mistaken for an absent connection", (t) => {
  let fail = false;
  const { store } = fixture(t, {
    fileSystem: {
      lstatSync: (file) => {
        if (fail && file.endsWith(".json")) {
          throw Object.assign(new Error("private-refresh-token"), {
            code: "EACCES",
          });
        }
        return fs.lstatSync(file);
      },
    },
  });
  store.save(scope, connection, bundle(), () => true);
  fail = true;
  assert.throws(() => store.read(scope), errorCode("persistence-failed"));
});

test("failed invalidation marker quarantines ciphertext across restart", (t) => {
  let fail = false;
  const { store, crypto, userDataPath, filePath } = fixture(t, {
    fileSystem: {
      writeFileSync: (file, value, options) => {
        if (fail && file.endsWith(".session-invalid")) {
          throw new Error("marker write unavailable");
        }
        fs.writeFileSync(file, value, options);
      },
    },
  });
  store.save(scope, connection, bundle(), () => true);
  fail = true;
  assert.throws(
    () => store.invalidateSession(scope),
    errorCode("cleanup-failed")
  );
  assert.equal(fs.existsSync(filePath()), false);
  assert.equal(fs.existsSync(filePath(scope, "quarantine")), true);
  const restarted = new EpicConnectionStore({
    userDataPath,
    crypto,
    now: () => now,
  });
  assert.equal(restarted.read(scope), null);
});
