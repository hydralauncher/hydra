import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  EpicConnectedConnection,
  EpicErrorCode,
  EpicSessionState,
} from "@types";

const MAX_RECORD_BYTES = 1024 * 1024;
const STORE_DIRECTORY_MODE = 0o700;
const STORE_FILE_MODE = 0o600;

export interface EpicStoreScope {
  environment: string;
  userId: string;
}

export interface EpicSessionBundle {
  user: Record<string, unknown>;
  version: Record<string, unknown>;
}

export interface EpicStoredConnection {
  connection: EpicConnectedConnection;
  sessionState: EpicSessionState;
  bundle?: EpicSessionBundle;
}

export interface EpicStoreCrypto {
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
}

interface StoredRecord {
  schemaVersion: 1;
  connection: EpicConnectedConnection;
  encryptedSession?: string;
}

export interface EpicStoreFileSystem {
  mkdirSync: (
    directory: string,
    options: { recursive: true; mode: number }
  ) => unknown;
  chmodSync: (filePath: string, mode: number) => void;
  lstatSync: (filePath: string) => {
    size: number;
    isFile: () => boolean;
    isSymbolicLink: () => boolean;
  };
  readFileSync: (filePath: string, encoding: "utf8") => string;
  writeFileSync: (
    filePath: string,
    value: string,
    options: { encoding: "utf8"; mode: number; flag: "wx" }
  ) => void;
  renameSync: (oldPath: string, newPath: string) => void;
  unlinkSync: (filePath: string) => void;
}

interface EpicStoreOptions {
  userDataPath: string;
  crypto: EpicStoreCrypto;
  now?: () => number;
  fileSystem?: Partial<EpicStoreFileSystem>;
}

const defaultFileSystem: EpicStoreFileSystem = {
  mkdirSync: fs.mkdirSync,
  chmodSync: fs.chmodSync,
  lstatSync: fs.lstatSync,
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding),
  writeFileSync: (filePath, value, options) => {
    const fd = fs.openSync(filePath, options.flag, options.mode);
    try {
      fs.writeFileSync(fd, value, options.encoding);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  },
  renameSync: fs.renameSync,
  unlinkSync: fs.unlinkSync,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isMissingFile = (error: unknown): boolean =>
  isRecord(error) && error.code === "ENOENT";

const isConnection = (value: unknown): value is EpicConnectedConnection => {
  if (!isRecord(value)) return false;
  return (
    value.connected === true &&
    typeof value.connectionId === "string" &&
    /^[a-zA-Z0-9]+$/.test(value.connectionId) &&
    typeof value.epicAccountId === "string" &&
    /^[a-f0-9]{32}$/.test(value.epicAccountId) &&
    typeof value.displayName === "string" &&
    value.displayName.length > 0 &&
    typeof value.connectedAt === "string" &&
    Number.isFinite(Date.parse(value.connectedAt))
  );
};

const isBundle = (
  value: unknown,
  epicAccountId: string
): value is EpicSessionBundle => {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.version)) {
    return false;
  }
  const user = value.user;
  return (
    user.account_id === epicAccountId &&
    typeof user.access_token === "string" &&
    user.access_token.length > 0 &&
    typeof user.refresh_token === "string" &&
    user.refresh_token.length > 0 &&
    typeof user.refresh_expires_at === "string" &&
    Number.isFinite(Date.parse(user.refresh_expires_at))
  );
};

const isEncryptedSession = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length % 4 === 0 &&
  /^[a-zA-Z0-9+/]+={0,2}$/.test(value) &&
  Buffer.from(value, "base64").toString("base64") === value;

const publicConnection = (
  connection: EpicConnectedConnection
): EpicConnectedConnection => ({
  connected: true,
  connectionId: connection.connectionId,
  epicAccountId: connection.epicAccountId,
  displayName: connection.displayName,
  connectedAt: connection.connectedAt,
});

export class EpicStoreError extends Error {
  constructor(public readonly code: EpicErrorCode) {
    super(code);
    this.name = "EpicStoreError";
  }
}

export const getEpicStoreScopeKey = (scope: EpicStoreScope): string => {
  try {
    const environment = new URL(scope.environment);
    if (
      !["http:", "https:"].includes(environment.protocol) ||
      environment.username ||
      environment.password ||
      environment.search ||
      environment.hash ||
      typeof scope.userId !== "string" ||
      !scope.userId ||
      scope.userId.trim() !== scope.userId
    ) {
      throw new EpicStoreError("invalid-response");
    }
    const normalizedEnvironment = environment.toString().replace(/\/+$/, "");
    return createHash("sha256")
      .update(JSON.stringify([normalizedEnvironment, scope.userId]))
      .digest("hex");
  } catch {
    throw new EpicStoreError("invalid-response");
  }
};

/** This store belongs exclusively to the main process. A caller must confirm the
 * remote connection before restoring a returned session into Legendary.
 */
