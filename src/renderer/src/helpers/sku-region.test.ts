import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getRegionsFromSkus,
  getSkuRegion,
  getSkuRegionFromSaveIdentity,
} from "./sku-region.js";

describe("getSkuRegion", () => {
  it("preserves PlayStation region detection", () => {
    assert.equal(getSkuRegion("SLUS-21376"), "US");
    assert.equal(getSkuRegion("BLES-01234"), "EU");
    assert.equal(getSkuRegion("BLJM-01234"), "JP");
    assert.equal(getSkuRegion("BLKS-01234"), "KR");
    assert.equal(getSkuRegion("BLAS-01234"), "ASIA");
  });

  it("detects PSP regions from DISC_ID values", () => {
    assert.equal(getSkuRegion(" ulus_10080 "), "US");
    assert.equal(getSkuRegion("ULES-00288"), "EU");
    assert.equal(getSkuRegion("ULJM05574"), "JP");
    assert.equal(getSkuRegion("ULKS-46142"), "KR");
    assert.equal(getSkuRegion("ULAS-42043"), "ASIA");
    assert.equal(getSkuRegion("NPHH-00123"), "ASIA");
  });

  it("detects GameCube and Wii regions from Game IDs", () => {
    assert.equal(getSkuRegion("RMGE01"), "US");
    assert.equal(getSkuRegion("GZLP01"), "EU");
    assert.equal(getSkuRegion("GZLJ01"), "JP");
    assert.equal(getSkuRegion("RMCK01"), "KR");
    assert.equal(getSkuRegion("RMCW01"), "ASIA");
  });

  it("does not invent flags for worldwide or invalid identifiers", () => {
    assert.equal(getSkuRegion("RMCA01"), null);
    assert.equal(getSkuRegion("ABUS-12345"), null);
    assert.equal(getSkuRegion("RMGE0"), null);
    assert.equal(getSkuRegion(""), null);
  });
});

describe("SKU region presentation helpers", () => {
  it("deduplicates regions in display order", () => {
    assert.deepEqual(
      getRegionsFromSkus(["GZLJ01", "SLUS-21376", "RMGE01", "ULES-00288"]),
      ["US", "EU", "JP"]
    );
  });

  it("preserves memory-card save identity normalization", () => {
    assert.equal(getSkuRegionFromSaveIdentity("BASLUS-21376"), "US");
    assert.equal(getSkuRegionFromSaveIdentity(null), null);
  });
});
