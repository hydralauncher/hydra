import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import axios from "axios";

import { SystemPath } from "../../system-path.ts";
import {
  __resetManifestCacheForTests,
  downloadRawManifest,
  getHydraManifestIndex,
} from "../manifest/cache.ts";

const SOURCE_URL = "https://cdn.losbroxas.org/manifest.yaml";
const RAW_MANIFEST_FILE_NAME = "cloud-save-manifest.yaml";
const INDEX_FILE_NAME = "cloud-save-manifest-index.json";
const DAY_MS = 1000 * 60 * 60 * 24;

const rawManifestYaml = `
"1687950":
  files:
    <winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata:
      tags:
        - save
      when:
        - os: windows
          store: steam
`;

const createManifestIndex = (fetchedAt: number) => ({
  version: 1 as const,
  fetchedAt,
  sourceUrl: SOURCE_URL,
  games: {
    "1687950": {
      manifestKey: "1687950",
      files: [
        {
          rawPath: "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
          tags: ["save"],
          when: [{ os: "windows", store: "steam" }],
        },
      ],
    },
  },
});

describe("cloud save manifest cache", () => {
  let tempUserDataPath: string;
  let originalGetPath: typeof SystemPath.getPath;
  let originalAxiosGet: typeof axios.get;

  beforeEach(async () => {
    tempUserDataPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-manifest-cache-")
    );

    originalGetPath = SystemPath.getPath;
    originalAxiosGet = axios.get;

    SystemPath.getPath = ((pathName: keyof typeof SystemPath.paths) => {
      if (pathName === "userData") {
        return tempUserDataPath;
      }

      return originalGetPath.call(SystemPath, pathName);
    }) as typeof SystemPath.getPath;

    __resetManifestCacheForTests();
  });

  afterEach(async () => {
    axios.get = originalAxiosGet;
    SystemPath.getPath = originalGetPath;
    __resetManifestCacheForTests();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  });

  it("downloads the raw manifest from the configured source", async () => {
    axios.get = (async (url, options) => {
      assert.equal(url, SOURCE_URL);
      assert.deepEqual(options, { responseType: "text" });
      return { data: rawManifestYaml } as Awaited<ReturnType<typeof axios.get>>;
    }) as typeof axios.get;

    const downloadedManifest = await downloadRawManifest();

    assert.equal(downloadedManifest.rawYaml, rawManifestYaml);
    assert.equal(downloadedManifest.sourceUrl, SOURCE_URL);
    assert.equal(typeof downloadedManifest.fetchedAt, "number");
  });

  it("returns the in-memory index when it is still valid", async () => {
    let requestCount = 0;
    axios.get = (async () => {
      requestCount += 1;
      return { data: rawManifestYaml } as Awaited<ReturnType<typeof axios.get>>;
    }) as typeof axios.get;

    const firstIndex = await getHydraManifestIndex();
    const secondIndex = await getHydraManifestIndex();

    assert.equal(requestCount, 1);
    assert.deepEqual(secondIndex, firstIndex);
  });

  it("returns a valid index from disk without hitting the network", async () => {
    const validIndex = createManifestIndex(Date.now());
    await fs.writeFile(
      path.join(tempUserDataPath, INDEX_FILE_NAME),
      JSON.stringify(validIndex, null, 2),
      "utf8"
    );

    axios.get = (async () => {
      throw new Error("network should not be used");
    }) as typeof axios.get;

    const manifestIndex = await getHydraManifestIndex();

    assert.deepEqual(manifestIndex, validIndex);
  });

  it("rebuilds the index from raw YAML when the JSON cache is missing", async () => {
    const rawManifestPath = path.join(tempUserDataPath, RAW_MANIFEST_FILE_NAME);
    await fs.writeFile(rawManifestPath, rawManifestYaml, "utf8");

    const recentTime = new Date();
    await fs.utimes(rawManifestPath, recentTime, recentTime);

    axios.get = (async () => {
      throw new Error("network should not be used");
    }) as typeof axios.get;

    const manifestIndex = await getHydraManifestIndex();
    const persistedIndex = JSON.parse(
      await fs.readFile(path.join(tempUserDataPath, INDEX_FILE_NAME), "utf8")
    );

    assert.equal(manifestIndex.version, 1);
    assert.equal(manifestIndex.games["1687950"]?.manifestKey, "1687950");
    assert.deepEqual(persistedIndex, manifestIndex);
  });

  it("downloads and persists the manifest when there is no local cache", async () => {
    axios.get = (async () => {
      return { data: rawManifestYaml } as Awaited<ReturnType<typeof axios.get>>;
    }) as typeof axios.get;

    const manifestIndex = await getHydraManifestIndex();
    const persistedRawManifest = await fs.readFile(
      path.join(tempUserDataPath, RAW_MANIFEST_FILE_NAME),
      "utf8"
    );
    const persistedIndex = JSON.parse(
      await fs.readFile(path.join(tempUserDataPath, INDEX_FILE_NAME), "utf8")
    );

    assert.equal(persistedRawManifest, rawManifestYaml);
    assert.deepEqual(persistedIndex, manifestIndex);
  });

  it("uses an expired local index as fallback when the network fails", async () => {
    const expiredIndex = createManifestIndex(Date.now() - DAY_MS - 1000);
    await fs.writeFile(
      path.join(tempUserDataPath, INDEX_FILE_NAME),
      JSON.stringify(expiredIndex, null, 2),
      "utf8"
    );

    axios.get = (async () => {
      throw new Error("network failed");
    }) as typeof axios.get;

    const manifestIndex = await getHydraManifestIndex();

    assert.deepEqual(manifestIndex, expiredIndex);
  });

  it("throws when there is no network and no local cache", async () => {
    axios.get = (async () => {
      throw new Error("network failed");
    }) as typeof axios.get;

    await assert.rejects(() => getHydraManifestIndex(), /network failed/);
  });
});
