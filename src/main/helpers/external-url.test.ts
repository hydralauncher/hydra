import { describe, it } from "node:test";
import assert from "node:assert";

import { parseExternalUrl } from "./external-url.ts";

describe("parseExternalUrl", () => {
  it("accepts http and https addresses", () => {
    assert.equal(
      parseExternalUrl("https://store.steampowered.com/app/1/"),
      "https://store.steampowered.com/app/1/"
    );
    assert.equal(parseExternalUrl("http://example.com"), "http://example.com/");
  });

  it("rejects schemes that can start programs", () => {
    for (const value of [
      "file:///C:/Windows/System32/calc.exe",
      "steam://install/1",
      "javascript:alert(1)",
      "ms-settings:privacy",
      "\\\\server\\share\\run.exe",
    ]) {
      assert.equal(parseExternalUrl(value), null, value);
    }
  });

  it("rejects values that are not URLs", () => {
    assert.equal(parseExternalUrl("not a url"), null);
    assert.equal(parseExternalUrl(""), null);
    assert.equal(parseExternalUrl(undefined), null);
    assert.equal(parseExternalUrl({ href: "https://example.com" }), null);
  });
});
