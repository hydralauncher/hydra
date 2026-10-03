# Benchmarking extraction changes for a PR

Use the same archive, 7-Zip binary, Node version and destination disk for both implementations. The harness runs them in one process, discards warmups and alternates their order to reduce startup and cache-order bias. It saves every measured sample, not just the fastest run.

## Run the synthetic workloads

From the repository root, after installing dependencies:

```sh
yarn benchmark:extraction --fixture mixed --rounds 10 --warmups 2 --output benchmark-results/mixed.json
yarn benchmark:extraction --fixture many-small --rounds 10 --warmups 2 --output benchmark-results/many-small.json
yarn benchmark:extraction --fixture bulk --rounds 10 --warmups 2 --output benchmark-results/bulk.json
```

Each command creates a JSON report and a matching Markdown summary. Paste the `.md` into the PR and attach the JSON so reviewers can inspect individual samples and provenance. Local results are ignored by Git; attach them deliberately rather than committing machine-specific reports by accident.

Workloads:

- `mixed`: 64 files of 2 MiB plus 2,000 files of 2 KiB; about 132 MiB unpacked.
- `many-small`: 10,000 files of 2 KiB; about 20 MiB unpacked.
- `bulk`: 64 files of 2 MiB; 128 MiB unpacked.

Fixture contents use a fixed seed and file modification timestamps. The bulk files repeat a deterministic 128 KiB block, which is largely incompressible with ZIP's 32 KiB Deflate window. These fixtures test file/output overhead and metadata scanning; they do not represent every game's compression ratio. ZIP creation uses `-tzip -mx=1 -mmt=4`. The report records the actual archive SHA-256, sizes and 7-Zip binary SHA-256; archive bytes may differ across platforms or tool versions.

For a quick smoke test, use `--rounds 1 --warmups 0`. Do not use that result to justify a small percentage speedup.

## Test the affected archive and disk

The synthetic workloads alone do not establish a benefit on real downloads. Run a trusted, unencrypted archive that reproduces the problem, selecting the disk Hydra normally extracts onto:

```sh
yarn benchmark:extraction --archive "D:/Downloads/game.zip" --temp-dir "D:/BenchmarkTemp" --storage-label "SATA SSD, model here" --rounds 10 --warmups 2 --output benchmark-results/real-zip.json
```

The destination parent must already exist. The harness creates fresh output folders inside it and deletes them after each run. It does not modify or delete a supplied archive. No password option is currently provided.

Start with fewer rounds on a large archive to check runtime and free space. Ten rounds plus two warmup pairs perform 24 extractions per job: total disk writes can be substantial. Allow space for `jobs × unpacked archive size`, plus the generated ZIP when using a synthetic fixture. Creation, hashing, output validation and cleanup also perform I/O even though they are not timed.

Close downloads and disk-heavy applications, use a consistent power mode, and record the storage model and antivirus state. Do not disable security software merely to improve the score. Re-run the benchmark in a separate session to check that the effect survives ordinary run-to-run variation.

To exercise overlapping requests versus the new queue:

```sh
yarn benchmark:extraction --fixture mixed --jobs 2 --rounds 10 --warmups 2 --output benchmark-results/two-jobs.json
```

For `--jobs 2`, times are for the entire two-archive batch, not one archive. The old implementation starts both extractors concurrently. The new scheduler admits at most two jobs on machines with four or more usable CPU threads, subject to a shared decoder-thread budget and non-overlapping output directories. After all extractions finish, the harness measures the batch's size scans. This tests batch throughput and parent-process overhead, not foreground input latency or the exact interleaving of Hydra's download workflow.

ZIPs reserve one decoder thread. Common ZIP Store/Deflate decoding does not benefit from allocating many decoder threads, so two independent ZIPs can overlap without reserving the whole CPU budget. All jobs retain below-normal priority. Other formats reserve the shared decoder budget (half of usable CPU threads, capped at eight). On machines with fewer than four usable threads, only one extractor runs. Uncommon parallel ZIP codecs may trade throughput for the one-thread cap; test representative archives rather than assuming all ZIP methods behave alike.

Windows uses the original detached-console process launch. An isolated flag comparison found that attaching a console added startup latency to short bulk extractions; removing that overhead does not require raising process priority. The child is not unreferenced: its pipes and close event remain tracked before retrying or releasing a scheduler slot. Unix launch behavior remains non-detached.