export class EpicConnectionStore {
  private readonly directory: string;
  private readonly crypto: EpicStoreCrypto;
  private readonly fileSystem: EpicStoreFileSystem;
  private readonly now: () => number;
  private readonly cleanupBlocked = new Set<string>();
  private readonly invalidSessions = new Set<string>();

  constructor(options: EpicStoreOptions) {
    this.directory = path.join(options.userDataPath, "epic-connections");
    this.crypto = options.crypto;
    this.fileSystem = { ...defaultFileSystem, ...options.fileSystem };
    this.now = options.now ?? Date.now;
  }

  read(scope: EpicStoreScope): EpicStoredConnection | null {
    const key = getEpicStoreScopeKey(scope);
    if (this.isCleanupBlocked(key)) {
      this.remove(scope);
      return null;
    }
    const record = this.readRecord(key);
    if (!record) return null;

    if (this.isSessionInvalid(key)) {
      try {
        this.invalidateSession(scope);
      } catch {
        // A persisted marker blocks the old ciphertext until cleanup succeeds.
      }
      return { connection: record.connection, sessionState: "missing" };
    }
    if (!record.encryptedSession) {
      return { connection: record.connection, sessionState: "missing" };
    }

    try {
      if (!this.crypto.isEncryptionAvailable()) {
        return { connection: record.connection, sessionState: "unavailable" };
      }
      const bundle: unknown = JSON.parse(
        this.crypto.decryptString(
          Buffer.from(record.encryptedSession, "base64")
        )
      );
      if (!isBundle(bundle, record.connection.epicAccountId)) {
        return { connection: record.connection, sessionState: "unavailable" };
      }
      const refreshExpiresAt = Date.parse(
        bundle.user.refresh_expires_at as string
      );
      if (refreshExpiresAt <= this.now()) {
        return { connection: record.connection, sessionState: "expired" };
      }
      return { connection: record.connection, sessionState: "ready", bundle };
    } catch {
      return { connection: record.connection, sessionState: "unavailable" };
    }
  }

  cacheConnection(
    scope: EpicStoreScope,
    connection: EpicConnectedConnection,
    isCurrent: () => boolean
  ): void {
    const key = getEpicStoreScopeKey(scope);
    this.assertCurrent(isCurrent);
    this.assertConnection(connection);
    this.prepareForSave(scope, key);
    const previous = this.readRecord(key);
    const sameConnection =
      previous?.connection.connectionId === connection.connectionId &&
      previous.connection.epicAccountId === connection.epicAccountId;
    const record: StoredRecord = {
      schemaVersion: 1,
      connection: publicConnection(connection),
    };
    if (sameConnection && previous.encryptedSession) {
      record.encryptedSession = previous.encryptedSession;
    }
    this.writeRecord(key, record, isCurrent);
  }

