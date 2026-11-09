import assert from "node:assert/strict";
import test from "node:test";
import { EpicCloudSaveSource } from "./cloud-save-source.js";
import {
  EPIC_SAVE_MAX_RESPONSE_BYTES,
  EPIC_SAVE_STORAGE_ORIGIN,
} from "./constants.js";
import type { EpicManagedTarget } from "./legendary-managed-runtime";

const accountId = "a".repeat(32);
const target = {
  auth: { generation: 1 },
  connection: { epicAccountId: accountId },
  owner: { epicAccountId: accountId },
  artifactId: "Artifact",
} as EpicManagedTarget;
const name = "2026.10.13-12.00.00.manifest";
const lastModified = "2026-10-15T12:00:00.000Z";
const listing = {
  files: {
    [`savesync/${accountId}/Artifact/manifests/${name}`]: {
      lastModified,
      readLink: "https://unused.example/signed-url",
    },
  },
};

test("reads scoped remote upload metadata and refreshes an expired token", async () => {
  const refreshes: boolean[] = [];
  const source = new EpicCloudSaveSource(
    {
      token: async (_auth, _connection, _signal, force) => {
        refreshes.push(force === true);
        return force ? "fresh" : "expired";
      },
    },
    async (url, options) => {
      assert.equal(
        url,
        `${EPIC_SAVE_STORAGE_ORIGIN}/api/v1/access/egstore/savesync/${accountId}/Artifact/manifests/`
      );
      assert.equal(options?.redirect, "error");
      const authorization = new Headers(options?.headers).get("Authorization");
      return authorization === "Bearer fresh"
        ? Response.json(listing)
        : new Response("expired", { status: 401 });
    }
  );
  assert.deepEqual(await source.latest(target, new AbortController().signal), {
    name,
    lastModified,
  });
  assert.deepEqual(refreshes, [false, true]);
});

test("rejects malformed and oversized listings without treating failures as an empty cloud", async () => {
  for (const body of [
    "broken JSON",
    JSON.stringify({}),
    " ".repeat(EPIC_SAVE_MAX_RESPONSE_BYTES + 1),
  ]) {
    const source = new EpicCloudSaveSource(
      { token: async () => "token" },
      async () => new Response(body)
    );
    await assert.rejects(
      source.latest(target, new AbortController().signal),
      /save-sync-failed/
    );
  }
});

test("cancellation cannot publish a listing returned after the operation was invalidated", async () => {
  const controller = new AbortController();
  const source = new EpicCloudSaveSource(
    { token: async () => "token" },
    async () => {
      controller.abort();
      return Response.json(listing);
    }
  );
  await assert.rejects(source.latest(target, controller.signal));
});
