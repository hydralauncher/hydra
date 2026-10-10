import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveStoreDetails } from "./store-details-fallback.js";

describe("store details direct request and persisted fallback", () => {
  for (const locale of ["en", "pt-BR", "ru", "es"]) {
    it(`keeps direct ${locale} content without invoking the API`, async () => {
      let fallbackCalls = 0;
      const result = await resolveStoreDetails(
        async () => ({ long: "Translated long content", locale }),
        async () => {
          fallbackCalls++;
          return { long: "English", locale: "en-US" };
        },
        (details) => Boolean(details.long)
      );
      assert.equal(result?.locale, locale);
      assert.equal(fallbackCalls, 0);
    });
  }
  for (const reason of ["429", "timeout", "network", "GraphQL"]) {
    it(`uses the English fallback on ${reason}`, async () => {
      let calls = 0;
      const result = await resolveStoreDetails(
        async () => {
          throw new Error(reason);
        },
        async () => {
          calls++;
          return "English long description";
        },
        Boolean
      );
      assert.equal(result, "English long description");
      assert.equal(calls, 1);
    });
  }
  it("rejects short-only content", async () => {
    const result = await resolveStoreDetails(
      async () => ({ long: "", short: "Summary" }),
      async () => ({ long: "English long", short: "Summary" }),
      (details) => Boolean(details.long)
    );
    assert.equal(result?.long, "English long");
  });
});
