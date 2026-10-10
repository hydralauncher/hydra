import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveCachedStoreDetails,
  resolveStoreDetails,
} from "./store-details-fallback.js";

describe("offline store details cache", () => {
  it("keeps a saved localized description when both remote providers fail", async () => {
    const cached = { long: "Descrição salva", locale: "pt-BR" };
    const result = await resolveCachedStoreDetails(
      cached,
      async () => {
        throw Error("offline");
      },
      async () => {
        throw Error("must not save unavailable content");
      },
      () => {}
    );
    assert.deepEqual(result, cached);
  });
  it("returns newly fetched details even when local persistence fails", async () => {
    const fresh = { long: "English long", locale: "en-US" };
    const result = await resolveCachedStoreDetails(
      null,
      async () => fresh,
      async () => {
        throw Error("disk full");
      },
      () => {}
    );
    assert.deepEqual(result, fresh);
  });
});

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
