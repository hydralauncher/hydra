const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const repo = path.resolve(__dirname, "../../..");
const test = require("node:test");
const ts = require(path.join(repo, "node_modules/typescript"));
const sharp = require(path.join(repo, "node_modules/sharp"));
const cacheDirectory = fs.mkdtempSync(
  path.join(require("node:os").tmpdir(), "hydra-epic-icon-test-")
);
test.after(async () => {
  const iconsDirectory = path.join(cacheDirectory, "epic-icons");
  for (const file of await fs.promises.readdir(iconsDirectory))
    await fs.promises.unlink(path.join(iconsDirectory, file));
  await fs.promises.rmdir(iconsDirectory);
  await fs.promises.rmdir(cacheDirectory);
});
function load(relative, mocks = {}) {
  const filename = path.join(repo, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, {
    filename,
  })(
    (name) => (Object.hasOwn(mocks, name) ? mocks[name] : require(name)),
    module,
    module.exports
  );
  return module.exports;
}
const shared = load("src/shared/artwork-resolver.ts");
const parser = load("src/main/events/catalogue/cover-poster-url.ts");
const item = (overrides = {}) => ({
  id: 1,
  score: 10,
  url: "https://cdn2.steamgriddb.com/icon/large.png",
  thumb: "",
  width: 512,
  height: 512,
  ...overrides,
});
function service(items, download) {
  let downloads = 0;
  const apiRequests = [];
  const api = {
    getResponse: async (route, query) => {
      apiRequests.push({ route, query });
      return {
        status: 200,
        headers: {},
        data: { success: true, data: route.endsWith("/icons") ? items : [] },
      };
    },
  };
  const instance = load("src/main/services/game-artwork.ts", {
    "@shared": shared,
    "./hydra-api": { HydraApi: api },
    "@main/constants": { ASSETS_PATH: cacheDirectory },
    "../events/catalogue/cover-poster-url": parser,
    sharp,
    axios: {
      get: async (url, options) => {
        downloads++;
        assert.equal(options.maxRedirects, 0);
        assert.equal(options.maxContentLength, 2 * 1024 * 1024);
        return { data: await download(url) };
      },
    },
  });
  return { ...instance, downloads: () => downloads, apiRequests };
}
const assets = (id) => ({
  shop: "epic",
  objectId: id,
  title: "Game",
  iconUrl: null,
  coverImageUrl: null,
  libraryImageUrl: null,
  libraryHeroImageUrl: null,
});
test("Epic icons use a bounded PNG cache with safe fallbacks", async () => {
  const png = await sharp({
    create: { width: 512, height: 512, channels: 4, background: "#336699" },
  })
    .png()
    .toBuffer();
  const large = service([item()], async () => png);
  const [first, concurrent] = await Promise.all([
    large.resolveEpicDefaultArtwork(assets("large")),
    large.resolveEpicDefaultArtwork(assets("large")),
  ]);
  assert.equal(first.iconUrl, concurrent.iconUrl);
  assert.equal(large.downloads(), 1);
  assert.match(first.iconUrl, /^local:/);
  const metadata = await sharp(first.iconUrl.slice(6)).metadata();
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 64);
  await large.resolveEpicDefaultArtwork(assets("large-again"));
  assert.equal(large.downloads(), 1, "disk cache avoids another download");
  assert.equal(
    large.apiRequests.find((r) => r.route.endsWith("/icons")).query.dimensions,
    undefined
  );
  const ico = service(
    [
      item({
        url: "https://cdn2.steamgriddb.com/icon/large.ico",
        thumb: "https://cdn2.steamgriddb.com/icon/hash/32/256x256.png",
        width: 0,
        height: 0,
      }),
    ],
    async (url) => {
      assert.match(url, /256x256.png$/);
      return png;
    }
  );
  assert.match(
    (await ico.resolveEpicDefaultArtwork(assets("ico"))).iconUrl,
    /^local:/
  );
  const small = service(
    [
      item({
        width: 16,
        height: 16,
        url: "https://cdn2.steamgriddb.com/icon/small.png",
      }),
    ],
    async () => {
      throw Error("unexpected download");
    }
  );
  assert.equal(
    (await small.resolveEpicDefaultArtwork(assets("small"))).iconUrl,
    "https://cdn2.steamgriddb.com/icon/small.png"
  );
  assert.equal(small.downloads(), 0);
  const failed = service(
    [item({ url: "https://cdn2.steamgriddb.com/icon/fail.png" })],
    async () => {
      throw Error("timeout");
    }
  );
  const failedResult = await failed.resolveEpicDefaultArtwork(assets("failed"));
  assert.equal(failedResult.iconUrl, null);
  assert.equal(failedResult.epicArtworkUpdatedAtByType.icon, undefined);
  let failNext = true;
  const retry = service(
    [item({ url: "https://cdn2.steamgriddb.com/icon/retry.png" })],
    async () => {
      if (failNext) {
        failNext = false;
        throw Error("temporary timeout");
      }
      return png;
    }
  );
  const expiredTimestamp =
    Date.now() - retry.EPIC_ARTWORK_CACHE_DURATION_MS - 1;
  const expired = {
    ...assets("retry"),
    iconUrl: "local:previous-icon",
    epicArtworkUpdatedAtByType: { icon: expiredTimestamp },
  };
  const preservedAfterFailure = await retry.resolveEpicDefaultArtwork(
    assets("retry"),
    expired
  );
  assert.equal(preservedAfterFailure.iconUrl, expired.iconUrl);
  assert.equal(
    preservedAfterFailure.epicArtworkUpdatedAtByType.icon,
    expiredTimestamp
  );
  const recovered = await retry.resolveEpicDefaultArtwork(
    assets("retry"),
    preservedAfterFailure
  );
  assert.match(recovered.iconUrl, /^local:/);
  assert.notEqual(recovered.iconUrl, expired.iconUrl);
  assert.equal(retry.downloads(), 2);
  assert.ok(recovered.epicArtworkUpdatedAtByType.icon > expiredTimestamp);
  const foreign = service(
    [item({ url: "https://evil.invalid/icon/large.png" })],
    async () => {
      throw Error("unexpected download");
    }
  );
  assert.equal(
    (await foreign.resolveEpicDefaultArtwork(assets("foreign"))).iconUrl,
    null
  );
  assert.equal(foreign.downloads(), 0);
  const invalid = service(
    [item({ url: "https://cdn2.steamgriddb.com/icon/text.png" })],
    async () => Buffer.from("not an image")
  );
  assert.equal(
    (await invalid.resolveEpicDefaultArtwork(assets("invalid")))
      .epicArtworkUpdatedAtByType.icon,
    undefined
  );
  const steam = assets("steam");
  steam.shop = "steam";
  assert.deepEqual(await large.resolveEpicDefaultArtwork(steam), steam);
  const userSelection = {
    selected: { icon: { url: "local:user-icon", artworkId: 2 } },
  };
  assert.equal(
    shared.composeAssetsWithArtwork(first, userSelection).iconUrl,
    "local:user-icon"
  );
  console.log(
    "PASS: large PNG, ICO preview, small PNG, disk cache, concurrency, failed download retry, untrusted URL, invalid image, Steam unchanged, user selection precedence"
  );
});
