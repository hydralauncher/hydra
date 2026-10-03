import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  BASELINE_REF,
  compareSamples,
  fixtureBlock,
  formatReport,
  loadBaselineModule,
  parseArguments,
  quantile,
  summarize,
} from "./benchmark-extraction.mjs";

it("defaults to a pinned baseline, warmups and ten paired measurements", () => {
  const options = parseArguments([]);
  assert.equal(options.baseRef, BASELINE_REF);
  assert.equal(options.rounds, 10);
  assert.equal(options.warmups, 2);
  assert.equal(options.jobs, 1);
  assert.equal(options.fixture, "mixed");
});

it("accepts custom archives, destination disks and batch sizes", () => {
  const options = parseArguments([
    "--archive",
    "game with spaces.zip",
    "--temp-dir",
    "D:/bench",
    "--storage-label",
    "SATA SSD",
    "--rounds",
    "12",
    "--warmups",
    "1",
    "--jobs",
    "2",
    "--base-ref",
    "HEAD~1",
    "--output",
    "results/report.json",
  ]);
  assert.equal(options.archive, "game with spaces.zip");
  assert.equal(options.tempDir, "D:/bench");
  assert.equal(options.storageLabel, "SATA SSD");
  assert.equal(options.jobs, 2);
  assert.equal(options.rounds, 12);
  assert.equal(options.warmups, 1);
  assert.equal(options.baseRef, "HEAD~1");
});

it("rejects invalid or unknown arguments instead of silently changing the experiment", () => {
  for (const args of [
    ["--rounds", "0"],
    ["--rounds", "101"],
    ["--rounds", "1.5"],
    ["--rounds", "bad"],
    ["--warmups", "11"],
    ["--jobs", "5"],
    ["--jobs", "0"],
    ["--fixture", "unknown"],
    ["--fixture", "constructor"],
    ["--archive"],
    ["--archive", "--rounds"],
    ["--output", "report.md"],
    ["--base-ref", "-bad"],
    ["--unknown", "10"],
    ["constructor", "10"],
  ])
    assert.throws(() => parseArguments(args));
  assert.deepEqual(parseArguments(["--help"]), { help: true });
});

it("uses deterministic fixture bytes", () => {
  const first = fixtureBlock();
  assert.equal(first.length, 128 * 1024);
  assert.deepEqual(first, fixtureBlock());
  const digest = createHash("sha256").update(first).digest("hex");
  assert.equal(digest.length, 64);
  assert.notDeepEqual(first.subarray(0, 1024), Buffer.alloc(1024));
});

it("reports medians and interpolated quantiles rather than best-case samples", () => {
  assert.deepEqual(summarize([4, 1, 3, 2]), {
    median: 2.5,
    p90: 3.7,
    min: 1,
    max: 4,
  });
  assert.equal(quantile([1, 2, 3], 0.5), 2);
  assert.equal(quantile([7], 0.9), 7);
  assert.throws(() => quantile([], 0.5));
  assert.throws(() => quantile([NaN], 0.5));
  assert.throws(() => quantile([1], 1.1));
});

const sample = (round, wallMs, parentCpuMs = 10) => ({
  round,
  wallMs,
  parentCpuMs,
  extractionMs: wallMs * 0.8,
  sizeScanMs: wallMs * 0.2,
  progressEvents: 5,
  eventLoopP99Ms: 10,
  eventLoopMaxMs: 11,
});

it("pairs rounds and calculates a reproducible bootstrap interval", () => {
  const samples = {
    before: [sample(0, 100), sample(1, 200), sample(2, 300)],
    after: [sample(0, 90), sample(1, 180), sample(2, 270)],
  };
  const comparison = compareSamples(samples);
  assert.equal(comparison.improvementsPercent.wallMs, 10);
  assert.deepEqual(
    comparison.pairedWallImprovementPercent.bootstrap95,
    [10, 10]
  );
  assert.equal(comparison.pairedWallImprovementPercent.resamples, 5000);
  assert.deepEqual(comparison, compareSamples(samples));
});

it("shows regressions and does not divide by zero for coarse CPU timers", () => {
  const comparison = compareSamples({
    before: [sample(0, 100, 0)],
    after: [sample(0, 120, 0)],
  });
  assert.equal(comparison.improvementsPercent.wallMs, -20);
  assert.equal(comparison.improvementsPercent.parentCpuMs, null);
  assert.deepEqual(
    comparison.pairedWallImprovementPercent.bootstrap95,
    [-20, -20]
  );
  assert.throws(() => compareSamples({ before: [], after: [] }));
  assert.throws(() =>
    compareSamples({ before: [sample(0, 100)], after: [sample(1, 90)] })
  );
});

