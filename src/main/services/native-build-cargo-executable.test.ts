import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";

// The build scripts are CommonJS and live outside the TS project, so they are
// loaded through require instead of an import.
const require = createRequire(import.meta.url);
const { cargoExecutable, findToolchainExecutable } =
  require("../../../scripts/lib/native-build.cjs") as {
    cargoExecutable: () => string;
    findToolchainExecutable: (executableName: string) => string | undefined;
  };

const cargoExecutableName =
  process.platform === "win32" ? "cargo.exe" : "cargo";

const createTemporaryDirectory = async (t: TestContext) => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-cargo-executable-")
  );
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
};

// Only the file must exist: the resolution checks the filesystem, it never
// spawns the candidate.
const writeExecutable = (directory: string, name: string) =>
  fs.promises.writeFile(path.join(directory, name), "");

const createCargoHome = async (t: TestContext, name: string) => {
  const directory = await createTemporaryDirectory(t);
  const bin = path.join(directory, "bin");
  await fs.promises.mkdir(bin, { recursive: true });
  await writeExecutable(bin, name);
  return directory;
};

const createPathEntry = async (t: TestContext, name: string) => {
  const directory = await createTemporaryDirectory(t);
  await writeExecutable(directory, name);
  return directory;
};

// The resolution reads CARGO_HOME and PATH, so each test installs its own and
// restores the originals afterwards.
const withCargoEnvironment = (
  t: TestContext,
  {
    cargoHome,
    pathEntries,
  }: { cargoHome?: string; pathEntries?: Array<string> },
  run: () => void
) => {
  const originalCargoHome = process.env.CARGO_HOME;
  const originalPath = process.env.PATH;

  if (cargoHome === undefined) delete process.env.CARGO_HOME;
  else process.env.CARGO_HOME = cargoHome;
  if (pathEntries !== undefined) {
    process.env.PATH = pathEntries.join(path.delimiter);
  }

  t.after(() => {
    if (originalCargoHome === undefined) delete process.env.CARGO_HOME;
    else process.env.CARGO_HOME = originalCargoHome;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });

  run();
};

describe("cargo executable resolution", () => {
  it("uses CARGO_HOME ahead of PATH and the default home", async (t) => {
    const cargoHome = await createCargoHome(t, cargoExecutableName);
    const onPath = await createPathEntry(t, cargoExecutableName);

    withCargoEnvironment(t, { cargoHome, pathEntries: [onPath] }, () => {
      assert.equal(
        cargoExecutable(),
        path.join(cargoHome, "bin", cargoExecutableName)
      );
    });
  });

  it("takes the cargo already on PATH when CARGO_HOME holds none", async (t) => {
    const cargoHome = await createTemporaryDirectory(t);
    const onPath = await createPathEntry(t, cargoExecutableName);

    withCargoEnvironment(t, { cargoHome, pathEntries: [onPath] }, () => {
      assert.equal(cargoExecutable(), path.join(onPath, cargoExecutableName));
    });
  });

  it("falls back to the rustup default home", async (t) => {
    const emptyPathEntry = await createTemporaryDirectory(t);

    withCargoEnvironment(t, { pathEntries: [emptyPathEntry] }, () => {
      assert.equal(
        cargoExecutable(),
        path.join(os.homedir(), ".cargo", "bin", cargoExecutableName)
      );
    });
  });

  it("names a concrete path instead of a bare cargo when nothing is found", async (t) => {
    const cargoHome = await createTemporaryDirectory(t);
    const emptyPathEntry = await createTemporaryDirectory(t);

    withCargoEnvironment(
      t,
      { cargoHome, pathEntries: [emptyPathEntry] },
      () => {
        const resolved = cargoExecutable();

        assert.equal(path.isAbsolute(resolved), true);
        assert.equal(resolved.endsWith(cargoExecutableName), true);
      }
    );
  });

  it("finds rustup in CARGO_HOME, like cargo", async (t) => {
    const cargoHome = await createCargoHome(t, "rustup.exe");

    withCargoEnvironment(t, { cargoHome }, () => {
      assert.equal(
        findToolchainExecutable("rustup.exe"),
        path.join(cargoHome, "bin", "rustup.exe")
      );
    });
  });

  it("finds rustup on PATH when CARGO_HOME holds none", async (t) => {
    const cargoHome = await createTemporaryDirectory(t);
    const onPath = await createPathEntry(t, "rustup.exe");

    withCargoEnvironment(t, { cargoHome, pathEntries: [onPath] }, () => {
      assert.equal(
        findToolchainExecutable("rustup.exe"),
        path.join(onPath, "rustup.exe")
      );
    });
  });
});
