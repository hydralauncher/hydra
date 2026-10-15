import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  sanitizeNetworkLogPayload,
  summarizeNetworkLogPayload,
} from "./network-log-payload.js";

describe("network log payload", () => {
  it("keeps nested response arrays inspectable", () => {
    const sanitized = sanitizeNetworkLogPayload({
      snapshot: { id: "snapshot", version: 2 },
      variants: [
        {
          variantId: "a".repeat(64),
          kind: "steam-account",
          steamId64: "76561198051718575",
        },
      ],
      files: [
        {
          variantId: "a".repeat(64),
          rawPath: "<winAppData>/EldenRing/<storeUserId>",
          relativePath: "ER0000.sl2",
        },
      ],
    }) as {
      files: Array<Record<string, unknown>>;
    };

    assert.equal(typeof sanitized.files[0], "object");
    assert.deepEqual(sanitized.files[0], {
      variantId: "a".repeat(64),
      rawPath: "<winAppData>/EldenRing/<storeUserId>",
      relativePath: "ER0000.sl2",
    });
  });

  it("redacts credentials recursively", () => {
    assert.deepEqual(
      sanitizeNetworkLogPayload({
        accessToken: "top-level",
        nested: {
          Authorization: "Bearer secret",
          users: [{ refreshToken: "nested" }],
        },
      }),
      {
        accessToken: "[REDACTED]",
        nested: {
          Authorization: "[REDACTED]",
          users: [{ refreshToken: "[REDACTED]" }],
        },
      }
    );
  });

  it("parses serialized request bodies before logging them", () => {
    const sanitized = sanitizeNetworkLogPayload(
      JSON.stringify({ files: [{ relativePath: "save.dat" }], token: "secret" })
    );

    assert.deepEqual(sanitized, {
      files: [{ relativePath: "save.dat" }],
      token: "[REDACTED]",
    });
  });

  it("redacts Epic proofs and OAuth secrets in objects and serialized JSON", () => {
    const payload = {
      exchangeCode: "exchange-secret",
      nested: {
        exchange_code: "exchange-secret-2",
        authorizationCode: "auth-secret",
        authorization_code: "auth-secret-2",
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        client_secret: "client-secret",
      },
    };
    for (const input of [payload, JSON.stringify(payload)]) {
      const output = JSON.stringify(sanitizeNetworkLogPayload(input));
      assert.ok(!output.includes("exchange-secret"));
      assert.ok(!output.includes("auth-secret"));
      assert.ok(!output.includes("access-secret"));
      assert.ok(!output.includes("refresh-secret"));
      assert.ok(!output.includes("client-secret"));
      assert.equal((output.match(/\[REDACTED\]/g) ?? []).length, 7);
    }
  });

  it("redacts Epic secrets in URLs and form bodies, including duplicate keys", () => {
    const form =
      "grant_type=exchange_code&exchange_code=secret&exchange_code=other&refresh_token=refresh";
    const sanitized = sanitizeNetworkLogPayload(form) as string;
    assert.equal(
      sanitized,
      "grant_type=exchange_code&exchange_code=%5BREDACTED%5D&refresh_token=%5BREDACTED%5D"
    );
    const url = sanitizeNetworkLogPayload(
      "https://example.com/?authorizationCode=secret&exchangeCode=proof&part=1"
    ) as string;
    assert.ok(!url.includes("secret"));
    assert.ok(!url.includes("proof"));
    assert.ok(url.includes("part=1"));
  });

  it("redacts signed URL parameters without hiding ordinary URLs", () => {
    const sanitized = sanitizeNetworkLogPayload({
      sourceUrl: "https://example.com/file?part=1&X-Amz-Signature=secret",
      website: "https://example.com/games/1",
      downloadUrl: "https://example.com/private",
    }) as Record<string, string>;

    assert.match(sanitized.sourceUrl, /X-Amz-Signature=%5BREDACTED%5D/);
    assert.equal(sanitized.website, "https://example.com/games/1");
    assert.equal(sanitized.downloadUrl, "[REDACTED]");
  });

  it("redacts duplicate sensitive URL parameters", () => {
    const sanitized = sanitizeNetworkLogPayload({
      sourceUrl: "https://example.com/file?token=first&part=1&token=second",
    }) as Record<string, string>;

    assert.equal(
      sanitized.sourceUrl,
      "https://example.com/file?token=%5BREDACTED%5D&part=1"
    );
  });

  it("handles circular diagnostic objects safely", () => {
    const value: Record<string, unknown> = { status: 200 };
    value.self = value;

    assert.deepEqual(sanitizeNetworkLogPayload(value), {
      status: 200,
      self: "[Circular]",
    });
  });

  it("summarizes bulk payloads without walking them", () => {
    assert.equal(
      summarizeNetworkLogPayload([{ id: 1 }, { id: 2 }]),
      "[Array: 2 items]"
    );
    assert.equal(
      summarizeNetworkLogPayload({ games: [], total: 0 }),
      "[Object: 2 keys]"
    );
    assert.equal(summarizeNetworkLogPayload("ok"), "ok");
  });
});
