import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decryptDuckStationLoginToken,
  encryptDuckStationLoginToken,
} from "./duckstation-login-token.js";

const machineKey = Buffer.from("7f3e6c1a-0b2d-4e5f-9a8b-112233445566\0");

describe("DuckStation login token", () => {
  it("round-trips a 16 character connect token in a single AES block", () => {
    const encrypted = encryptDuckStationLoginToken(
      "AbCdEfGhIjKlMnOp",
      "player",
      machineKey
    );

    assert.equal(Buffer.from(encrypted, "base64").length, 16);
    assert.equal(
      decryptDuckStationLoginToken(encrypted, "player", machineKey),
      "AbCdEfGhIjKlMnOp"
    );
  });

  it("zero-pads tokens that are not block aligned", () => {
    const encrypted = encryptDuckStationLoginToken(
      "short",
      "player",
      machineKey
    );

    assert.equal(Buffer.from(encrypted, "base64").length, 16);
    assert.equal(
      decryptDuckStationLoginToken(encrypted, "player", machineKey),
      "short"
    );
  });

  it("is deterministic and bound to the username and machine key", () => {
    const encrypted = encryptDuckStationLoginToken(
      "AbCdEfGhIjKlMnOp",
      "player",
      machineKey
    );

    assert.equal(
      encryptDuckStationLoginToken("AbCdEfGhIjKlMnOp", "player", machineKey),
      encrypted
    );
    assert.notEqual(
      decryptDuckStationLoginToken(encrypted, "other", machineKey),
      "AbCdEfGhIjKlMnOp"
    );
    assert.notEqual(
      decryptDuckStationLoginToken(encrypted, "player", null),
      "AbCdEfGhIjKlMnOp"
    );
  });

  it("supports portable installs without a machine key", () => {
    const encrypted = encryptDuckStationLoginToken(
      "AbCdEfGhIjKlMnOp",
      "player",
      null
    );

    assert.equal(
      decryptDuckStationLoginToken(encrypted, "player", null),
      "AbCdEfGhIjKlMnOp"
    );
  });
});
