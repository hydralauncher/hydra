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
const cacheDirectories = [path.join(cacheDirectory, "epic-icons")];
test.after(async () => {
  await Promise.all(
    cacheDirectories.map(async (directory) => {
      const files = await fs.promises.readdir(directory);
      await Promise.all(
        files.map((file) => fs.promises.unlink(path.join(directory, file)))
      );
      await fs.promises.rmdir(directory);
    })
  );
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
function service(items, download, grids = () => []) {
  let downloads = 0;
  const apiRequests = [];
  const api = {
    getResponse: async (route, query) => {
      apiRequests.push({ route, query });
      return {
        status: 200,
        headers: {},
        data: {
          success: true,
          data: route.endsWith("/icons") ? items : grids(query),
        },
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
test("no-logo grids fall back to other dimensions without selecting logos or wrong ratios", async () => {
  const portrait = item({
    url: "https://cdn2.steamgriddb.com/grid/portrait.png",
    style: "no_logo",
    width: 512,
    height: 768,
  });
  const landscape = item({
    url: "https://cdn2.steamgriddb.com/grid/landscape.png",
    style: "no_logo",
    width: 1024,
    height: 512,
  });
  const instance = service(
    [],
    async () => {
      throw Error("unexpected download");
    },
    (query) =>
      query.dimensions
        ? []
        : [portrait, landscape, item({ style: "alternate", score: 999 })]
  );
  const result = await instance.resolveEpicDefaultArtwork(
    assets("different-dimensions")
  );
  assert.equal(result.coverImageUrl, portrait.url);
  assert.equal(result.libraryImageUrl, portrait.url);
  assert.equal(result.libraryHeroImageUrl, landscape.url);
  assert.ok(
    instance.apiRequests
      .filter((r) => r.route.endsWith("/grids"))
      .every((r) => r.query.styles === "no_logo")
  );
});

test("confirmed missing icons wait for the artwork cache before retrying", async () => {
  const instance = service([], async () => {
    throw Error("unexpected download");
  });
  const now = Date.now();
  const cached = {
    ...assets("missing-retry"),
    coverImageUrl: "https://cdn2.steamgriddb.com/grid/kept.png",
    epicArtworkUpdatedAtByType: { icon: now, portrait: now, landscape: now },
  };
  await instance.resolveEpicDefaultArtwork(cached, cached);
  assert.equal(instance.apiRequests.length, 0);
  const PREVIOUS_MISSING_ICON_RETRY_MS = 5 * 60 * 1000;
  cached.epicArtworkUpdatedAtByType.icon =
    now - PREVIOUS_MISSING_ICON_RETRY_MS - 1;
  await instance.resolveEpicDefaultArtwork(cached, cached);
  assert.equal(instance.apiRequests.length, 0);
  cached.epicArtworkUpdatedAtByType.icon =
    now - instance.EPIC_ARTWORK_CACHE_DURATION_MS - 1;
  const retried = await instance.resolveEpicDefaultArtwork(cached, cached);
  assert.equal(instance.apiRequests.length, 1);
  assert.ok(instance.apiRequests[0].route.endsWith("/icons"));
  assert.equal(retried.coverImageUrl, cached.coverImageUrl);
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
  const repair = service(
    [item({ url: "https://cdn2.steamgriddb.com/icon/repair.png" })],
    async () => png
  );
  const original = await repair.resolveEpicDefaultArtwork(assets("repair"));
  await fs.promises.unlink(original.iconUrl.slice(6));
  const restored = await repair.resolveEpicDefaultArtwork(
    assets("repair"),
    original
  );
  assert.equal(repair.downloads(), 2);
  assert.match(restored.iconUrl, /^local:/);
  await fs.promises.writeFile(restored.iconUrl.slice(6), "corrupt file");
  const repaired = await repair.resolveEpicDefaultArtwork(
    assets("repair"),
    restored
  );
  assert.equal(repair.downloads(), 3);
  assert.equal((await sharp(repaired.iconUrl.slice(6)).metadata()).width, 64);
  const writeFile = fs.promises.writeFile;
  let failWrite = true;
  const disk = service(
    [item({ url: "https://cdn2.steamgriddb.com/icon/disk.png" })],
    async () => png
  );
  fs.promises.writeFile = async (filename, ...parameters) => {
    if (failWrite && String(filename).endsWith(".tmp")) {
      failWrite = false;
      throw Object.assign(new Error("no space"), { code: "ENOSPC" });
    }
    return writeFile(filename, ...parameters);
  };
  try {
    const retained = await disk.resolveEpicDefaultArtwork(
      assets("disk"),
      expired
    );
    assert.equal(retained.iconUrl, expired.iconUrl);
    const restoredAfterDiskFailure = await disk.resolveEpicDefaultArtwork(
      assets("disk"),
      retained
    );
    assert.match(restoredAfterDiskFailure.iconUrl, /^local:/);
    assert.notEqual(restoredAfterDiskFailure.iconUrl, expired.iconUrl);
  } finally {
    fs.promises.writeFile = writeFile;
  }
  await Promise.all(
    [
      { name: "file-count", maxFiles: 2, maxBytes: 100, incoming: 4 },
      { name: "byte-count", maxFiles: 10, maxBytes: 10, incoming: 4 },
    ].map(async ({ name, maxFiles, maxBytes, incoming }) => {
      const directory = path.join(cacheDirectory, name);
      cacheDirectories.push(directory);
      await fs.promises.mkdir(directory);
      const oldFile = path.join(directory, `${"a".repeat(64)}.png`);
      const newFile = path.join(directory, `${"b".repeat(64)}.png`);
      const unrelatedFile = path.join(directory, "user-file.txt");
      await fs.promises.writeFile(oldFile, Buffer.alloc(5));
      await fs.promises.writeFile(newFile, Buffer.alloc(3));
      await fs.promises.writeFile(unrelatedFile, "keep");
      await fs.promises.utimes(oldFile, new Date(1000), new Date(1000));
      await fs.promises.utimes(newFile, new Date(2000), new Date(2000));
      await repair.pruneEpicIconCache(directory, incoming, maxFiles, maxBytes);
      assert.equal(fs.existsSync(oldFile), false);
      assert.equal(fs.existsSync(newFile), true);
      assert.equal(fs.existsSync(unrelatedFile), true);
    })
  );
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
function runSourceFragment(relative, select, suffix, globals, prefix = "") {
  const filename = path.join(repo, relative);
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const fragment = select(source)
    .map((node) => node.getText(source))
    .join("\n");
  const output = ts.transpileModule(prefix + fragment + suffix, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(output, globals, { filename });
}

test("local cached icons reach notifications and automatic shortcuts", async () => {
  const outputDirectory = path.join(cacheDirectory, "consumers");
  fs.mkdirSync(outputDirectory);
  cacheDirectories.push(outputDirectory);
  const sourcePath = path.join(outputDirectory, "shared.png");
  const image = await sharp({
    create: { width: 64, height: 64, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  fs.writeFileSync(sourcePath, image);
  const logger = {
    error: () => undefined,
    warn: () => undefined,
    log: () => undefined,
  };
  let requests = 0;
  const axios = {
    async get() {
      requests += 1;
      return { data: image };
    },
  };
  const notificationIcons = load(
    "src/main/services/notifications/notification-icon.ts"
  );
  const downloadImage = runSourceFragment(
    "src/main/services/notifications/index.ts",
    (source) =>
      source.statements.filter(
        (node) =>
          (ts.isFunctionDeclaration(node) &&
            node.name?.text === "downloadImage") ||
          (ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(
              (declaration) =>
                declaration.name.getText(source) === "getStaticImage"
            ))
      ),
    "\ndownloadImage;",
    {
      fs,
      path,
      axios,
      logger,
      ...notificationIcons,
      getNotificationIconDirectory: async () => outputDirectory,
    }
  );
  const notificationPath = await downloadImage(`local:${sourcePath}`);
  assert.ok(notificationPath);
  assert.equal((await sharp(notificationPath).metadata()).format, "png");
  assert.equal(fs.existsSync(sourcePath), true);
  assert.equal(await downloadImage(`local:${sourcePath}.missing`), undefined);
  assert.equal(
    await downloadImage(`local:${sourcePath}`, { aborted: true }),
    undefined
  );
  assert.equal(requests, 0);

  let shortcutUrl = `local:${sourcePath}`;
  const Manager = runSourceFragment(
    "src/main/services/game-files-manager.ts",
    (source) =>
      source.statements
        .find(
          (node) =>
            ts.isClassDeclaration(node) &&
            node.name?.text === "GameFilesManager"
        )
        .members.filter((node) =>
          ["isValidIconUrl", "isIcoUrl", "downloadGameIcon"].includes(
            node.name?.getText(source)
          )
        ),
    "\n}\nManager;",
    {
      fs,
      path,
      axios,
      logger,
      sharp,
      Buffer,
      pngToIco: (await import("png-to-ico")).default,
      ASSETS_PATH: cacheDirectory,
      gamesSublevel: { get: async () => ({ iconUrl: null }) },
      getGameAssets: async () => ({ iconUrl: shortcutUrl }),
    },
    "class Manager {"
  );
  const manager = new Manager();
  manager.shop = "epic";
  manager.objectId = "consumer";
  manager.gameKey = "epic:consumer";
  cacheDirectories.push(path.join(cacheDirectory, "epic-consumer"));
  const shortcutPath = await manager.downloadGameIcon();
  assert.ok(shortcutPath);
  assert.deepEqual(
    [...fs.readFileSync(shortcutPath).subarray(0, 4)],
    [0, 0, 1, 0]
  );
  assert.equal(fs.existsSync(sourcePath), true);
  assert.equal(requests, 0);
  manager.objectId = "remote";
  const remoteDirectory = path.join(cacheDirectory, "epic-remote");
  cacheDirectories.push(remoteDirectory);
  shortcutUrl = "https://cdn2.steamgriddb.com/icon/native.png";
  assert.ok(await manager.downloadGameIcon());
  assert.equal(requests, 1);
});
