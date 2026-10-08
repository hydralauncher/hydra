import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getLegendaryAvailability,
  resolveLegendaryBinaryPath,
  type LegendaryEnvironment,
} from "./legendary-core.ts";

const environment = (
  overrides: Partial<LegendaryEnvironment> = {}
): LegendaryEnvironment => ({
  platform: "darwin",
  arch: "arm64",
  isPackaged: false,
  developmentRoot: "/Users/me/Hydra repo",
  resourcesPath: "/Applications/Hydra.app/Contents/Resources",
  ...overrides,
});

const expectedVersion = "0.21.1";
const versionOutput = 'legendary version "0.21.1", codename "Test"\n';

test("resolves the development executable for each platform and architecture", () => {
  for (const arch of ["x64", "arm64"]) {
    assert.equal(
      resolveLegendaryBinaryPath(environment({ platform: "linux", arch })),
      `/Users/me/Hydra repo/legendary/linux/${arch}/legendary`
    );
    assert.equal(
      resolveLegendaryBinaryPath(environment({ arch })),
      `/Users/me/Hydra repo/legendary/darwin/${arch}/legendary`
    );
    assert.equal(
      resolveLegendaryBinaryPath(
        environment({
          platform: "win32",
          arch,
          developmentRoot: "C:\\Hydra repo",
        })
      ),
      `C:\\Hydra repo\\legendary\\win32\\${arch}\\legendary.exe`
    );
  }
});

test("runs the packaged resource directly for each target, never a cached userData copy", () => {
  for (const arch of ["x64", "arm64"]) {
    assert.equal(
      resolveLegendaryBinaryPath(
        environment({
          platform: "linux",
          isPackaged: true,
          arch,
          resourcesPath: "/opt/Hydra/resources",
        })
      ),
      "/opt/Hydra/resources/legendary/legendary"
    );
    assert.equal(
      resolveLegendaryBinaryPath(environment({ isPackaged: true, arch })),
      "/Applications/Hydra.app/Contents/Resources/legendary/legendary"
    );
    assert.equal(
      resolveLegendaryBinaryPath(
        environment({
          platform: "win32",
          arch,
          isPackaged: true,
          resourcesPath: "C:\\Program Files\\Hydra\\resources",
        })
      ),
      "C:\\Program Files\\Hydra\\resources\\legendary\\legendary.exe"
    );
  }
});

test("does not inspect or execute Legendary on unsupported platforms or architectures", async () => {
  const overrides = {
    isFile: async () => {
      assert.fail("unsupported target must not access the file system");
    },
    execFile: () => {
      assert.fail("unsupported target must not execute Legendary");
    },
  };
  for (const isPackaged of [false, true]) {
    assert.equal(
      resolveLegendaryBinaryPath(
        environment({ platform: "freebsd", isPackaged })
      ),
      null
    );
    assert.deepEqual(
      await getLegendaryAvailability(
        environment({ platform: "freebsd", isPackaged }),
        expectedVersion,
        overrides
      ),
      { available: false, reason: "unsupported-platform" }
    );
    assert.deepEqual(
      await getLegendaryAvailability(
        environment({ arch: "ia32", isPackaged }),
        expectedVersion,
        overrides
      ),
      { available: false, reason: "unsupported-architecture" }
    );
  }
});

test("a missing executable is unavailable and never starts a process", async () => {
  const result = await getLegendaryAvailability(
    environment(),
    expectedVersion,
    {
      isFile: async () => false,
      execFile: () => assert.fail("missing executable must not execute"),
    }
  );
  assert.equal(result.available, false);
  if (!result.available) assert.equal(result.reason, "missing");
});

test("calls only --version without a shell, with timeout and bounded output", async () => {
  const result = await getLegendaryAvailability(
    environment(),
    expectedVersion,
    {
      isFile: async () => true,
      execFile: (binaryPath, args, options, callback) => {
        assert.equal(
          binaryPath,
          "/Users/me/Hydra repo/legendary/darwin/arm64/legendary"
        );
        assert.deepEqual(args, ["--version"]);
        assert.deepEqual(options, {
          shell: false,
          timeout: 15_000,
          windowsHide: true,
          maxBuffer: 16 * 1024,
          encoding: "utf8",
        });
        callback(null, versionOutput);
      },
    }
  );
  assert.deepEqual(result, {
    available: true,
    binaryPath: "/Users/me/Hydra repo/legendary/darwin/arm64/legendary",
    version: expectedVersion,
  });
});

test("does not accept exit zero with a wrong or unrelated version output", async () => {
  for (const output of [
    'legendary version "0.21.0", codename "Test"',
    "some executable version 0.21.1",
    "",
  ]) {
    const result = await getLegendaryAvailability(
      environment(),
      expectedVersion,
      {
        isFile: async () => true,
        execFile: (_file, _args, _options, callback) => callback(null, output),
      }
    );
    assert.equal(result.available, false);
    if (!result.available) assert.equal(result.reason, "version-mismatch");
  }
});

test("execution failures, timeout and output overflow remain optional integration failures", async () => {
  for (const error of [
    Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }),
    Object.assign(new Error("stdout maxBuffer length exceeded"), {
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    }),
  ]) {
    const result = await getLegendaryAvailability(
      environment(),
      expectedVersion,
      {
        isFile: async () => true,
        execFile: (_file, _args, _options, callback) =>
          callback(error, versionOutput),
      }
    );
    assert.equal(result.available, false);
    if (!result.available) assert.equal(result.reason, "execution-failed");
  }

  const result = await getLegendaryAvailability(
    environment(),
    expectedVersion,
    {
      isFile: async () => true,
      execFile: () => {
        throw new Error("spawn failed");
      },
    }
  );
  assert.equal(result.available, false);
  if (!result.available) assert.equal(result.reason, "execution-failed");
});

test("a file-system failure returns unavailable instead of rejecting", async () => {
  const result = await getLegendaryAvailability(
    environment(),
    expectedVersion,
    {
      isFile: async () => {
        throw new Error("permission denied");
      },
      execFile: () => assert.fail("unreachable file must not execute"),
    }
  );
  assert.equal(result.available, false);
  if (!result.available) assert.equal(result.reason, "missing");
});

test("default file inspection rejects missing executables and directories", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-legendary-")
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const env = environment({ isPackaged: true, resourcesPath: directory });
  const binaryPath = resolveLegendaryBinaryPath(env)!;

  assert.deepEqual(await getLegendaryAvailability(env, expectedVersion), {
    available: false,
    reason: "missing",
    binaryPath,
  });

  await fs.mkdir(binaryPath, { recursive: true });
  assert.deepEqual(await getLegendaryAvailability(env, expectedVersion), {
    available: false,
    reason: "missing",
    binaryPath,
  });
});
