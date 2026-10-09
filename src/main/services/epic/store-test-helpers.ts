import assert from "node:assert/strict";
import type { EpicStoreDatabase, EpicSessionBundle } from "./store";

export const connection = {
  connected: true as const,
  connectionId: "AbCdEfG1",
  epicAccountId: "a".repeat(32),
  displayName: "Epic Test",
  connectedAt: "2026-10-07T12:00:00.000Z",
};

export const bundle: EpicSessionBundle = {
  user: {
    account_id: connection.epicAccountId,
    displayName: connection.displayName,
    access_token: "secret-access",
    refresh_token: "secret-refresh",
    expires_at: "2099-01-01T00:00:00Z",
    refresh_expires_at: "2099-01-01T00:00:00Z",
  },
  version: { data: {} },
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

export class MemoryDatabase implements EpicStoreDatabase {
  readonly records = new Map<string, unknown>();
  onOpen = async () => {};
  onGet = async () => {};
  onPut = async () => {};
  onDel = async () => {};
  closed = false;

  async open() {
    await this.onOpen();
  }
  async close() {
    this.closed = true;
  }
  async get(key: string) {
    assert.equal(this.closed, false);
    await this.onGet();
    return this.records.has(key)
      ? structuredClone(this.records.get(key))
      : undefined;
  }
  async put(key: string, value: unknown, options: { sync: true }) {
    assert.equal(this.closed, false);
    assert.equal(options.sync, true);
    await this.onPut();
    this.records.set(key, structuredClone(value));
  }
  async del(key: string, options: { sync: true }) {
    assert.equal(this.closed, false);
    assert.equal(options.sync, true);
    await this.onDel();
    this.records.delete(key);
  }
}
