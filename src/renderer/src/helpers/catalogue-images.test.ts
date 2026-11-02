import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeCatalogueThumbHash,
  findCatalogueImageVariants,
  getCatalogueImageDensitySrcSet,
  getCatalogueImageSrcSet,
  pickCatalogueImageUrl,
} from "./catalogue-images.js";

const coverUrl =
  "https://shared.steamstatic.com/store_item_assets/steam/apps/271590/library_600x900_2x.jpg";
const cover = {
  base: "https://cdn.losbroxas.org/img/v1/bba708cf29c2a9192a9294f584475d12",
  widths: [600, 200, 400],
  thumbHash: "migKDQIZN4uJB6Zol4emhcFkz471",
};

describe("findCatalogueImageVariants", () => {
  it("looks variants up by the original URL", () => {
    assert.equal(
      findCatalogueImageVariants({ [coverUrl]: cover }, ` ${coverUrl} `),
      cover
    );
  });

  it("ignores missing URLs and entries without widths", () => {
    assert.equal(findCatalogueImageVariants({ [coverUrl]: cover }, null), null);
    assert.equal(
      findCatalogueImageVariants({ [coverUrl]: cover }, "https://x/y.jpg"),
      null
    );
    assert.equal(
      findCatalogueImageVariants(
        { [coverUrl]: { ...cover, widths: [] } },
        coverUrl
      ),
      null
    );
  });
});

describe("pickCatalogueImageUrl", () => {
  it("picks the smallest width that covers the target", () => {
    assert.equal(pickCatalogueImageUrl(cover, 250), `${cover.base}/w400.webp`);
    assert.equal(pickCatalogueImageUrl(cover, 200), `${cover.base}/w200.webp`);
  });

  it("falls back to the largest width", () => {
    assert.equal(pickCatalogueImageUrl(cover, 2000), `${cover.base}/w600.webp`);
  });
});

describe("srcset builders", () => {
  it("lists widths in ascending order", () => {
    assert.equal(
      getCatalogueImageSrcSet(cover),
      `${cover.base}/w200.webp 200w, ${cover.base}/w400.webp 400w, ${cover.base}/w600.webp 600w`
    );
  });

  it("picks one width per pixel density", () => {
    assert.equal(
      getCatalogueImageDensitySrcSet(cover, 300),
      `${cover.base}/w400.webp 1x, ${cover.base}/w600.webp 2x`
    );
  });
});

describe("decodeCatalogueThumbHash", () => {
  it("decodes a ThumbHash into a PNG data URL", () => {
    const placeholder = decodeCatalogueThumbHash(cover.thumbHash);
    assert.ok(placeholder?.startsWith("data:image/png;base64,"));
    assert.equal(decodeCatalogueThumbHash(cover.thumbHash), placeholder);
  });

  it("returns null for empty or invalid hashes", () => {
    assert.equal(decodeCatalogueThumbHash(null), null);
    assert.equal(decodeCatalogueThumbHash("%%%"), null);
  });
});