Identical, nested and symlink-aliased output directories are serialized to prevent concurrent writers. FIFO admission prevents small ZIP jobs from starving a queued CPU-heavy job. These limits bound concurrency; they do not guarantee that disk I/O or total system CPU utilization stays below a particular percentage.

## Where “before” comes from

The default baseline is pinned to commit `030f1730151de9df8e5bea4a28a2698ef49474a6`, before these changes. The harness reads the original `SevenZip.extractFile` and `getDirectorySize` modules with `git show` and transpiles them in memory. It does not switch branches or edit your checkout. Both variants use the current checkout's bundled 7-Zip binary, isolating the application-code change.

Electron packaging and logger imports are stubbed for headless execution. The old `GameFilesManager` console progress logging is omitted, and the new logger wrapper is not run either. This favors the old path relative to its noisy application behavior; call it a conservative headless baseline, not a full before/after app recording.

You can select a different pre-change revision with `--base-ref <commit>`. It must have the compatible legacy modules. If the pinned commit is absent in a shallow clone, fetch it first:

```sh
git fetch origin 030f1730151de9df8e5bea4a28a2698ef49474a6
```

The JSON records the baseline commit and source hashes, the current HEAD, whether the working tree is dirty, and hashes of the measured new modules and harness. Archive/binary/source changes detected during a run cause the benchmark to fail rather than save misleading results.

## What the metrics mean

- `wallMs`: extraction plus installed-size scanning, excluding setup and deletion. This is not the full download/install/executable-binding workflow.
- `extractionMs` and `sizeScanMs`: the two phases separately. A faster scan must not be described as faster decompression.
- `parentCpuMs`: CPU time in the Node process, including callback/parsing and measurement overhead. It excludes 7-Zip's child processes, Defender and Electron renderers. Windows CPU-time counters can be coarse, so tiny values and percentage changes need caution.
- `progressEvents`: callbacks delivered to the caller, not IPC packets or renderer updates. The old app already throttled IPC but logged before that throttle.
- `eventLoopP99Ms` and `eventLoopMaxMs`: per-run Node event-loop histogram measurements at 10 ms resolution. Their approximately 10 ms nominal interval is not zero-based desktop input latency.

For each metric the report gives median, interpolated P90, minimum, maximum and raw samples. Reduction percentages compare medians: positive means less time/work; negative means a regression. A zero baseline produces no percentage rather than dividing by zero.

Wall-time uncertainty is also reported as a paired bootstrap interval: 5,000 deterministic resamples of the before/after pairs, taking the median percentage improvement in each resample. A 95% interval crossing zero does not support a consistent speedup claim. This interval describes variation within this experiment, not performance on other PCs or disks.

These are warm/cache-mixed measurements. Reading/hashing the input and prior runs affect OS caches, and the harness does not flush caches. Do not label the results as cold-cache performance.

7-Zip checks archive CRCs while extracting. Outside the timed section, the harness checks equal output file counts and total sizes; it does not independently compare every output byte. The synthetic workloads additionally check their known counts and sizes.

## Evidence to include in the PR

1. Exact command, baseline/new revision or source hashes, OS/CPU/Node/7-Zip versions, destination disk and antivirus state.
2. JSON and Markdown reports for `mixed`, `many-small`, `bulk`, and at least one representative real ZIP. Include regressions as well as improvements.
3. Separate claims for extraction time, size-scan time and Node-process overhead. The earlier four-round result was exploratory; use the warmed-up repeated results for the PR.
4. Queue/priority behavior backed by tests; do not claim that a single idle-machine benchmark proves reduced system-wide lag. For that claim, capture Windows Performance Recorder/Analyzer traces of the actual lag and compare CPU scheduling, disk I/O and Defender activity across the two application builds under the same workload. Keep trace overhead equal and obtain consent before collecting traces containing private paths.
5. Test results. The focused extraction/size-scan tests and benchmark tests should pass; disclose unrelated full-suite failures separately.

Redact private archive paths and destination paths before publishing reports or traces. Do not attach game archives.

## Validate the harness

```sh
yarn test:extraction-benchmark
node --import ./scripts/register-ts-node.mjs --test src/main/services/archive-extraction.test.ts src/main/events/helpers/get-directory-size.test.ts
```

Performance thresholds are deliberately not test assertions: shared CI runners and different disks make timing thresholds unreliable. Unit tests cover argument validation, deterministic data, statistics, pairing, baseline loading and report labels; small measured runs check the actual extraction path.
