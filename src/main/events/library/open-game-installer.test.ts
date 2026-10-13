import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { loadTestModule } from "../../../../scripts/test/load-module.mjs";

for (const platform of ["darwin", "win32", "linux"]) {
  for (const file of [true, false]) {
    it(`Open folder on ${platform} reveals a file or opens its directory (${file})`, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-open-output-"));
      const target = path.join(root, file ? "archive.zip" : "folder");
      if (file) fs.writeFileSync(target, "fixture");
      else fs.mkdirSync(target);
      const revealed: string[] = [];
      const opened: string[] = [];
      let handler: (
        _event: unknown,
        shop: string,
        id: string
      ) => Promise<boolean>;
      const dependencies: Record<string, unknown> = {
        "node:fs": fs,
        "node:path": path,
        "node:child_process": {},
        electron: {
          shell: {
            showItemInFolder: (value: string) => revealed.push(value),
            openPath: async (value: string) => {
              opened.push(value);
              return "";
            },
          },
        },
        "../helpers/get-downloads-path": { getDownloadsPath: async () => root },
        "../register-event": {
          registerEvent: (_name: string, callback: typeof handler) => {
            handler = callback;
          },
        },
        "@main/level": {
          levelKeys: { game: () => "fixture" },
          downloadsSublevel: {
            get: async () => ({
              folderName: path.basename(target),
              downloadPath: root,
            }),
          },
          gamesSublevel: { get: async () => null },
        },
        "@main/services": { Wine: { getEffectivePrefixPath: () => undefined } },
      };
      try {
        loadTestModule(
          new URL("./open-game-installer.ts", import.meta.url),
          (id: string) => dependencies[id],
          { process: { platform } }
        );
        assert.equal(await handler!(null, "steam", "fixture"), true);
        assert.deepEqual(revealed, file ? [target] : []);
        assert.deepEqual(opened, file ? [] : [target]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