it("loads original TypeScript modules with controlled headless dependencies", () => {
  const source = `import { logger } from "./logger";
    export const calculate = (value: number): number => { logger.info("test"); return value + 1; };`;
  assert.equal(loadBaselineModule(source, "fixture.ts").calculate(5), 6);
  assert.throws(
    () =>
      loadBaselineModule(
        'import { extractArchive } from "./archive-extraction"; export { extractArchive };',
        "unsupported.ts"
      ),
    /select a revision before the extraction changes/
  );
});

it("labels the PR report's measurement limits and smoke-test settings", () => {
  const report = {
    createdAt: "2026-01-01T00:00:00Z",
    settings: { rounds: 1, warmups: 0, jobs: 1, tempDir: "D:/bench" },
    environment: {
      platform: "win32",
      release: "test",
      arch: "x64",
      node: "v24",
      cpu: "test CPU",
      usableThreads: 16,
      sevenZip: "7-Zip test",
      binarySha256: "binary-hash",
    },
    baseline: { commit: BASELINE_REF },
    after: { commit: BASELINE_REF, workingTreeDirty: true },
    archive: {
      synthetic: true,
      name: "mixed",
      compressedBytes: 1024,
      unpackedBytes: 2048,
      files: 10,
      sha256: "archive-hash",
    },
    comparison: compareSamples({
      before: [sample(0, 100)],
      after: [sample(0, 90)],
    }),
    priorityWarnings: [],
  };
  const markdown = formatReport(report);
  assert.match(markdown, /uncommitted changes/);
  assert.match(markdown, /conservative baseline/);
  assert.match(markdown, /do not prove less desktop lag/);
  assert.match(markdown, /smoke test/);
  assert.match(markdown, /No warmups/);
  assert.match(markdown, /--base-ref 030f173/);
});

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const binaryNames = { win32: "7z.exe", linux: "7zzs", darwin: "7zz" };
const binary = path.join(
  projectRoot,
  "binaries",
  binaryNames[process.platform] ?? "unsupported"
);

it(
  "benchmarks a supplied archive, preserves it and cleans extraction folders",
  {
    skip: !existsSync(binary),
  },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "hydra-benchmark-test-"));
    const execFileAsync = promisify(execFile);
    try {
      const input = path.join(root, "input");
      await mkdir(input);
      await writeFile(
        path.join(input, "Game [USA] é.bin"),
        Buffer.alloc(4096, 42)
      );
      const archive = path.join(root, "archive with spaces.zip");
      await execFileAsync(binary, ["a", archive, "."], {
        cwd: input,
        windowsHide: true,
      });
      const originalArchive = await readFile(archive);
      const output = path.join(root, "report.json");
      await execFileAsync(
        process.execPath,
        [
          "--import",
          new URL("./register-ts-node.mjs", import.meta.url).href,
          path.join(projectRoot, "scripts", "benchmark-extraction.mjs"),
          "--archive",
          archive,
          "--temp-dir",
          root,
          "--rounds",
          "2",
          "--warmups",
          "0",
          "--jobs",
          "2",
          "--output",
          output,
        ],
        { cwd: projectRoot, windowsHide: true }
      );
      const report = JSON.parse(await readFile(output, "utf8"));
      assert.equal(report.baseline.commit, BASELINE_REF);
      assert.equal(report.archive.synthetic, false);
      assert.equal(report.archive.unpackedBytes, 4096);
      assert.equal(report.archive.files, 1);
      assert.equal(report.samples.before.length, 2);
      assert.equal(report.samples.after.length, 2);
      for (const variant of ["before", "after"]) {
        for (const sample of report.samples[variant]) {
          assert.equal(sample.files, 2);
          assert.equal(sample.unpackedBytes, 8192);
        }
      }
      assert.equal(report.samples.before[0].order, 0);
      assert.equal(report.samples.before[1].order, 1);
      assert.deepEqual(await readFile(archive), originalArchive);
      assert.match(
        await readFile(path.join(root, "report.md"), "utf8"),
        /User-supplied archive/
      );
      assert.ok(
        (await readdir(root)).every(
          (name) => !name.startsWith("hydra-extraction-bench-")
        )
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

it("prints help without executing a benchmark or needing the TS loader", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./benchmark-extraction.mjs", import.meta.url)),
    "--help",
  ]);
  assert.match(stdout, /Measured before\/after pairs/);
  assert.match(stdout, /not 7-Zip, Defender/);
});