  save(
    scope: EpicStoreScope,
    connection: EpicConnectedConnection,
    bundle: EpicSessionBundle,
    isCurrent: () => boolean
  ): void {
    const key = getEpicStoreScopeKey(scope);
    this.assertCurrent(isCurrent);
    this.assertConnection(connection);
    if (!isBundle(bundle, connection.epicAccountId)) {
      throw new EpicStoreError("invalid-response");
    }
    this.prepareForSave(scope, key);

    let encryptedSession: string;
    try {
      if (!this.crypto.isEncryptionAvailable()) {
        throw new EpicStoreError("vault-unavailable");
      }
      const serialized = JSON.stringify({
        user: bundle.user,
        version: bundle.version,
      });
      if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) {
        throw new EpicStoreError("invalid-response");
      }
      const encrypted = this.crypto.encryptString(serialized);
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
        throw new EpicStoreError("vault-unavailable");
      }
      encryptedSession = encrypted.toString("base64");
    } catch (error) {
      if (error instanceof EpicStoreError) throw error;
      throw new EpicStoreError("vault-unavailable");
    }

    this.writeRecord(
      key,
      {
        schemaVersion: 1,
        connection: publicConnection(connection),
        encryptedSession,
      },
      isCurrent
    );
  }

  remove(scope: EpicStoreScope): void {
    const key = getEpicStoreScopeKey(scope);
    this.cleanupBlocked.add(key);
    try {
      this.ensureDirectory();
      this.writeMarker(key, "cleanup");
      this.unlinkIfPresent(this.filePath(key));
      this.unlinkIfPresent(this.filePath(key, "quarantine"));
      this.unlinkIfPresent(this.filePath(key, "session-invalid"));
      this.unlinkIfPresent(this.filePath(key, "cleanup"));
      this.cleanupBlocked.delete(key);
      this.invalidSessions.delete(key);
    } catch {
      // If marker creation failed, quarantine also blocks reads after restart.
      try {
        if (this.fileExists(this.filePath(key))) {
          this.fileSystem.renameSync(
            this.filePath(key),
            this.filePath(key, "quarantine")
          );
        }
      } catch {
        // Keep the in-process block. Remote confirmation is still mandatory.
      }
      throw new EpicStoreError("cleanup-failed");
    }
  }

  invalidateSession(scope: EpicStoreScope): void {
    const key = getEpicStoreScopeKey(scope);
    this.invalidSessions.add(key);
    try {
      this.ensureDirectory();
      this.writeMarker(key, "session-invalid");
      const record = this.readRecord(key);
      if (record) {
        this.writeRecord(
          key,
          { schemaVersion: 1, connection: record.connection },
          () => true
        );
      }
      this.unlinkIfPresent(this.filePath(key, "session-invalid"));
      this.invalidSessions.delete(key);
    } catch {
      try {
        if (
          !this.fileExists(this.filePath(key, "session-invalid")) &&
          this.fileExists(this.filePath(key))
        ) {
          this.fileSystem.renameSync(
            this.filePath(key),
            this.filePath(key, "quarantine")
          );
        }
      } catch {
        // Remote confirmation is mandatory if disk permissions block a marker.
      }
      throw new EpicStoreError("cleanup-failed");
    }
  }

  private assertCurrent(isCurrent: () => boolean): void {
    if (!isCurrent()) throw new EpicStoreError("operation-cancelled");
  }

  private assertConnection(connection: EpicConnectedConnection): void {
    if (!isConnection(connection)) {
      throw new EpicStoreError("invalid-response");
    }
  }

  private prepareForSave(scope: EpicStoreScope, key: string): void {
    if (this.isCleanupBlocked(key)) this.remove(scope);
    if (this.isSessionInvalid(key)) this.invalidateSession(scope);
  }

  private filePath(key: string, suffix = "json"): string {
    return path.join(this.directory, `${key}.${suffix}`);
  }

  private isCleanupBlocked(key: string): boolean {
    return (
      this.cleanupBlocked.has(key) ||
      this.fileExists(this.filePath(key, "cleanup")) ||
      this.fileExists(this.filePath(key, "quarantine"))
    );
  }

  private isSessionInvalid(key: string): boolean {
    return (
      this.invalidSessions.has(key) ||
      this.fileExists(this.filePath(key, "session-invalid"))
    );
  }

  private ensureDirectory(): void {
    this.fileSystem.mkdirSync(this.directory, {
      recursive: true,
      mode: STORE_DIRECTORY_MODE,
    });
    if (process.platform !== "win32") {
      this.fileSystem.chmodSync(this.directory, STORE_DIRECTORY_MODE);
    }
  }

  private readRecord(key: string): StoredRecord | null {
    const filePath = this.filePath(key);
    try {
      const stat = this.fileSystem.lstatSync(filePath);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > MAX_RECORD_BYTES
      ) {
        throw new EpicStoreError("persistence-failed");
      }
      const serialized = this.fileSystem.readFileSync(filePath, "utf8");
      if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) {
        throw new EpicStoreError("persistence-failed");
      }
      const value: unknown = JSON.parse(serialized);
      if (
        !isRecord(value) ||
        value.schemaVersion !== 1 ||
        !isConnection(value.connection) ||
        (value.encryptedSession !== undefined &&
          !isEncryptedSession(value.encryptedSession))
      ) {
        throw new EpicStoreError("persistence-failed");
      }
      return {
        schemaVersion: 1,
        connection: publicConnection(value.connection),
        ...(value.encryptedSession === undefined
          ? {}
          : { encryptedSession: value.encryptedSession }),
      };
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw new EpicStoreError("persistence-failed");
    }
  }

  private writeMarker(key: string, suffix: string): void {
    const markerPath = this.filePath(key, suffix);
    if (this.fileExists(markerPath)) return;
    this.fileSystem.writeFileSync(markerPath, "{}", {
      encoding: "utf8",
      mode: STORE_FILE_MODE,
      flag: "wx",
    });
  }

  private writeRecord(
    key: string,
    record: StoredRecord,
    isCurrent: () => boolean
  ): void {
    const temporaryPath = this.filePath(key, `${randomUUID()}.tmp`);
    try {
      const serialized = JSON.stringify(record);
      if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) {
        throw new EpicStoreError("persistence-failed");
      }
      this.assertCurrent(isCurrent);
      this.ensureDirectory();
      this.fileSystem.writeFileSync(temporaryPath, serialized, {
        encoding: "utf8",
        mode: STORE_FILE_MODE,
        flag: "wx",
      });
      this.assertCurrent(isCurrent);
      this.fileSystem.renameSync(temporaryPath, this.filePath(key));
    } catch (error) {
      try {
        this.unlinkIfPresent(temporaryPath);
      } catch {
        // The temporary file contains ciphertext only and is never read.
      }
      if (error instanceof EpicStoreError) throw error;
      throw new EpicStoreError("persistence-failed");
    }
  }

  private unlinkIfPresent(filePath: string): void {
    try {
      this.fileSystem.unlinkSync(filePath);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  private fileExists(filePath: string): boolean {
    try {
      this.fileSystem.lstatSync(filePath);
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw new EpicStoreError("persistence-failed");
    }
  }
}
