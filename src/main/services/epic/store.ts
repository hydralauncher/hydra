import { ClassicLevel } from "classic-level";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  EpicConnectedConnection,
  EpicErrorCode,
  EpicSessionState,
} from "../../../types/epic-integration.types";
import {
  isRecord,
  validateLegendarySession,
  validateLegendaryVersion,
} from "./auth-protocol.js";

export const EPIC_STORE_MAX_RECORD_BYTES = 1024 * 1024;
const STORE_DIRECTORY_MODE = 0o700;

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
interface StoredRecord {
  schemaVersion: 1;
  connection: EpicConnectedConnection;
  bundle?: unknown;
}
export interface EpicStoreDatabase {
  open(): Promise<void>;
  close(): Promise<void>;
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown, options: { sync: true }): Promise<void>;
  del(key: string, options: { sync: true }): Promise<void>;
}
interface EpicStoreOptions {
  userDataPath: string;
  createDatabase?: (directory: string) => EpicStoreDatabase;
}
export class EpicStoreError extends Error {
  constructor(public readonly code: EpicErrorCode) {
    super(code);
    this.name = "EpicStoreError";
  }
}
const isConnection = (value: unknown): value is EpicConnectedConnection =>
  isRecord(value) &&
  value.connected === true &&
  typeof value.connectionId === "string" &&
  /^[a-zA-Z0-9]{8,128}$/.test(value.connectionId) &&
  typeof value.epicAccountId === "string" &&
  /^[a-f0-9]{32}$/.test(value.epicAccountId) &&
  typeof value.displayName === "string" &&
  value.displayName.trim().length > 0 &&
  typeof value.connectedAt === "string" &&
  Number.isFinite(Date.parse(value.connectedAt));

const isBundle = (
  value: unknown,
  epicAccountId: string
): value is EpicSessionBundle => {
  if (!isRecord(value)) return false;
  try {
    const user = validateLegendarySession(value.user);
    validateLegendaryVersion(value.version);
    return (user.account_id as string).toLowerCase() === epicAccountId;
  } catch {
    return false;
  }
};
const publicConnection = (
  connection: EpicConnectedConnection
): EpicConnectedConnection => ({
  connected: true,
  connectionId: connection.connectionId,
  epicAccountId: connection.epicAccountId,
  displayName: connection.displayName,
  connectedAt: connection.connectedAt,
});
const getEpicStoreScopeKey = (scope: EpicStoreScope): string => {
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
    )
      throw new Error();
    return createHash("sha256")
      .update(
        JSON.stringify([
          environment.toString().replace(/\/+$/, ""),
          scope.userId,
        ])
      )
      .digest("hex");
  } catch {
    throw new EpicStoreError("invalid-response");
  }
};

/** Private to the main process. Confirm the remote link before reusing a bundle. */
export class EpicConnectionStore {
  private readonly directory: string;
  private database: EpicStoreDatabase | null = null;
  private opening: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly blocked = new Set<string>();

