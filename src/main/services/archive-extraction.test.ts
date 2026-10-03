import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";
import {
  ArchiveExtractionQueue,
  buildExtractionArgs,
  extractArchive,
  getExtractionThreadCount,
  getExtractionConcurrency,
  getExtractionScheduling,
  getExtractionSpawnOptions,
  type ExtractionProgress,
} from "./archive-extraction.js";

const execFileAsync = promisify(execFile);
const binaryNames = { darwin: "7zz", linux: "7zzs", win32: "7z.exe" };
const binaryPath = path.resolve("binaries", binaryNames[process.platform]);

it("reserves CPU capacity and caps extraction at eight threads", () => {
  for (const [available, expected] of [
    [1, 1],
    [2, 1],
    [4, 2],
    [8, 4],
    [16, 8],
    [32, 8],
    [128, 8],
  ]) {
    assert.equal(getExtractionThreadCount(available), expected);
  }
});

it("uses detached console launch only on Windows and retains piped output", () => {
  for (const platform of ["win32", "linux", "darwin"] as const) {
    assert.deepEqual(getExtractionSpawnOptions("destination", platform), {
      cwd: "destination",
      detached: platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
});

it("uses quiet extraction without file tracking and disables unused progress", () => {
  const args = buildExtractionArgs("-game [1].zip", "", false, false, 4);
  assert.ok(args.includes("-bb0"));
  assert.ok(args.includes("-bsp0"));
  assert.ok(args.includes("-mmt=4"));
  assert.ok(args.includes("-p-"));
  assert.ok(args.includes("-spd"));
  assert.deepEqual(args.slice(-2), ["--", "-game [1].zip"]);

  const tracked = buildExtractionArgs("game.zip", "password", true, true, 2);
  assert.ok(tracked.includes("-bb1"));
  assert.ok(tracked.includes("-bsp1"));
  assert.ok(tracked.includes("-ppassword"));
});

it("serializes full-budget jobs in FIFO order and continues after failure", async () => {
  const queue = new ArchiveExtractionQueue(4, 2);
  const events: string[] = [];
  let finishFirst!: () => void;
  const first = queue.run(async () => {
    events.push("first-start");
    await new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    events.push("first-end");
    return 1;
  });
  const second = queue.run(async () => {
    events.push("second");
    throw new Error("failed archive");
  });
  const rejected = assert.rejects(second, /failed archive/);
  const third = queue.run(async () => {
    events.push("third");
    return 3;
  });
  await Promise.resolve();
  assert.deepEqual(events, ["first-start"]);
  finishFirst();
  assert.equal(await first, 1);
  await rejected;
  assert.equal(await third, 3);
  assert.deepEqual(events, ["first-start", "first-end", "second", "third"]);
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve() };
};

it("uses a one-thread ZIP fast lane while retaining below-normal priority", () => {
  assert.deepEqual(getExtractionScheduling("Game.ZIP", 16), {
    threads: 1,
    priority: "below-normal",
  });
  assert.deepEqual(getExtractionScheduling("Game.zip", 4), {
    threads: 1,
    priority: "below-normal",
  });
  assert.deepEqual(getExtractionScheduling("Game.zip", 2), {
    threads: 1,
    priority: "below-normal",
  });
  assert.deepEqual(getExtractionScheduling("Game.7z", 16), {
    threads: 8,
    priority: "below-normal",
  });
  assert.deepEqual(getExtractionScheduling("Game.rar", 4), {
    threads: 2,
    priority: "below-normal",
  });
  for (const [threads, expected] of [
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 2],
    [8, 2],
    [16, 2],
  ]) {
    assert.equal(getExtractionConcurrency(threads), expected);
  }
});

it("admits two independent ZIP-sized jobs but never an unbounded batch", async () => {
  const queue = new ArchiveExtractionQueue(4, 2);
  const gates = Array.from({ length: 4 }, deferred);
  const started: number[] = [];
  let active = 0;
  let peak = 0;
  const jobs = gates.map((gate, index) =>
    queue.run(
      async () => {
        started.push(index);
        active++;
        peak = Math.max(peak, active);
        await gate.promise;
        active--;
        return index;
      },
      {
        threads: 1,
        destination: path.join(os.tmpdir(), `queue-output-${index}`),
      }
    )
  );
  await Promise.resolve();
  assert.deepEqual(started, [0, 1]);
  gates[0].resolve();
  assert.equal(await jobs[0], 0);
  assert.deepEqual(started, [0, 1, 2]);
  for (const gate of gates) gate.resolve();
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3]);
  assert.equal(peak, 2);
});

