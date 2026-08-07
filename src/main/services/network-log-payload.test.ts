import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeNetworkLogPayload } from "./network-log-payload.js";

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
});
