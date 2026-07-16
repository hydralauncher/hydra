import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCoverPosterRemoteUrl } from "./cover-poster-url.ts";

describe("cover poster remote URL", () => {
  it("accepts HTTPS URLs from allowed hosts and subdomains", () => {
    assert.equal(
      parseCoverPosterRemoteUrl(
        "https://cdn2.steamgriddb.com/hero/example.webp"
      )?.hostname,
      "cdn2.steamgriddb.com"
    );
  });

  it("rejects HTTP and deceptive hosts", () => {
    assert.equal(
      parseCoverPosterRemoteUrl(
        "http://cdn2.steamgriddb.com/hero/example.webp"
      ),
      null
    );
    assert.equal(
      parseCoverPosterRemoteUrl(
        "https://steamgriddb.com.example.com/hero/example.webp"
      ),
      null
    );
  });

  it("resolves only trusted redirect locations", () => {
    const current = new URL("https://cdn2.steamgriddb.com/hero/example.webp");

    assert.equal(
      parseCoverPosterRemoteUrl("/hero/redirected.webp", current)?.toString(),
      "https://cdn2.steamgriddb.com/hero/redirected.webp"
    );
    assert.equal(
      parseCoverPosterRemoteUrl("http://127.0.0.1/private", current),
      null
    );
    assert.equal(
      parseCoverPosterRemoteUrl("https://example.com/private", current),
      null
    );
  });
});