it("enforces the shared decoder budget and does not starve CPU-heavy jobs", async () => {
  const queue = new ArchiveExtractionQueue(4, 2);
  const heavyGate = deferred();
  const lightGate = deferred();
  const events: string[] = [];
  const first = queue.run(
    async () => {
      events.push("heavy-1");
      await heavyGate.promise;
    },
    { threads: 4 }
  );
  const second = queue.run(
    async () => {
      events.push("zip-1");
      await lightGate.promise;
    },
    { threads: 1 }
  );
  const third = queue.run(
    async () => {
      events.push("heavy-2");
    },
    { threads: 4 }
  );
  const fourth = queue.run(
    async () => {
      events.push("zip-2");
    },
    { threads: 1 }
  );
  await Promise.resolve();
  assert.deepEqual(events, ["heavy-1"]);
  heavyGate.resolve();
  await first;
  // The later ZIP must not bypass the waiting heavy job, even with a free slot.
  assert.deepEqual(events, ["heavy-1", "zip-1"]);
  lightGate.resolve();
  await Promise.all([second, third, fourth]);
  assert.deepEqual(events, ["heavy-1", "zip-1", "heavy-2", "zip-2"]);
});

it("serializes identical, nested and case-aliased output directories", async () => {
  const parent = path.join(os.tmpdir(), "queue-game");
  const nested = path.join(parent, "nested");
  const destinations = [
    [parent, parent],
    [parent, nested],
    [nested, parent],
  ];
  if (process.platform === "win32" || process.platform === "darwin") {
    destinations.push([parent, parent.toUpperCase()]);
  }
  for (const [firstDestination, secondDestination] of destinations) {
    const queue = new ArchiveExtractionQueue(4, 2);
    const gate = deferred();
    const started: string[] = [];
    const first = queue.run(
      async () => {
        started.push("first");
        await gate.promise;
      },
      { threads: 1, destination: firstDestination }
    );
    const second = queue.run(
      async () => {
        started.push("second");
      },
      { threads: 1, destination: secondDestination }
    );
    await Promise.resolve();
    assert.deepEqual(started, ["first"]);
    gate.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(started, ["first", "second"]);
  }
});

it("does not confuse sibling destination prefixes with nested directories", async () => {
  const queue = new ArchiveExtractionQueue(4, 2);
  const gate = deferred();
  const started: number[] = [];
  const jobs = ["game", "game-other"].map((name, index) =>
    queue.run(
      async () => {
        started.push(index);
        await gate.promise;
      },
      { threads: 1, destination: path.join(os.tmpdir(), name) }
    )
  );
  await Promise.resolve();
  assert.deepEqual(started, [0, 1]);
  gate.resolve();
  await Promise.all(jobs);
});

it("releases parallel reservations after synchronous failures", async () => {
  const queue = new ArchiveExtractionQueue(4, 2);
  const failed = queue.run(
    () => {
      throw new Error("start failed");
    },
    { threads: 1 }
  );
  const rejected = assert.rejects(failed, /start failed/);
  const completed = queue.run(async () => 42, { threads: 4 });
  await rejected;
  assert.equal(await completed, 42);
  assert.throws(() => new ArchiveExtractionQueue(0, 2), RangeError);
  assert.throws(() => new ArchiveExtractionQueue(4, 0), RangeError);
  for (const threads of [0, -1, 1.5, 5, NaN]) {
    await assert.rejects(
      queue.run(async () => 1, { threads }),
      RangeError
    );
  }
});

