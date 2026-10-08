import assert from "node:assert/strict";
import test from "node:test";
import { createEpicStoreCrypto } from "./crypto.ts";

for (const backend of [
  "gnome_libsecret",
  "kwallet",
  "kwallet5",
  "kwallet6",
  "basic_text",
  "unknown",
  undefined,
]) {
  test(`Linux vault ${backend ?? "unavailable"} cannot silently persist unprotected tokens`, () => {
    const storage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: backend ? () => backend : undefined,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    };
    const crypto = createEpicStoreCrypto("linux", storage);
    assert.equal(
      crypto.isEncryptionAvailable(),
      !["basic_text", "unknown", undefined].includes(backend)
    );
  });
}

test("locked vault remains unavailable and Windows/macOS keep their existing protection", () => {
  for (const platform of ["linux", "win32", "darwin"]) {
    let available = false;
    const storage = {
      isEncryptionAvailable: () => available,
      getSelectedStorageBackend: () => {
        assert.equal(platform, "linux");
        return "kwallet6";
      },
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    };
    const crypto = createEpicStoreCrypto(platform, storage);
    assert.equal(crypto.isEncryptionAvailable(), false);
    available = true;
    assert.equal(crypto.isEncryptionAvailable(), true);
    assert.equal(
      crypto.decryptString(crypto.encryptString("synthetic data")),
      "synthetic data"
    );
  }
});

test("backend failures are treated as unavailable without leaking native errors", () => {
  const storage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => {
      throw new Error("SECRET keyring detail");
    },
    encryptString: () => assert.fail("unavailable vault must not encrypt"),
    decryptString: () => assert.fail("unavailable vault must not decrypt"),
  };
  assert.equal(
    createEpicStoreCrypto("linux", storage).isEncryptionAvailable(),
    false
  );
});