  constructor(private readonly options: EpicStoreOptions) {
    this.directory = path.join(options.userDataPath, "epic-sessions-db");
  }
  async open(): Promise<void> {
    if (this.closing) throw new EpicStoreError("persistence-failed");
    if (this.opening) return this.opening;
    if (this.database) return;
    const opening = this.openDatabase();
    this.opening = opening;
    try {
      await opening;
    } finally {
      this.opening = null;
    }
  }
  private async openDatabase() {
    try {
      await fs.mkdir(this.directory, {
        recursive: true,
        mode: STORE_DIRECTORY_MODE,
      });
      const stat = await fs.lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
      if (process.platform !== "win32")
        await fs.chmod(this.directory, STORE_DIRECTORY_MODE);
      if (this.closing) throw new Error();
      // ClassicLevel auto-opens; the private directory must already exist.
      this.database = this.options.createDatabase
        ? this.options.createDatabase(this.directory)
        : new ClassicLevel<string, unknown>(this.directory, {
            valueEncoding: "json",
          });
      await this.database.open();
    } catch {
      await this.database?.close().catch(() => undefined);
      this.database = null;
      throw new EpicStoreError("persistence-failed");
    }
  }
  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (this.closing)
      return Promise.reject(new EpicStoreError("persistence-failed"));
    const result = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(task);
    this.queues.set(key, result);
    void result
      .finally(() => {
        if (this.queues.get(key) === result) this.queues.delete(key);
      })
      .catch(() => undefined);
    return result;
  }
  private assertCurrent(isCurrent: () => boolean) {
    if (!isCurrent()) throw new EpicStoreError("operation-cancelled");
  }
  private assertUnblocked(key: string) {
    if (this.blocked.has(key)) throw new EpicStoreError("cleanup-failed");
  }
  private async readRecord(key: string): Promise<StoredRecord | null> {
    try {
      if (this.opening) await this.opening;
      else if (!this.database) await this.open();
      const value = await this.database!.get(key);
      if (value === undefined) return null;
      if (
        Buffer.byteLength(JSON.stringify(value), "utf8") >
          EPIC_STORE_MAX_RECORD_BYTES ||
        !isRecord(value) ||
        value.schemaVersion !== 1 ||
        !isConnection(value.connection)
      )
        throw new Error();
      return {
        schemaVersion: 1,
        connection: publicConnection(value.connection),
        ...(value.bundle === undefined ? {} : { bundle: value.bundle }),
      };
    } catch (error) {
      if (isRecord(error) && error.code === "LEVEL_NOT_FOUND") return null;
      if (error instanceof EpicStoreError) throw error;
      throw new EpicStoreError("persistence-failed");
    }
  }
  private describe(record: StoredRecord): EpicStoredConnection {
    const connection = publicConnection(record.connection);
    if (record.bundle === undefined)
      return { connection, sessionState: "missing" };
    if (!isBundle(record.bundle, connection.epicAccountId))
      return { connection, sessionState: "unavailable" };
    if (
      Date.parse(record.bundle.user.refresh_expires_at as string) <= Date.now()
    )
      return { connection, sessionState: "expired" };
    return { connection, sessionState: "ready", bundle: record.bundle };
  }
  async read(scope: EpicStoreScope): Promise<EpicStoredConnection | null> {
    const key = getEpicStoreScopeKey(scope);
    return this.enqueue(key, async () => {
      this.assertUnblocked(key);
      const record = await this.readRecord(key);
      return record ? this.describe(record) : null;
    });
  }
  private async writeRecord(
    key: string,
    previous: StoredRecord | null,
    record: StoredRecord,
    isCurrent: () => boolean,
    onCommitted?: (stored: EpicStoredConnection) => void
  ): Promise<EpicStoredConnection> {
    try {
      const serialized = JSON.stringify(record);
      if (Buffer.byteLength(serialized, "utf8") > EPIC_STORE_MAX_RECORD_BYTES)
        throw new EpicStoreError("invalid-response");
      const detached: StoredRecord = JSON.parse(serialized);
      this.assertCurrent(isCurrent);
      await this.database!.put(key, detached, { sync: true });
      if (!isCurrent()) {
        try {
          if (previous) await this.database!.put(key, previous, { sync: true });
          else await this.database!.del(key, { sync: true });
        } catch {
          this.blocked.add(key);
          throw new EpicStoreError("cleanup-failed");
        }
        throw new EpicStoreError("operation-cancelled");
      }
      const stored = this.describe(detached);
      // End cancelability synchronously, before the caller's await resumes.
      onCommitted?.(stored);
      return stored;
    } catch (error) {
      if (error instanceof EpicStoreError) throw error;
      throw new EpicStoreError("persistence-failed");
    }
  }
  async cacheConnection(
    scope: EpicStoreScope,
    connection: EpicConnectedConnection,
    isCurrent: () => boolean
  ): Promise<EpicStoredConnection> {
    const key = getEpicStoreScopeKey(scope);
    return this.enqueue(key, async () => {
      this.assertUnblocked(key);
      this.assertCurrent(isCurrent);
      if (!isConnection(connection))
        throw new EpicStoreError("invalid-response");
      const previous = await this.readRecord(key);
      const sameConnection =
        previous?.connection.connectionId === connection.connectionId &&
        previous.connection.epicAccountId === connection.epicAccountId;
      return this.writeRecord(
        key,
        previous,
        {
          schemaVersion: 1,
          connection: publicConnection(connection),
          ...(sameConnection && previous.bundle !== undefined
            ? { bundle: previous.bundle }
            : {}),
        },
        isCurrent
      );
    });
  }
  async save(
    scope: EpicStoreScope,
    connection: EpicConnectedConnection,
    bundle: EpicSessionBundle,
    isCurrent: () => boolean,
    onCommitted?: (stored: EpicStoredConnection) => void
  ): Promise<EpicStoredConnection> {
    const key = getEpicStoreScopeKey(scope);
    return this.enqueue(key, async () => {
      this.assertUnblocked(key);
      this.assertCurrent(isCurrent);
      if (
        !isConnection(connection) ||
        !isBundle(bundle, connection.epicAccountId)
      )
        throw new EpicStoreError("invalid-response");
      const previous = await this.readRecord(key);
      return this.writeRecord(
        key,
        previous,
        {
          schemaVersion: 1,
          connection: publicConnection(connection),
          bundle: { user: bundle.user, version: bundle.version },
        },
        isCurrent,
        onCommitted
      );
    });
  }
  async remove(
    scope: EpicStoreScope,
    isCurrent: () => boolean,
    expectedConnectionId?: string
  ): Promise<void> {
    const key = getEpicStoreScopeKey(scope);
    return this.enqueue(key, async () => {
      this.assertCurrent(isCurrent);
      const previous = await this.readRecord(key);
      this.assertCurrent(isCurrent);
      if (
        expectedConnectionId &&
        previous &&
        previous.connection.connectionId !== expectedConnectionId
      )
        throw new EpicStoreError("stale-connection");
      try {
        await this.database!.del(key, { sync: true });
        this.blocked.delete(key);
      } catch {
        this.blocked.add(key);
        throw new EpicStoreError("cleanup-failed");
      }
    });
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      await Promise.allSettled([...this.queues.values()]);
      await this.opening?.catch(() => undefined);
      try {
        await this.database?.close();
      } catch {
        throw new EpicStoreError("persistence-failed");
      } finally {
        this.database = null;
      }
    })();
    return this.closing;
  }
}
