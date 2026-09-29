import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deleteLegacyArchiveEntry } from "./legacy-save-actions.js";

describe("legacy archive deletion", () => {
  it("deletes separate API backups and reloads the emulator archive", async () => {
    const calls: string[] = [];
    await deleteLegacyArchiveEntry("emulation-save", "emulation-1", {
      deleteGameArtifact: async (id) => {
        calls.push(`artifact:${id}`);
      },
      deleteEmulationSave: async (id) => {
        calls.push(`emulation:${id}`);
      },
      refreshEmulationSaves: async () => {
        calls.push("refresh");
      },
    });
    assert.deepEqual(calls, ["emulation:emulation-1", "refresh"]);
  });

  it("retains Steam and old game artifact deletion behavior", async () => {
    const calls: string[] = [];
    await deleteLegacyArchiveEntry("game-artifact", "steam-1", {
      deleteGameArtifact: async (id) => {
        calls.push(`artifact:${id}`);
      },
      deleteEmulationSave: async (id) => {
        calls.push(`emulation:${id}`);
      },
      refreshEmulationSaves: async () => {
        calls.push("refresh");
      },
    });
    assert.deepEqual(calls, ["artifact:steam-1"]);
  });
});
