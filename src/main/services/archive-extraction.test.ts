import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";
import {
  buildExtractionArgs,
  extractArchive,
  getExtractionSpawnOptions,
  type ExtractionProgress,
} from "./archive-extraction.js";

const execFileAsync = promisify(execFile);
const binaryNames = { darwin: "7zz", linux: "7zzs", win32: "7z.exe" };
const binaryPath = path.resolve("binaries", binaryNames[process.platform]);

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
  const args = buildExtractionArgs("-game [1].zip", "", false, false);
  assert.ok(args.includes("-bb0"));
  assert.ok(args.includes("-bsp0"));
  assert.ok(args.includes("-p-"));
  assert.ok(args.includes("-spd"));
  assert.deepEqual(args.slice(-2), ["--", "-game [1].zip"]);

  const tracked = buildExtractionArgs("game.zip", "password", true, true);
  assert.ok(tracked.includes("-bb1"));
  assert.ok(tracked.includes("-bsp1"));
  assert.ok(tracked.includes("-ppassword"));
});

for (const format of ["zip", "7z", "tar"]) {
  it(
    `extracts a real ${format} archive with quiet progress and optional file tracking`,
    { skip: !existsSync(binaryPath) },
    async () => {
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
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
}

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
  "rejects corrupt archives and missing binaries and remains usable after failure",
  { skip: !existsSync(binaryPath) },
  async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "hydra-failed-extraction-")
    );
    try {
      const archive = path.join(root, "encrypted.7z");
      const output = path.join(root, "output");
      await writeFile(archive, "not an archive");
      await assert.rejects(
        extractArchive(binaryPath, {
          filePath: archive,
          outputPath: output,
          passwords: ["wrong", "secret"],
        }),
        /exit 2/
      );
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