for (const format of ["zip", "7z", "tar"]) {
  it(
    `extracts a real ${format} archive with quiet progress and optional file tracking`,
    { skip: !existsSync(binaryPath) },
    async (t) => {
      const priorities: number[] = [];
      const originalSetPriority = os.setPriority;
      t.mock.method(os, "setPriority", (pid: number, priority: number) => {
        priorities.push(priority);
        originalSetPriority(pid, priority);
      });
      const root = await mkdtemp(path.join(os.tmpdir(), "hydra-extraction-"));
      try {
        const input = path.join(root, "input");
        await mkdir(path.join(input, "nested"), { recursive: true });
        const payload = Buffer.from("Hydra extraction fixture");
        const names = ["nested/Game [USA] é.txt", "@game.txt", "-game.txt"];
        for (const name of names)
          await writeFile(path.join(input, name), payload);
        const archive = path.join(root, `game.${format}`);
        await execFileAsync(binaryPath, ["a", `-t${format}`, archive, "."], {
          cwd: input,
          windowsHide: true,
        });
        const progress: ExtractionProgress[] = [];
        const quietOutput = path.join(root, "quiet");
        const quiet = await extractArchive(
          binaryPath,
          {
            filePath: path.relative(process.cwd(), archive),
            outputPath: quietOutput,
            collectExtractedFiles: false,
          },
          (value) => progress.push(value)
        );
        assert.deepEqual(quiet, { success: true, extractedFiles: [] });
        assert.equal(progress.at(-1)?.percent, 100);
        assert.ok(
          progress.every((value) => value.percent >= 0 && value.percent <= 100)
        );
        for (const name of names) {
          assert.deepEqual(
            await readFile(path.join(quietOutput, name)),
            payload
          );
        }

        const trackedOutput = path.join(root, "tracked");
        const tracked = await extractArchive(binaryPath, {
          filePath: archive,
          cwd: trackedOutput,
        });
        assert.equal(tracked.success, true);
        for (const name of names) {
          assert.ok(tracked.extractedFiles.includes(name));
          assert.deepEqual(
            await readFile(path.join(trackedOutput, name)),
            payload
          );
        }
        assert.deepEqual(priorities, [
          os.constants.priority.PRIORITY_BELOW_NORMAL,
          os.constants.priority.PRIORITY_BELOW_NORMAL,
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
}

it(
  "locks symlink aliases under the same canonical output directory",
  {
    skip: !existsSync(binaryPath),
  },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hydra-output-alias-"));
    try {
      const destination = path.join(root, "output");
      const alias = path.join(root, "alias");
      await mkdir(destination);
      try {
        await symlink(
          destination,
          alias,
          process.platform === "win32" ? "junction" : "dir"
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          t.skip("Creating directory symlinks is not permitted");
          return;
        }
        throw error;
      }
      const archive = path.join(root, "game.zip");
      await writeFile(path.join(root, "game.txt"), "aliased output");
      await execFileAsync(binaryPath, ["a", archive, "game.txt"], {
        cwd: root,
        windowsHide: true,
      });
      const destinations: (string | undefined)[] = [];
      const originalRun = ArchiveExtractionQueue.prototype.run;
      t.mock.method(ArchiveExtractionQueue.prototype, "run", function <
        T,
      >(this: ArchiveExtractionQueue, operation: () => Promise<T>, options?: Parameters<ArchiveExtractionQueue["run"]>[1]): Promise<T> {
        destinations.push(options?.destination);
        return originalRun.call(this, operation, options) as Promise<T>;
      });
      const results = await Promise.all(
        [destination, alias].map((outputPath) =>
          extractArchive(binaryPath, { filePath: archive, outputPath })
        )
      );
      assert.ok(results.every((result) => result.success));
      assert.equal(destinations.length, 2);
      assert.equal(destinations[0], await realpath(destination));
      assert.equal(destinations[0], destinations[1]);
      assert.equal(
        await readFile(path.join(destination, "game.txt"), "utf8"),
        "aliased output"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

it(
  "retries encrypted archives only after the failed attempt has exited",
  { skip: !existsSync(binaryPath) },
  async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "hydra-encrypted-extraction-")
    );
    try {
      const archive = path.join(root, "encrypted.zip");
      await writeFile(path.join(root, "game.txt"), "secret game data");
      await execFileAsync(binaryPath, ["a", "-psecret", archive, "game.txt"], {
        cwd: root,
        windowsHide: true,
      });
      const output = path.join(root, "output");
      const result = await extractArchive(binaryPath, {
        filePath: archive,
        outputPath: output,
        passwords: ["wrong", "wrong", "secret"],
      });
      assert.equal(result.success, true);
      assert.deepEqual(result.extractedFiles, ["game.txt"]);
      assert.equal(
        await readFile(path.join(output, "game.txt"), "utf8"),
        "secret game data"
      );
      await assert.rejects(
        extractArchive(binaryPath, {
          filePath: archive,
          outputPath: output,
          passwords: ["wrong", "also-wrong"],
        }),
        /exit 2.*encrypted|wrong password/is
      );
      // No supplied password must fail rather than wait for an interactive prompt.
      await assert.rejects(
        extractArchive(binaryPath, { filePath: archive, outputPath: output }),
        /exit 2/
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

it("waits for the failed process to finish before retrying", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hydra-retry-lifecycle-"));
  try {
    // Node acts as a deterministic fake extractor: its first argument is our
    // 'x' script and the remaining arguments are the usual 7-Zip switches.
    await writeFile(
      path.join(root, "x"),
      [
        'const fs = require("node:fs");',
        'const password = process.argv.find((arg) => arg.startsWith("-p")).slice(2);',
        'fs.appendFileSync("attempts.txt", password + "-start\\n");',
        'if (password === "wrong") process.stderr.write("Wrong password\\n");',
        "setTimeout(() => {",
        '  fs.appendFileSync("attempts.txt", password + "-finish\\n");',
        '  process.exit(password === "wrong" ? 2 : 0);',
        "}, 20);",
      ].join("\n")
    );
    const result = await extractArchive(process.execPath, {
      filePath: path.join(root, "fixture.zip"),
      outputPath: root,
      passwords: ["wrong", "wrong", "secret"],
    });
    assert.equal(result.success, true);
    assert.equal(
      await readFile(path.join(root, "attempts.txt"), "utf8"),
      "wrong-start\nwrong-finish\nsecret-start\nsecret-finish\n"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it(
  "does not retry corrupt archives and releases the queue after failures",
  { skip: !existsSync(binaryPath) },
  async (t) => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "hydra-failed-extraction-")
    );
    try {
      // An archive name mentioning encryption is not itself a password error.
      const archive = path.join(root, "encrypted.7z");
      const output = path.join(root, "output");
      const priorities: number[] = [];
      const originalSetPriority = os.setPriority;
      t.mock.method(os, "setPriority", (pid: number, priority: number) => {
        priorities.push(priority);
        originalSetPriority(pid, priority);
      });
      await writeFile(archive, "not a zip archive");
      await assert.rejects(
        extractArchive(binaryPath, {
          filePath: archive,
          outputPath: output,
          passwords: ["wrong", "secret"],
        }),
        /exit 2/
      );
      assert.deepEqual(priorities, [
        os.constants.priority.PRIORITY_BELOW_NORMAL,
      ]);
      await assert.rejects(
        extractArchive(path.join(root, "missing-binary"), {
          filePath: archive,
          outputPath: output,
        }),
        { code: "ENOENT" }
      );
      await rm(archive);
      await writeFile(path.join(root, "game.txt"), "valid game data");
      await execFileAsync(binaryPath, ["a", archive, "game.txt"], {
        cwd: root,
        windowsHide: true,
      });
      const result = await extractArchive(binaryPath, {
        filePath: archive,
        outputPath: output,
      });
      assert.equal(result.success, true);
      assert.equal(
        await readFile(path.join(output, "game.txt"), "utf8"),
        "valid game data"
      );
      assert.deepEqual(priorities, [
        os.constants.priority.PRIORITY_BELOW_NORMAL,
        os.constants.priority.PRIORITY_BELOW_NORMAL,
      ]);

      const warning = new Error("Priority change denied");
      const warnings: unknown[] = [];
      t.mock.method(os, "setPriority", () => {
        throw warning;
      });
      const fallback = await extractArchive(binaryPath, {
        filePath: archive,
        outputPath: output,
        onPriorityError: (error) => warnings.push(error),
      });
      assert.equal(fallback.success, true);
      assert.deepEqual(warnings, [warning]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
