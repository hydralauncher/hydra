import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { describe, it } from "node:test";

import type {
  LocalGameSnapshotContext,
  LocalGameSnapshotSourceFile,
  PrepareSnapshotFile,
  PrepareSnapshotRequest,
  PrepareSnapshotResponse,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

const objectId = "namespace:playableItemId";
const rawPath = "<winLocalAppData>/FactoryGame/Saved/SaveGames/<storeUserId>";
const folders = ["account-alpha", "account-beta"] as const;
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const variants: SnapshotVariant[] = folders.map((folder) => ({
  variantId: sha256(folder),
  kind: "opaque-folder",
  concreteFolderId: folder,
}));
const sourcePath = (folder: string) =>
  `C:/Users/Hydra/AppData/Local/FactoryGame/Saved/SaveGames/${folder}/FactorySave.sav`;

const snapshotFile = (variantId: string, bytes: Buffer): SnapshotFile => ({
  variantId,
  rawPath,
  relativePath: "FactorySave.sav",
  hash: sha256(bytes),
  sizeBytes: bytes.length,
  lastModifiedAt: "2026-09-29T00:00:00.000Z",
});

const sourceFile = (
  file: SnapshotFile,
  folder: string
): LocalGameSnapshotSourceFile => ({
  ...file,
  ruleId: "satisfactory-savegames",
  absolutePath: sourcePath(folder),
  localBindings: {
    environmentId: "epic-windows-test",
    rootId: "local-app-data",
    concreteUserSegment: folder,
    concretePath: sourcePath(folder),
  },
  confidence: "authoritative",
  provenance: ["test"],
});

const context = (
  files: SnapshotFile[],
  aggregateHash: string
): LocalGameSnapshotContext => ({
  gameId: { shop: "epic", objectId },
  manifestKey: "Satisfactory",
  ruleSourceRevision: "test-revision",
  discoveryEngineVersion: 3,
  coverage: [],
  variants,
  fileCount: files.length,
  totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
  files,
  aggregateHash,
  sourceFiles: files.map((file, index) => sourceFile(file, folders[index])),
  environmentId: "epic-windows-test",
  pathContext: {
    shop: "epic",
    objectId,
    platform: "windows",
    homeDir: "C:/Users/Hydra",
    storeUserContext: { known: [] },
  },
  customPathRawPaths: [],
});

const uploadResponseFile = (
  file: SnapshotFile,
  version: string
): PrepareSnapshotFile => ({
  variantId: file.variantId,
  rawPath: file.rawPath,
  relativePath: file.relativePath,
  status: "upload",
  uploadUrl: `https://upload.invalid/${version}/${file.variantId}`,
  requiredHeaders: {
    "Content-Length": String(file.sizeBytes),
    "x-amz-checksum-sha256": Buffer.from(file.hash, "hex").toString("base64"),
  },
});

const skipResponseFile = (file: SnapshotFile): PrepareSnapshotFile => ({
  variantId: file.variantId,
  rawPath: file.rawPath,
  relativePath: file.relativePath,
  status: "skip",
});

const prepareCalls: Array<{
  path: string;
  body: PrepareSnapshotRequest;
  options: unknown;
}> = [];
const uploadCalls: Array<[string, string, string, string]> = [];
const prepareResponses: PrepareSnapshotResponse[] = [];

const boundary = {
  post: async (
    path: string,
    body: PrepareSnapshotRequest,
    options: unknown
  ) => {
    prepareCalls.push({ path, body, options });
    const response = prepareResponses.shift();
    assert.ok(response, "unexpected prepare request");
    return response;
  },
  upload: async (
    absolutePath: string,
    uploadUrl: string,
    contentLength: string,
    checksum: string
  ) => {
    uploadCalls.push([absolutePath, uploadUrl, contentLength, checksum]);
  },
};

(
  globalThis as typeof globalThis & {
    __epicCloudSaveUploadTestBoundary: typeof boundary;
  }
).__epicCloudSaveUploadTestBoundary = boundary;

// The regular Node test loader does not resolve the launcher's runtime aliases.
// Replace only the three external boundaries used by this service.
const virtualModules: Record<string, string> = {
  "@main/services/hydra-api":
    "export class HydraApi { static post(...args) { return globalThis.__epicCloudSaveUploadTestBoundary.post(...args); } }",
  "../native-addon":
    "export class NativeAddon { static uploadLocalSaveBlob(...args) { return globalThis.__epicCloudSaveUploadTestBoundary.upload(...args); } }",
  "./build-local-game-snapshot":
    "export const buildLocalGameSnapshotContext = () => { throw new Error('unexpected snapshot discovery'); };",
};
const loaderSource = `
const modules = ${JSON.stringify(virtualModules)};
export async function resolve(specifier, context, nextResolve) {
  const fromTarget = context.parentURL?.endsWith("/upload-local-game-snapshot.ts");
  if (specifier === "@main/services/hydra-api" ||
      (fromTarget && (specifier === "../native-addon" ||
                      specifier === "./build-local-game-snapshot"))) {
    return {
      url: "data:text/javascript," + encodeURIComponent(modules[specifier]),
      shortCircuit: true,
    };
  }
  if (fromTarget && specifier.startsWith("./") && !specifier.includes(".js")) {
    return nextResolve(new URL(specifier + ".ts", context.parentURL).href, context);
  }
  return nextResolve(specifier, context);
}
`;
register(
  `data:text/javascript,${encodeURIComponent(loaderSource)}`,
  import.meta.url
);

// @ts-ignore The Node ESM test runner requires the source extension.
const { uploadLocalGameSnapshot } = await import(
  "./upload-local-game-snapshot.ts"
);

describe("Epic local snapshot upload", () => {
  it("uploads two account folders, then uploads only the changed save", async () => {
    prepareCalls.length = 0;
    uploadCalls.length = 0;
    prepareResponses.length = 0;

    const firstFiles = [
      snapshotFile(variants[0].variantId, Buffer.from("alpha-save-v1")),
      snapshotFile(variants[1].variantId, Buffer.from("beta-save-v1")),
    ];
    const secondFiles = [
      snapshotFile(variants[0].variantId, Buffer.from("alpha-save-v2")),
      firstFiles[1],
    ];
    const firstContext = context(firstFiles, sha256("first-snapshot"));
    const secondContext = context(secondFiles, sha256("second-snapshot"));
    prepareResponses.push(
      {
        pendingSnapshotId: "pending-first",
        snapshotHash: firstContext.aggregateHash,
        files: firstFiles.map((file) => uploadResponseFile(file, "first")),
      },
      {
        pendingSnapshotId: "pending-second",
        snapshotHash: secondContext.aggregateHash,
        files: [
          uploadResponseFile(secondFiles[0], "second"),
          skipResponseFile(secondFiles[1]),
        ],
      }
    );

    const firstResult = await uploadLocalGameSnapshot(
      objectId,
      "epic",
      undefined,
      firstContext,
      { baseVersion: 0 }
    );
    assert.deepEqual(firstResult, {
      pendingSnapshotId: "pending-first",
      uploadedFiles: 2,
      skippedFiles: 0,
    });
    assert.equal(uploadCalls.length, 2);
    assert.deepEqual(
      uploadCalls
        .slice(0, 2)
        .sort(([left], [right]) => left.localeCompare(right)),
      firstFiles
        .map(
          (file, index) =>
            [
              sourcePath(folders[index]),
              `https://upload.invalid/first/${file.variantId}`,
              String(file.sizeBytes),
              Buffer.from(file.hash, "hex").toString("base64"),
            ] as [string, string, string, string]
        )
        .sort(([left], [right]) => left.localeCompare(right))
    );

    const secondResult = await uploadLocalGameSnapshot(
      objectId,
      "epic",
      undefined,
      secondContext,
      { baseVersion: 1 }
    );
    assert.deepEqual(secondResult, {
      pendingSnapshotId: "pending-second",
      uploadedFiles: 1,
      skippedFiles: 1,
    });
    assert.equal(uploadCalls.length, 3);
    assert.deepEqual(uploadCalls[2], [
      sourcePath(folders[0]),
      `https://upload.invalid/second/${secondFiles[0].variantId}`,
      String(secondFiles[0].sizeBytes),
      Buffer.from(secondFiles[0].hash, "hex").toString("base64"),
    ]);

    assert.equal(prepareCalls.length, 2);
    for (const [index, call] of prepareCalls.entries()) {
      assert.equal(call.path, "/profile/cloud-saves/prepare-snapshot");
      assert.deepEqual(call.options, {
        needsAuth: true,
        needsSubscription: true,
      });
      assert.equal(call.body.shop, "epic");
      assert.equal(call.body.objectId, objectId);
      assert.equal(call.body.baseVersion, index);
      assert.deepEqual(call.body.variants, variants);
      assert.deepEqual(call.body.files, index === 0 ? firstFiles : secondFiles);
    }
    assert.notEqual(firstFiles[0].hash, secondFiles[0].hash);
    assert.equal(firstFiles[1].hash, secondFiles[1].hash);
  });
});
