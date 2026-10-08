import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const manifest = require("../src/shared/legendary-manifest.json");
const {
  getLegendaryArtifact,
  prepareLegendary,
  parseArguments,
} = require("./prepare-legendary.cjs");

const checksum = (content) =>
  createHash("sha256").update(content).digest("hex");

function fixtureManifest(contents) {
  const artifacts = {};
  for (const platform of ["win32", "darwin"]) {
    artifacts[platform] = {};
    for (const arch of ["x64", "arm64"]) {
      artifacts[platform][arch] = {
        fileName: platform === "win32" ? "legendary.exe" : "legendary",
        url: `https://fixture.invalid/${platform}/${arch}`,
        sha256: checksum(contents[`${platform}/${arch}`] || "fixture"),
      };
    }
  }
  return { ...manifest, artifacts };
}

async function directory(t) {
  const projectDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "legendary-test-")
  );
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }));
  return projectDir;
}

test("selects official pinned artifacts for all six targets", () => {
  assert.equal(manifest.version, "0.21.1");
  for (const platform of ["win32", "darwin", "linux"]) {
    for (const arch of ["x64", "arm64"]) {
      const artifact = getLegendaryArtifact(platform, arch);
      const name = `${platform === "win32" ? "windows" : platform === "darwin" ? "macOS" : "linux"}_${arch}${platform === "win32" ? ".exe" : ""}`;
      assert.equal(
        artifact.url,
        `https://github.com/legendary-gl/legendary/releases/download/${manifest.version}/legendary_${name}`
      );
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    }
  }
});

test("downloads the explicit target, regardless of the host", async (t) => {
  const projectDir = await directory(t);
  const artifactManifest = fixtureManifest({});
  const targets = [];
  for (const platform of ["win32", "darwin"]) {
    for (const arch of ["x64", "arm64"]) {
      const result = await prepareLegendary({
        projectDir,
        platform,
        arch,
        artifactManifest,
        fetchImpl: async (url, { signal }) => {
          targets.push(url);
          assert.ok(signal instanceof AbortSignal);
          return new Response("fixture");
        },
      });
      assert.equal(result.cached, false);
      assert.equal(
        result.binaryPath,
        path.join(
          projectDir,
          "legendary",
          platform,
          arch,
          platform === "win32" ? "legendary.exe" : "legendary"
        )
      );
      assert.equal(await fs.readFile(result.binaryPath, "utf8"), "fixture");
    }
  }
  assert.deepEqual(targets, [
    "https://fixture.invalid/win32/x64",
    "https://fixture.invalid/win32/arm64",
    "https://fixture.invalid/darwin/x64",
    "https://fixture.invalid/darwin/arm64",
  ]);
});

test("valid cache is hashed and reused without network; mac permissions restored", async (t) => {
  const projectDir = await directory(t);
  const options = {
    projectDir,
    platform: "darwin",
    arch: "arm64",
    artifactManifest: fixtureManifest({}),
    fetchImpl: async () => new Response("fixture"),
  };
  const first = await prepareLegendary(options);
  await fs.chmod(first.binaryPath, 0o644);
  const cached = await prepareLegendary({
    ...options,
    fetchImpl: () => assert.fail("valid cache must not download"),
  });
  assert.equal(cached.cached, true);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(cached.binaryPath)).mode & 0o777, 0o755);
  }
});

test("corrupt cache is replaced only after a verified download", async (t) => {
  const projectDir = await directory(t);
  const options = {
    projectDir,
    platform: "win32",
    arch: "x64",
    artifactManifest: fixtureManifest({}),
    fetchImpl: async () => new Response("fixture"),
  };
  const first = await prepareLegendary(options);
  await fs.writeFile(first.binaryPath, "old-version");
  const repaired = await prepareLegendary(options);
  assert.equal(repaired.cached, false);
  assert.equal(await fs.readFile(repaired.binaryPath, "utf8"), "fixture");
  assert.deepEqual(await fs.readdir(path.dirname(repaired.binaryPath)), [
    "legendary.exe",
  ]);
});

test("checksum mismatch leaves no executable or temporary download", async (t) => {
  const projectDir = await directory(t);
  await assert.rejects(
    prepareLegendary({
      projectDir,
      platform: "darwin",
      arch: "x64",
      artifactManifest: fixtureManifest({}),
      fetchImpl: async () => new Response("wrong release"),
    }),
    /checksum mismatch/
  );
  assert.deepEqual(
    await fs.readdir(path.join(projectDir, "legendary", "darwin", "x64")),
    []
  );
});

test("interrupted download leaves no executable or temporary file", async (t) => {
  const projectDir = await directory(t);
  await assert.rejects(
    prepareLegendary({
      projectDir,
      platform: "win32",
      arch: "arm64",
      artifactManifest: fixtureManifest({}),
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error("network interrupted"));
            },
          })
        ),
    }),
    /network interrupted/
  );
  assert.deepEqual(
    await fs.readdir(path.join(projectDir, "legendary", "win32", "arm64")),
    []
  );
});

test("HTTP errors do not install an executable", async (t) => {
  const projectDir = await directory(t);
  await assert.rejects(
    prepareLegendary({
      projectDir,
      platform: "darwin",
      arch: "arm64",
      fetchImpl: async () => new Response("not found", { status: 404 }),
    }),
    /HTTP 404/
  );
  assert.deepEqual(
    await fs.readdir(path.join(projectDir, "legendary", "darwin", "arm64")),
    []
  );
});

test("unsupported targets fail before downloading or creating cache", async (t) => {
  const projectDir = await directory(t);
  for (const [platform, arch] of [
    ["win32", "ia32"],
    ["linux", "ia32"],
    ["darwin", "universal"],
    ["freebsd", "x64"],
  ]) {
    await assert.rejects(
      prepareLegendary({
        projectDir,
        platform,
        arch,
        fetchImpl: () => assert.fail("must not download"),
      }),
      /Unsupported Legendary/
    );
  }
  assert.deepEqual(await fs.readdir(projectDir), []);
});

test("concurrent preparation keeps architectures separate and installs atomically", async (t) => {
  const projectDir = await directory(t);
  const contents = { "win32/x64": "x64 exe", "win32/arm64": "arm64 exe" };
  const artifactManifest = fixtureManifest(contents);
  const prepare = (arch) =>
    prepareLegendary({
      projectDir,
      platform: "win32",
      arch,
      artifactManifest,
      fetchImpl: async (url) =>
        new Response(contents[url.replace("https://fixture.invalid/", "")]),
    });
  const results = await Promise.all([
    prepare("x64"),
    prepare("arm64"),
    prepare("x64"),
  ]);
  for (const result of results) {
    assert.equal(
      await fs.readFile(result.binaryPath, "utf8"),
      contents[`win32/${result.arch}`]
    );
    assert.deepEqual(await fs.readdir(path.dirname(result.binaryPath)), [
      "legendary.exe",
    ]);
  }
});

test("CLI accepts explicit target and rejects missing/unknown arguments", () => {
  assert.deepEqual(parseArguments(["--platform", "win32", "--arch", "arm64"]), {
    platform: "win32",
    arch: "arm64",
  });
  assert.deepEqual(parseArguments([]), {});
  assert.throws(() => parseArguments(["--arch"]), /Missing value/);
  assert.throws(
    () => parseArguments(["--platform", "--arch", "x64"]),
    /Missing value/
  );
  assert.throws(() => parseArguments(["--unknown", "x64"]), /Unknown/);
});
