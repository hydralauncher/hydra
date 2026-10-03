// Run with the TS loader, or use `yarn benchmark:extraction --help`.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import vm from "node:vm";
import ts from "typescript";

export const BASELINE_REF = "030f1730151de9df8e5bea4a28a2698ef49474a6";
const FIXTURE_SEED = "hydra-extraction-fixture-v1";
const FIXTURE_DATE = new Date("2000-01-01T00:00:00Z");
const FIXTURES = {
  mixed: { bulkFiles: 64, smallFiles: 2000 },
  bulk: { bulkFiles: 64, smallFiles: 0 },
  "many-small": { bulkFiles: 0, smallFiles: 10000 },
};
const BULK_FILE_BYTES = 2 * 1024 * 1024;
const SMALL_FILE_BYTES = 2048;
const DELAY_RESOLUTION_MS = 10;
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const HELP = `Usage: yarn benchmark:extraction [options]
  --fixture mixed|bulk|many-small   Deterministic synthetic ZIP (default: mixed)
  --archive <path>                 Use your own unencrypted archive instead
  --rounds <1..100>                Measured before/after pairs (default: 10)
  --warmups <0..10>                Discarded pairs (default: 2)
  --jobs <1..4>                    Archives per batch (default: 1)
  --temp-dir <path>                Extraction destination parent (default: OS temp)
  --storage-label <description>    Record the disk/model used in the report
  --base-ref <git-ref>             Before revision (default: ${BASELINE_REF})
  --output <report.json>           Save raw JSON and a matching PR-ready .md file
  --help                          Show this help

Both variants use the same bundled 7-Zip binary and archive. Creation, validation,
cleanup and module loading are not timed. CPU/delay metrics cover this Node process,
not 7-Zip, Defender, Electron renderers or overall desktop responsiveness.
`;

