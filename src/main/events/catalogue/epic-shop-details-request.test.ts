import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AxiosError } from "axios";
import { HydraApiRequestError } from "../../services/hydra-api-request-error.js";
import { fetchEpicShopDetailsWithCache } from "./epic-shop-details-request.js";

const httpError = (status: number) =>
  Object.assign(new AxiosError(`HTTP ${status}`), {
    response: { status },
  });

describe("Epic shop details offline cache", () => {
  it("returns fresh details without reading cache", async () => {
    let cacheReads = 0;
    const result = await fetchEpicShopDetailsWithCache(
      async () => ({ title: "Fresh" }),
      async () => {
        cacheReads += 1;
        return { title: "Cached" };
      }
    );

    assert.deepEqual(result, {
      source: "remote",
      data: { title: "Fresh" },
    });
    assert.equal(cacheReads, 0);
  });

  for (const error of [
    new HydraApiRequestError("Request failed with ETIMEDOUT timeout"),
    httpError(503),
    new AxiosError("socket hang up"),
  ]) {
    it(`uses cached details after ${error.message}`, async () => {
      const result = await fetchEpicShopDetailsWithCache(
        async () => {
          throw error;
        },
        async () => ({ title: "Cached" })
      );

      assert.deepEqual(result, {
        source: "cache",
        data: { title: "Cached" },
      });
    });
  }

  it("preserves the request error when no cache exists", async () => {
    const error = new HydraApiRequestError("Request failed with ENOTFOUND");

    await assert.rejects(
      fetchEpicShopDetailsWithCache(
        async () => {
          throw error;
        },
        async () => null
      ),
      (caught: unknown) => caught === error
    );
  });

  for (const error of [
    httpError(404),
    new Error("Unexpected conversion error"),
  ]) {
    it(`does not use cache for ${error.message}`, async () => {
      let cacheReads = 0;

      await assert.rejects(
        fetchEpicShopDetailsWithCache(
          async () => {
            throw error;
          },
          async () => {
            cacheReads += 1;
            return { title: "Cached" };
          }
        ),
        (caught: unknown) => caught === error
      );

      assert.equal(cacheReads, 0);
    });
  }

  it("does not hide cache read failures", async () => {
    const cacheError = new Error("LevelDB unavailable");

    await assert.rejects(
      fetchEpicShopDetailsWithCache(
        async () => {
          throw httpError(500);
        },
        async () => {
          throw cacheError;
        }
      ),
      (caught: unknown) => caught === cacheError
    );
  });
});
