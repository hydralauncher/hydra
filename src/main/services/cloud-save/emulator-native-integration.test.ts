import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const addonPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../hydra-native/hydra-native.node"
);
const require = createRequire(import.meta.url);

describe("emulator Cloud Save V2 native contract", () => {
  for (const scenario of [
    {
      name: "RPCS3 slot",
      rawPath: "<emulator>/rpcs3/BLUS30443/00000001",
      relativePath: "BLUS30443-SLOT01/DATA.BIN",
      localFile: "host-a/00000001/savedata/BLUS30443-SLOT01/DATA.BIN",
      restoreRoot: "host-b/00000002/savedata",
      target: "host-b/00000002/savedata/BLUS30443-SLOT01/DATA.BIN",
      ruleKind: "dir",
    },
    {
      name: "renamed RetroArch ROM",
      rawPath: "<emulator>/retroarch/gba/1234ABCD",
      relativePath: "battery.srm",
      localFile: "host-a/Metroid.srm",
      restoreRoot: "host-b/Renamed Metroid.srm",
      target: "host-b/Renamed Metroid.srm",
      ruleKind: "file",
    },
  ]) {
    it(
      `builds and maps a ${scenario.name} across hosts`,
      { skip: !existsSync(addonPath) && "native addon is not built" },
      async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), "hydra-emulator-v2-"));
        try {
          const native = require(addonPath);
          const source = path.join(root, scenario.localFile);
          const preferredPath = path.join(root, scenario.restoreRoot);
          mkdirSync(path.dirname(source), { recursive: true });
          mkdirSync(path.dirname(preferredPath), { recursive: true });
          writeFileSync(source, "save");
          const variantId = createHash("sha256")
            .update(
              JSON.stringify({
                variantIdVersion: 1,
                shop: "launchbox",
                objectId: "game",
                kind: "default",
              })
            )
            .digest("hex");
          const snapshot = await native.buildLocalGameSnapshot({
            gameId: { shop: "launchbox", objectId: "game" },
            ruleSourceRevision: "emulator-v1",
            discoveryEngineVersion: 4,
            coverage: [],
            variants: [{ variantId, kind: "default" }],
            files: [
              {
                variantId,
                ruleId: "rule",
                rawPath: scenario.rawPath,
                absolutePath: source,
                relativePath: scenario.relativePath,
                localBindings: {
                  environmentId: "host-a",
                  rootId: "root",
                  concreteUserSegment: "__default__",
                  concretePath: path.dirname(source),
                },
                confidence: "exact",
                provenance: ["emulator:test"],
              },
            ],
            hashCache: [],
          });
          const restore = await native.resolveRestoreTargets({
            shop: "launchbox",
            objectId: "game",
            platform: "mac",
            homeDir: root,
            approvedRules: [
              {
                kind: scenario.ruleKind,
                rawPath: scenario.rawPath,
                source: "emulator",
                preferredPath,
                when: [],
              },
            ],
            variants: snapshot.variants,
            files: snapshot.files,
          });

          assert.equal(snapshot.files.length, 1);
          assert.equal(snapshot.variants.length, 1);
          assert.deepEqual(restore.blocked, []);
          assert.deepEqual(restore.deferred, []);
          assert.equal(restore.actions.length, 1);
          assert.equal(
            restore.actions[0].targetPath,
            path.join(root, scenario.target)
          );
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    );
  }
});