export const parseArguments = (args) => {
  const options = {
    fixture: "mixed",
    rounds: 10,
    warmups: 2,
    jobs: 1,
    tempDir: os.tmpdir(),
    baseRef: BASELINE_REF,
  };
  const names = {
    "--fixture": "fixture",
    "--rounds": "rounds",
    "--warmups": "warmups",
    "--jobs": "jobs",
    "--temp-dir": "tempDir",
    "--base-ref": "baseRef",
    "--archive": "archive",
    "--output": "output",
    "--storage-label": "storageLabel",
  };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--help") return { help: true };
    const name = Object.hasOwn(names, args[index])
      ? names[args[index]]
      : undefined;
    if (!name) throw new Error(`Unknown option: ${args[index]}`);
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${args[index - 1]}`);
    options[name] = value;
  }
  for (const [name, min, max] of [
    ["rounds", 1, 100],
    ["warmups", 0, 10],
    ["jobs", 1, 4],
  ]) {
    options[name] = Number(options[name]);
    if (
      !Number.isInteger(options[name]) ||
      options[name] < min ||
      options[name] > max
    ) {
      throw new Error(`--${name} must be an integer between ${min} and ${max}`);
    }
  }
  if (!Object.hasOwn(FIXTURES, options.fixture))
    throw new Error("Unknown --fixture");
  if (options.baseRef.startsWith("-")) throw new Error("Invalid --base-ref");
  if (
    options.output &&
    path.extname(options.output).toLowerCase() !== ".json"
  ) {
    throw new Error("--output must end in .json");
  }
  return options;
};

export const quantile = (values, fraction) => {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Samples must contain finite numbers");
  }
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new Error("Quantile fraction must be between zero and one");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  return (
    sorted[lower] +
    (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
  );
};

export const summarize = (values) => ({
  median: quantile(values, 0.5),
  p90: quantile(values, 0.9),
  min: Math.min(...values),
  max: Math.max(...values),
});

const METRICS = [
  "wallMs",
  "extractionMs",
  "sizeScanMs",
  "parentCpuMs",
  "progressEvents",
  "eventLoopP99Ms",
  "eventLoopMaxMs",
];
export const compareSamples = (samples) => {
  if (
    !samples.before.length ||
    samples.before.length !== samples.after.length
  ) {
    throw new Error("Before and after must have the same nonzero sample count");
  }
  const summary = Object.fromEntries(
    ["before", "after"].map((variant) => [
      variant,
      Object.fromEntries(
        METRICS.map((metric) => [
          metric,
          summarize(samples[variant].map((sample) => sample[metric])),
        ])
      ),
    ])
  );
  const improvementsPercent = Object.fromEntries(
    METRICS.map((metric) => {
      const before = summary.before[metric].median;
      return [
        metric,
        before === 0
          ? null
          : (100 * (before - summary.after[metric].median)) / before,
      ];
    })
  );
  const paired = samples.before.map((before, index) => {
    const after = samples.after[index];
    if (before.round !== after.round || before.wallMs <= 0)
      throw new Error("Mismatched sample pairs");
    return (100 * (before.wallMs - after.wallMs)) / before.wallMs;
  });
  // Deterministic paired bootstrap: this is uncertainty within this run, not a
  // claim that the same effect holds on different machines or cold caches.
  let state = 0x48594452;
  const nextIndex = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % paired.length;
  };
  const bootstrap = Array.from({ length: 5000 }, () =>
    quantile(
      Array.from({ length: paired.length }, () => paired[nextIndex()]),
      0.5
    )
  );
  return {
    summary,
    improvementsPercent,
    pairedWallImprovementPercent: {
      median: quantile(paired, 0.5),
      bootstrap95: [quantile(bootstrap, 0.025), quantile(bootstrap, 0.975)],
      resamples: bootstrap.length,
    },
  };
};

export const fixtureBlock = () =>
  createHash("shake256", { outputLength: 128 * 1024 })
    .update(FIXTURE_SEED)
    .digest();

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hashFile = async (filePath) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
};
const git = async (...args) =>
  (
    await execFileAsync("git", args, {
      cwd: projectRoot,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
  ).stdout;

// Execute the actual baseline modules, rather than keeping a hand-maintained
// duplicate. Only Electron packaging and logger dependencies are stubbed.
export const loadBaselineModule = (source, filename) => {
  const module = { exports: {} };
  const discardLog = () => undefined;
  const logger = {
    info: discardLog,
    error: discardLog,
    warn: discardLog,
    debug: discardLog,
  };
  const allowed = new Set([
    "node-7z",
    "node:child_process",
    "node:fs",
    "node:path",
    "fs",
    "path",
  ]);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(
    compiled,
    {
      module,
      exports: module.exports,
      process,
      __dirname: path.join(projectRoot, "out", "main"),
      require: (specifier) => {
        if (specifier === "electron") return { app: { isPackaged: false } };
        if (specifier === "./logger") return { logger };
        if (specifier === "./archive-entry") return {};
        if (!allowed.has(specifier))
          throw new Error(
            `Unsupported baseline import ${specifier}; select a revision before the extraction changes`
          );
        return require(specifier);
      },
    },
    { filename }
  );
  return module.exports;
};

const createFixture = async (root, binary, name) => {
  const specification = FIXTURES[name];
  const input = path.join(root, "input");
  await mkdir(input);
  const block = fixtureBlock();
  const payload = Buffer.alloc(BULK_FILE_BYTES);
  for (let offset = 0; offset < payload.length; offset += block.length)
    block.copy(payload, offset);
  const save = async (filePath, contents) => {
    await writeFile(filePath, contents);
    await utimes(filePath, FIXTURE_DATE, FIXTURE_DATE);
  };
  for (let index = 0; index < specification.bulkFiles; index++)
    await save(path.join(input, `data-${index}.bin`), payload);
  for (let start = 0; start < specification.smallFiles; start += 16) {
    await Promise.all(
      Array.from(
        { length: Math.min(16, specification.smallFiles - start) },
        (_, offset) =>
          save(
            path.join(input, `small-${start + offset}.txt`),
            block.subarray(0, SMALL_FILE_BYTES)
          )
      )
    );
  }
  await utimes(input, FIXTURE_DATE, FIXTURE_DATE);
  const archive = path.join(root, "fixture.zip");
  await execFileAsync(binary, ["a", "-tzip", "-mx=1", "-mmt=4", archive, "."], {
    cwd: input,
    windowsHide: true,
  });
  await rm(input, { recursive: true, force: true });
  return {
    path: archive,
    name,
    seed: FIXTURE_SEED,
    files: specification.bulkFiles + specification.smallFiles,
    unpackedBytes:
      specification.bulkFiles * BULK_FILE_BYTES +
      specification.smallFiles * SMALL_FILE_BYTES,
    creationArgs: ["a", "-tzip", "-mx=1", "-mmt=4", "<archive>", "."],
  };
};

const measure = async ({
  variant,
  round,
  root,
  jobs,
  archive,
  extractors,
  scanners,
  expected,
  priorityWarnings,
}) => {
  const outputs = Array.from({ length: jobs }, (_, job) =>
    path.join(root, `${variant}-${round}-${job}`)
  );
  await Promise.all(outputs.map((output) => mkdir(output)));
  const delay = monitorEventLoopDelay({ resolution: DELAY_RESOLUTION_MS });
  delay.enable();
  let progressEvents = 0;
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  let sample;
  try {
    await Promise.all(
      outputs.map((outputPath) =>
        extractors[variant](
          {
            filePath: archive.path,
            outputPath,
            passwords: ["online-fix.me"],
            collectExtractedFiles: false,
            onPriorityError: (error) => priorityWarnings.add(String(error)),
          },
          () => progressEvents++
        )
      )
    );
    const extractionMs = performance.now() - started;
    const scanStarted = performance.now();
    const sizes = await Promise.all(outputs.map(scanners[variant]));
    const sizeScanMs = performance.now() - scanStarted;
    const cpu = process.cpuUsage(cpuBefore);
    sample = {
      round,
      wallMs: extractionMs + sizeScanMs,
      extractionMs,
      sizeScanMs,
      parentCpuMs: (cpu.user + cpu.system) / 1000,
      progressEvents,
      eventLoopP99Ms: delay.percentile(99) / 1e6,
      eventLoopMaxMs: delay.max / 1e6,
      unpackedBytes: sizes.reduce((sum, size) => sum + size, 0),
    };
    // Independent file-count validation is outside the timed section. 7-Zip
    // validates archive CRCs during extraction; this is not a second hash pass.
    for (const [job, output] of outputs.entries()) {
      const entries = await readdir(output, {
        recursive: true,
        withFileTypes: true,
      });
      const files = entries.filter((entry) => entry.isFile()).length;
      expected.files ??= files;
      expected.bytes ??= sizes[job];
      if (files !== expected.files || sizes[job] !== expected.bytes)
        throw new Error("Extracted output count/size differs between variants");
    }
    sample.files = expected.files * jobs;
  } finally {
    delay.disable();
    await Promise.all(
      outputs.map((output) => rm(output, { recursive: true, force: true }))
    );
  }
  return sample;
};

export const formatReport = (report) => {
  const { comparison, settings, environment, baseline, archive } = report;
  const number = (value) => value.toFixed(2);
  const lines = [
    "# Extraction benchmark",
    "",
    `Run: ${report.createdAt}. Before: \`${baseline.commit}\`. After: \`${report.after.commit}\`${report.after.workingTreeDirty ? " with uncommitted changes (source hashes in JSON)" : ""}.`,
    "",
    "## Setup",
    "",
    `- ${environment.platform} ${environment.release}, ${environment.arch}; Node ${environment.node}; ${environment.cpu}; ${environment.usableThreads} usable CPU threads.`,
    `- ${environment.sevenZip}; binary SHA-256: \`${environment.binarySha256}\`.`,
    `- ${archive.synthetic ? `Synthetic ${archive.name} fixture` : "User-supplied archive"}: ${number(archive.compressedBytes / 1048576)} MiB compressed, ${number(archive.unpackedBytes / 1048576)} MiB unpacked, ${archive.files} files per archive.`,
    `- Archive SHA-256: \`${archive.sha256}\`.`,
    `- ${settings.rounds} measured pairs after ${settings.warmups} discarded warmup pairs; ${settings.jobs} archive(s) per batch; alternating before/after order.`,
    `- Destination parent: \`${settings.tempDir}\`${settings.storageLabel ? ` (${settings.storageLabel})` : ""}.`,
    ...(environment.afterArchiveScheduling
      ? [
          `- After scheduler: ${environment.afterMaxExtractionJobs} active extractors maximum, ${environment.afterMaxExtractionThreads} shared decoder-thread budget; this archive uses ${environment.afterArchiveScheduling.threads} decoder thread(s), ${environment.afterArchiveScheduling.priority} priority.`,
        ]
      : []),
    "",
    "## Results",
    "",
  ];
  for (const [metric, label, unit] of [
    ["wallMs", "Extraction + size scan", "ms"],
    ["extractionMs", "Extraction only", "ms"],
    ["sizeScanMs", "Size scan only", "ms"],
    ["parentCpuMs", "Node-process CPU time", "ms"],
    ["progressEvents", "Progress callbacks", "callbacks"],
  ]) {
    const before = comparison.summary.before[metric];
    const after = comparison.summary.after[metric];
    const change = comparison.improvementsPercent[metric];
    lines.push(
      `- ${label}, median: **${number(before.median)} → ${number(after.median)} ${unit}**${change === null ? " (percentage undefined: baseline is zero)" : ` (${number(change)}% reduction; negative means slower/more)`}. P90: ${number(before.p90)} → ${number(after.p90)} ${unit}.`
    );
  }
  const paired = comparison.pairedWallImprovementPercent;
  lines.push(
    `- Paired median wall-time improvement: ${number(paired.median)}%; bootstrap 95% interval: ${paired.bootstrap95.map(number).join("% to ")}% (${paired.resamples} resamples).`,
    `- Median per-run Node event-loop P99 delay: ${number(comparison.summary.before.eventLoopP99Ms.median)} → ${number(comparison.summary.after.eventLoopP99Ms.median)} ms (sampling resolution ${DELAY_RESOLUTION_MS} ms).`,
    "",
    "## Interpretation and limits",
    "",
    "- Positive reductions mean less time/work. An interval crossing zero is not evidence of a consistent wall-time speedup.",
    "- This is a headless, warm/cache-mixed extraction + size-scan benchmark, not a complete Hydra download/install workflow or a controlled cold-cache test.",
    "- Baseline modules come from Git; Electron packaging and logger dependencies are stubbed. The old GameFilesManager console progress logging is omitted, making this a conservative baseline.",
    "- CPU time and event-loop delay cover only this Node process, including measurement overhead. They exclude 7-Zip children, Defender, renderers, and total system CPU/I/O. These numbers do not prove less desktop lag.",
    "- Event-loop histogram values have an approximately 10 ms nominal sampling interval; do not interpret them as zero-based foreground input latency.",
    "- Fixture setup, source/binary hashing, file-count validation and deletion are outside the timer. Outputs are CRC-checked by 7-Zip and checked for equal file count/total size, not byte-compared afterward.",
    "- Single-job runs do not measure queue contention. ZIPs use a one-thread fast lane; all jobs retain below-normal priority and share the decoder budget. Use --jobs 2 for batch throughput, and a real archive plus system profiling for the reported PC lag."
  );
  if (settings.rounds < 10)
    lines.push(
      "- Fewer than 10 measured pairs: treat this as a smoke test, not support for a small speedup claim."
    );
  if (settings.warmups === 0)
    lines.push(
      "- No warmups: JIT/startup differences may affect the measured samples."
    );
  if (report.priorityWarnings.length)
    lines.push(
      `- Priority changes failed: ${report.priorityWarnings.join("; ")}.`
    );
  const quote = (value) => JSON.stringify(value.replaceAll("\\", "/"));
  lines.push(
    "",
    "## Reproduce",
    "",
    "```sh",
    `yarn benchmark:extraction --base-ref ${baseline.commit} --rounds ${settings.rounds} --warmups ${settings.warmups} --jobs ${settings.jobs} ${archive.synthetic ? `--fixture ${archive.name}` : `--archive ${quote(archive.path)}`} --temp-dir ${quote(settings.tempDir)} --output benchmark-results/extraction.json`,
    "```",
    "",
    "Attach the matching JSON for individual samples, run order, environment, and source hashes. Redact private paths before posting publicly.",
    ""
  );
  return lines.join("\n");
};

