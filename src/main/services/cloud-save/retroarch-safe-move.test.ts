import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  copyRetroArchFileVerified,
  hashRetroArchFile,
  moveRetroArchFileVerified,
  replaceRetroArchBatteryFilesSafely,
} from "./retroarch-safe-move.js";

describe("RetroArch save materialization", () => {
  it("keeps the source intact if the destination contains different data", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "retroarch-move-"));
    try {
      const source = path.join(root, "Mario_USA.state1");
      const target = path.join(root, "Mario_EUROPE.state1");
      await fs.writeFile(source, "original state");
      await fs.writeFile(target, "different state");
      await assert.rejects(
        moveRetroArchFileVerified(source, target),
        /cloud_save_retroarch_target_occupied/
      );
      assert.equal(await fs.readFile(source, "utf8"), "original state");
      assert.equal(await fs.readFile(target, "utf8"), "different state");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("retries a completed copy and removes source only after verification", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "retroarch-move-"));
    try {
      const source = path.join(root, "Mario_USA.state1");
      const target = path.join(root, "states", "Mario_EUROPE.state4");
      await fs.writeFile(source, "saved state");
      await copyRetroArchFileVerified(source, target);
      assert.equal(await fs.readFile(source, "utf8"), "saved state");
      await moveRetroArchFileVerified(source, target);
      await assert.rejects(fs.lstat(source), { code: "ENOENT" });
      assert.equal(await fs.readFile(target, "utf8"), "saved state");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

const createBatteryFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retroarch-battery-"));
  const sources = [
    path.join(root, "chosen", "Mario_USA.srm"),
    path.join(root, "chosen", "Mario_USA.rtc"),
  ];
  const targets = [
    path.join(root, "active", "Mario_EUROPE.srm"),
    path.join(root, "active", "Mario_EUROPE.rtc"),
  ];
  const chosenContents = ["chosen battery", "chosen clock"];
  const oldContents = ["old battery", "old clock"];
  await fs.mkdir(path.dirname(sources[0]), { recursive: true });
  await fs.mkdir(path.dirname(targets[0]), { recursive: true });
  await Promise.all([
    ...sources.map((source, index) =>
      fs.writeFile(source, chosenContents[index])
    ),
    ...targets.map((target, index) => fs.writeFile(target, oldContents[index])),
  ]);
  const replacements = await Promise.all(
    sources.map(async (source, index) => ({
      source,
      target: targets[index],
      hash: await hashRetroArchFile(source),
    }))
  );
  const archiveFiles = await Promise.all(
    targets.map(async (filePath) => ({
      path: filePath,
      hash: await hashRetroArchFile(filePath),
    }))
  );
  return {
    root,
    sources,
    targets,
    chosenContents,
    oldContents,
    options: {
      replacements,
      archiveFiles,
      activePathsToClear: targets,
      archiveRoot: path.join(root, "archive"),
      commit: async () => undefined,
    },
  };
};

const assertContents = async (filePaths: string[], contents: string[]) => {
  for (const [index, filePath] of filePaths.entries()) {
    assert.equal(await fs.readFile(filePath, "utf8"), contents[index]);
  }
};

const readArchivedContents = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map((entry) => {
      const filePath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? readArchivedContents(filePath)
        : fs.readFile(filePath, "utf8").then((content) => [content]);
    })
  );
  return contents.flat();
};

describe("RetroArch battery replacement transaction", () => {
  it("restores the whole old set when the second selected file cannot be installed", async (t) => {
    const fixture = await createBatteryFixture();
    let commitCount = 0;
    let failed = false;
    const originalOpen = fs.open.bind(fs);
    t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === fixture.targets[1] && args[1] === "wx" && !failed) {
        failed = true;
        assert.equal(
          await fs.readFile(fixture.targets[0], "utf8"),
          fixture.chosenContents[0]
        );
        await assertContents(fixture.sources, fixture.chosenContents);
        throw new Error("second install failed");
      }
      return originalOpen(...args);
    });
    try {
      await assert.rejects(
        replaceRetroArchBatteryFilesSafely({
          ...fixture.options,
          commit: async () => {
            commitCount += 1;
          },
        }),
        /second install failed/
      );
      assert.equal(failed, true);
      assert.equal(commitCount, 0);
      await assertContents(fixture.targets, fixture.oldContents);
      await assertContents(fixture.sources, fixture.chosenContents);
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  for (const phase of ["staging", "backup"] as const) {
    it(`keeps current and chosen files intact when ${phase} fails`, async (t) => {
      const fixture = await createBatteryFixture();
      const failingSource =
        phase === "staging" ? fixture.sources[1] : fixture.targets[1];
      let failed = false;
      let commitCount = 0;
      const originalCopyFile = fs.copyFile.bind(fs);
      t.mock.method(
        fs,
        "copyFile",
        async (...args: Parameters<typeof fs.copyFile>) => {
          if (args[0] === failingSource) {
            failed = true;
            await assertContents(fixture.targets, fixture.oldContents);
            await assertContents(fixture.sources, fixture.chosenContents);
            throw new Error(`${phase} failed`);
          }
          return originalCopyFile(...args);
        }
      );
      try {
        await assert.rejects(
          replaceRetroArchBatteryFilesSafely({
            ...fixture.options,
            commit: async () => {
              commitCount += 1;
            },
          }),
          new RegExp(`${phase} failed`)
        );
        assert.equal(failed, true);
        assert.equal(commitCount, 0);
        await assertContents(fixture.targets, fixture.oldContents);
        await assertContents(fixture.sources, fixture.chosenContents);
      } finally {
        await fs.rm(fixture.root, { recursive: true, force: true });
      }
    });
  }

  it("restores old files and retains the chosen set when metadata commit fails", async () => {
    const fixture = await createBatteryFixture();
    let commitCount = 0;
    try {
      await assert.rejects(
        replaceRetroArchBatteryFilesSafely({
          ...fixture.options,
          commit: async () => {
            commitCount += 1;
            await assertContents(fixture.targets, fixture.chosenContents);
            await assertContents(fixture.sources, fixture.chosenContents);
            throw new Error("commit failed");
          },
        }),
        /commit failed/
      );
      assert.equal(commitCount, 1);
      await assertContents(fixture.targets, fixture.oldContents);
      await assertContents(fixture.sources, fixture.chosenContents);
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("keeps a selected file whose source already equals its final target", async () => {
    const fixture = await createBatteryFixture();
    let commitCount = 0;
    try {
      const result = await replaceRetroArchBatteryFilesSafely({
        replacements: [
          {
            source: fixture.targets[0],
            target: fixture.targets[0],
            hash: fixture.options.archiveFiles[0].hash,
          },
        ],
        archiveFiles: [],
        activePathsToClear: [],
        archiveRoot: fixture.options.archiveRoot,
        commit: async () => {
          commitCount += 1;
        },
      });
      assert.equal(commitCount, 1);
      assert.deepEqual(result.cleanupFailures, []);
      await assertContents(fixture.targets, fixture.oldContents);
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("never cleans up a source that is another replacement's final target", async () => {
    const fixture = await createBatteryFixture();
    try {
      const result = await replaceRetroArchBatteryFilesSafely({
        ...fixture.options,
        replacements: [
          {
            source: fixture.targets[0],
            target: fixture.targets[1],
            hash: fixture.options.archiveFiles[0].hash,
          },
          {
            source: fixture.targets[1],
            target: fixture.targets[0],
            hash: fixture.options.archiveFiles[1].hash,
          },
        ],
      });
      assert.deepEqual(result.cleanupFailures, []);
      await assertContents(fixture.targets, [...fixture.oldContents].reverse());
      const archived = await readArchivedContents(fixture.options.archiveRoot);
      for (const content of fixture.oldContents) {
        assert.ok(archived.includes(content));
      }
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("archives and clears an active clock file absent from the selected set", async () => {
    const fixture = await createBatteryFixture();
    let commitCount = 0;
    try {
      const result = await replaceRetroArchBatteryFilesSafely({
        ...fixture.options,
        replacements: [fixture.options.replacements[0]],
        commit: async () => {
          commitCount += 1;
          assert.equal(
            await fs.readFile(fixture.targets[0], "utf8"),
            fixture.chosenContents[0]
          );
          await assert.rejects(fs.lstat(fixture.targets[1]), {
            code: "ENOENT",
          });
          await assertContents(fixture.sources, fixture.chosenContents);
        },
      });
      assert.equal(commitCount, 1);
      assert.deepEqual(result.cleanupFailures, []);
      await assert.rejects(fs.lstat(fixture.sources[0]), { code: "ENOENT" });
      await assert.rejects(fs.lstat(fixture.targets[1]), { code: "ENOENT" });
      assert.equal(
        await fs.readFile(fixture.targets[0], "utf8"),
        fixture.chosenContents[0]
      );
      assert.equal(
        await fs.readFile(fixture.sources[1], "utf8"),
        fixture.chosenContents[1]
      );
      const archived = await readArchivedContents(fixture.options.archiveRoot);
      for (const content of fixture.oldContents) {
        assert.ok(archived.includes(content));
      }
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("restores an active-only clock file when metadata commit fails", async () => {
    const fixture = await createBatteryFixture();
    try {
      await assert.rejects(
        replaceRetroArchBatteryFilesSafely({
          ...fixture.options,
          replacements: [fixture.options.replacements[0]],
          commit: async () => {
            await assert.rejects(fs.lstat(fixture.targets[1]), {
              code: "ENOENT",
            });
            throw new Error("commit failed");
          },
        }),
        /commit failed/
      );
      await assertContents(fixture.targets, fixture.oldContents);
      await assertContents(fixture.sources, fixture.chosenContents);
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  for (const kind of ["selected", "old"] as const) {
    it(`rejects a stale expected hash for ${kind} files before changing data`, async () => {
      const fixture = await createBatteryFixture();
      let commitCount = 0;
      try {
        const options = {
          ...fixture.options,
          commit: async () => {
            commitCount += 1;
          },
        };
        if (kind === "selected") {
          options.replacements[1].hash = "0".repeat(64);
        } else {
          options.archiveFiles[1].hash = "0".repeat(64);
        }
        await assert.rejects(replaceRetroArchBatteryFilesSafely(options));
        assert.equal(commitCount, 0);
        await assertContents(fixture.targets, fixture.oldContents);
        await assertContents(fixture.sources, fixture.chosenContents);
      } finally {
        await fs.rm(fixture.root, { recursive: true, force: true });
      }
    });
  }

  for (const kind of ["selected", "old"] as const) {
    it(`rejects a symlink in ${kind} files without modifying its referent`, async () => {
      const fixture = await createBatteryFixture();
      const link =
        kind === "selected" ? fixture.sources[1] : fixture.targets[1];
      const content =
        kind === "selected"
          ? fixture.chosenContents[1]
          : fixture.oldContents[1];
      const referent = path.join(fixture.root, "outside.rtc");
      let commitCount = 0;
      try {
        await fs.writeFile(referent, content);
        await fs.unlink(link);
        await fs.symlink(referent, link);
        await assert.rejects(
          replaceRetroArchBatteryFilesSafely({
            ...fixture.options,
            commit: async () => {
              commitCount += 1;
            },
          })
        );
        assert.equal(commitCount, 0);
        assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
        assert.equal(await fs.readFile(referent, "utf8"), content);
        await assertContents(fixture.targets, fixture.oldContents);
        await assertContents(fixture.sources, fixture.chosenContents);
      } finally {
        await fs.rm(fixture.root, { recursive: true, force: true });
      }
    });
  }

  it("retains durable backups and staging when rollback also fails", async (t) => {
    const fixture = await createBatteryFixture();
    let installFailed = false;
    let rollbackFailed = false;
    const originalOpen = fs.open.bind(fs);
    t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[1] === "wx") {
        if (args[0] === fixture.targets[1] && !installFailed) {
          installFailed = true;
          throw new Error("second install failed");
        }
      }
      return originalOpen(...args);
    });
    const originalCopyFile = fs.copyFile.bind(fs);
    t.mock.method(
      fs,
      "copyFile",
      async (...args: Parameters<typeof fs.copyFile>) => {
        if (args[1] === fixture.targets[0] && installFailed) {
          rollbackFailed = true;
          throw new Error("rollback failed");
        }
        return originalCopyFile(...args);
      }
    );
    try {
      await assert.rejects(replaceRetroArchBatteryFilesSafely(fixture.options));
      assert.equal(installFailed, true);
      assert.equal(rollbackFailed, true);
      await assertContents(fixture.sources, fixture.chosenContents);
      const retained = await readArchivedContents(fixture.options.archiveRoot);
      for (const content of [
        ...fixture.oldContents,
        ...fixture.chosenContents,
      ]) {
        assert.ok(
          retained.includes(content),
          `missing retained data: ${content}`
        );
      }
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("reports source cleanup failure after commit without rolling active files back", async (t) => {
    const fixture = await createBatteryFixture();
    const cleanupError = new Error("source cleanup failed");
    let commitCount = 0;
    const originalUnlink = fs.unlink.bind(fs);
    t.mock.method(
      fs,
      "unlink",
      async (...args: Parameters<typeof fs.unlink>) => {
        if (args[0] === fixture.sources[0]) throw cleanupError;
        return originalUnlink(...args);
      }
    );
    try {
      const result = await replaceRetroArchBatteryFilesSafely({
        ...fixture.options,
        commit: async () => {
          commitCount += 1;
          await assertContents(fixture.targets, fixture.chosenContents);
          await assertContents(fixture.sources, fixture.chosenContents);
        },
      });
      assert.equal(commitCount, 1);
      assert.deepEqual(result.cleanupFailures, [
        { path: fixture.sources[0], error: cleanupError },
      ]);
      await assertContents(fixture.targets, fixture.chosenContents);
      assert.equal(
        await fs.readFile(fixture.sources[0], "utf8"),
        fixture.chosenContents[0]
      );
      await assert.rejects(fs.lstat(fixture.sources[1]), { code: "ENOENT" });
      const archived = await readArchivedContents(fixture.options.archiveRoot);
      for (const content of fixture.oldContents) {
        assert.ok(archived.includes(content));
      }
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });
});