const main = async (options) => {
  const tempDir = path.resolve(options.tempDir);
  const binaryNames = { darwin: "7zz", linux: "7zzs", win32: "7z.exe" };
  const binary = path.join(
    projectRoot,
    "binaries",
    binaryNames[process.platform]
  );
  const commit = (
    await git(
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${options.baseRef}^{commit}`
    )
  ).trim();
  const baselinePaths = [
    "src/main/services/7zip.ts",
    "src/main/events/helpers/get-directory-size.ts",
  ];
  const baselineSources = await Promise.all(
    baselinePaths.map((file) => git("show", `${commit}:${file}`))
  );
  const baselineModules = baselineSources.map((source, index) =>
    loadBaselineModule(source, baselinePaths[index])
  );
  baselineModules[0].SevenZip.binaryPath = binary;
  const [
    {
      extractArchive,
      getExtractionThreadCount,
      getExtractionConcurrency,
      getExtractionScheduling,
      getExtractionSpawnOptions,
    },
    { getDirectorySize },
  ] = await Promise.all([
    import("../src/main/services/archive-extraction.ts"),
    import("../src/main/events/helpers/get-directory-size.ts"),
  ]);
  const afterPaths = [
    "scripts/benchmark-extraction.mjs",
    "src/main/services/archive-extraction.ts",
    "src/main/events/helpers/get-directory-size.ts",
  ];
  const afterHashes = Object.fromEntries(
    await Promise.all(
      afterPaths.map(async (file) => [
        file,
        await hashFile(path.join(projectRoot, file)),
      ])
    )
  );
  const binarySha256 = await hashFile(binary);
  const { stdout: binaryInfo } = await execFileAsync(binary, ["i"], {
    windowsHide: true,
  });
  const root = await mkdtemp(path.join(tempDir, "hydra-extraction-bench-"));
  try {
    const archive = options.archive
      ? { path: path.resolve(options.archive), synthetic: false }
      : {
          ...(await createFixture(root, binary, options.fixture)),
          synthetic: true,
        };
    archive.compressedBytes = (await stat(archive.path)).size;
    archive.sha256 = await hashFile(archive.path);
    const expected = { files: archive.files, bytes: archive.unpackedBytes };
    const samples = { before: [], after: [] };
    const priorityWarnings = new Set();
    const context = {
      root,
      jobs: options.jobs,
      archive,
      expected,
      priorityWarnings,
      extractors: {
        before: baselineModules[0].SevenZip.extractFile.bind(
          baselineModules[0].SevenZip
        ),
        after: (request, onProgress) =>
          extractArchive(binary, request, onProgress),
      },
      scanners: {
        before: baselineModules[1].getDirectorySize,
        after: getDirectorySize,
      },
    };
    const runPair = async (round, measured) => {
      const order = round % 2 ? ["after", "before"] : ["before", "after"];
      for (const [orderIndex, variant] of order.entries()) {
        const sample = await measure({ ...context, variant, round });
        if (measured) samples[variant].push({ ...sample, order: orderIndex });
      }
    };
    for (let round = 0; round < options.warmups; round++)
      await runPair(round, false);
    for (let round = 0; round < options.rounds; round++)
      await runPair(round, true);
    const report = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      settings: { ...options, tempDir },
      environment: {
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
        node: process.version,
        cpu: os.cpus()[0]?.model.trim(),
        logicalThreads: os.cpus().length,
        usableThreads: os.availableParallelism(),
        memoryBytes: os.totalmem(),
        node7z: require("node-7z/package.json").version,
        sevenZip: binaryInfo.match(/^7-Zip[^\r\n]+/m)?.[0],
        binarySha256,
        afterMaxExtractionThreads: getExtractionThreadCount(),
        afterMaxExtractionJobs: getExtractionConcurrency(),
        afterArchiveScheduling: getExtractionScheduling(archive.path),
        afterDetached: getExtractionSpawnOptions(tempDir).detached,
        parentPriority: os.getPriority(),
        eventLoopResolutionMs: DELAY_RESOLUTION_MS,
        typescript: ts.version,
        tsNode: require("ts-node/package.json").version,
        lockfileSha256: await hashFile(path.join(projectRoot, "yarn.lock")),
      },
      baseline: {
        commit,
        sources: Object.fromEntries(
          baselinePaths.map((file, index) => [
            file,
            sha256(baselineSources[index]),
          ])
        ),
      },
      after: {
        commit: (await git("rev-parse", "HEAD")).trim(),
        workingTreeDirty: Boolean(await git("status", "--porcelain")),
        sources: afterHashes,
      },
      archive: {
        ...archive,
        files: expected.files,
        unpackedBytes: expected.bytes,
      },
      samples,
      comparison: compareSamples(samples),
      priorityWarnings: [...priorityWarnings],
    };
    for (const file of afterPaths) {
      if ((await hashFile(path.join(projectRoot, file))) !== afterHashes[file])
        throw new Error(`Source changed during benchmark: ${file}`);
    }
    if (
      (await hashFile(binary)) !== binarySha256 ||
      (await hashFile(archive.path)) !== archive.sha256
    ) {
      throw new Error("Archive or 7-Zip binary changed during the benchmark");
    }
    if (options.output) {
      const jsonPath = path.resolve(options.output);
      const markdownPath = jsonPath.replace(/\.json$/i, ".md");
      await mkdir(path.dirname(jsonPath), { recursive: true });
      await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
      await writeFile(markdownPath, formatReport(report));
      process.stdout.write(
        `Saved raw samples: ${jsonPath}\nSaved PR summary: ${markdownPath}\n`
      );
    } else {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write(HELP);
    else await main(options);
  } catch (error) {
    process.stderr.write(`Benchmark failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
