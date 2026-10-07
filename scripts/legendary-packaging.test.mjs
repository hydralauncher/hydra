import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import YAML from "yaml";

const require = createRequire(import.meta.url);
const config = YAML.parse(
  await fs.readFile(new URL("../electron-builder.yml", import.meta.url), "utf8")
);
const beforePack = require("./legendary-before-pack.cjs");
const afterPack = require("./legendary-after-pack.cjs");
const { createSigningOptions } = require("./legendary-mac-sign.cjs");
const signMac = require("./legendary-mac-sign.cjs");

test("Linux packaging ignores Legendary even when other platforms are cached", async () => {
  const context = {
    electronPlatformName: "linux",
    arch: 1,
    packager: {
      projectDir: "/unreachable/project",
      getResourcesDir: () =>
        assert.fail("Linux must not access packaged Legendary"),
    },
  };
  await beforePack(context);
  await afterPack(context);
  assert.ok(config.files.includes("!legendary/**"));
  assert.ok(config.files.includes("!resources/legendary/**"));
  for (const resource of [
    ...config.extraResources,
    ...config.linux.extraResources,
  ]) {
    assert.doesNotMatch(
      typeof resource === "string" ? resource : resource.from,
      /legendary/
    );
  }
});

test("packaging chooses only the target architecture outside ASAR and includes notices", () => {
  assert.equal(config.beforePack, "scripts/legendary-before-pack.cjs");
  assert.equal(config.afterPack, "scripts/legendary-after-pack.cjs");
  assert.equal(config.afterSign, "scripts/legendary-after-pack.cjs");
  for (const [platform, directory, fileName] of [
    ["win", "win32", "legendary.exe"],
    ["mac", "darwin", "legendary"],
  ]) {
    const binary = config[platform].extraResources.find((resource) =>
      resource.from.startsWith("legendary/")
    );
    assert.equal(binary.from, `legendary/${directory}/\${arch}`);
    assert.equal(binary.to, "legendary");
    assert.deepEqual(binary.filter, [fileName]);
    const notice = config[platform].extraResources.find(
      (resource) => resource.from === "resources/legendary"
    );
    assert.equal(notice.to, "legendary");
    assert.deepEqual(notice.filter, ["LICENSE", "NOTICE.md"]);
  }
});

test("both hooks reject unsupported target architectures without falling back to the host", async () => {
  const context = {
    electronPlatformName: "win32",
    arch: 0,
    packager: {
      projectDir: "/unreachable/project",
      getResourcesDir: () =>
        assert.fail("unsupported target must not read resources"),
    },
  };
  await assert.rejects(
    beforePack(context),
    /Unsupported Legendary architecture: ia32/
  );
  await assert.rejects(
    afterPack(context),
    /Unsupported Legendary architecture: ia32/
  );
});

test("packaged Windows executable may have signed bytes different from the upstream hash", async (t) => {
  const resourcesDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "legendary-signed-")
  );
  t.after(() => fs.rm(resourcesDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(resourcesDir, "legendary"));
  await fs.writeFile(
    path.join(resourcesDir, "legendary", "legendary.exe"),
    "signed executable bytes"
  );
  // A foreign architecture skips execution but still validates the packaged file.
  const arch = process.platform === "win32" && process.arch === "x64" ? 3 : 1;
  await afterPack({
    electronPlatformName: "win32",
    arch,
    appOutDir: "unused",
    packager: { getResourcesDir: () => resourcesDir },
  });
});

test("macOS PyInstaller signing entitlements are scoped to Legendary only", async () => {
  const app = path.join("project", "Hydra.app");
  const projectDir = "project";
  const originalFileOptions = {
    entitlements: "existing-hydra-entitlements.plist",
    hardenedRuntime: true,
    timestamp: "original-timestamp",
  };
  const options = {
    app,
    identity: "existing-signing-identity",
    optionsForFile: () => originalFileOptions,
  };
  const scoped = createSigningOptions(options, projectDir);
  assert.equal(scoped.identity, options.identity);
  for (const relativeFile of [
    ["Contents", "MacOS", "Hydra"],
    ["Contents", "Frameworks", "Hydra Helper.app"],
    ["Contents", "Resources", "hydra-native", "hydra-native.node"],
    ["Contents", "Resources", "ludusavi", "ludusavi"],
  ]) {
    assert.equal(
      scoped.optionsForFile(path.join(app, ...relativeFile)),
      originalFileOptions
    );
  }
  assert.deepEqual(
    scoped.optionsForFile(
      path.join(app, "Contents", "Resources", "legendary", "legendary")
    ),
    {
      ...originalFileOptions,
      entitlements: path.join(
        projectDir,
        "build",
        "entitlements.legendary.mac.plist"
      ),
    }
  );
  assert.equal(
    originalFileOptions.entitlements,
    "existing-hydra-entitlements.plist"
  );
  const entitlements = await fs.readFile(
    new URL("../build/entitlements.legendary.mac.plist", import.meta.url),
    "utf8"
  );
  assert.match(
    entitlements,
    /com\.apple\.security\.cs\.disable-library-validation/
  );
  assert.equal(config.mac.sign, "scripts/legendary-mac-sign.cjs");
  assert.equal(config.mac.entitlementsInherit, "build/entitlements.mac.plist");
});

test("macOS development builds remain unsigned when no certificate is available", async () => {
  await signMac(
    { app: "nonexistent/Hydra.app", platform: "darwin" },
    { projectDir: "unused", forceCodeSigning: false }
  );
});

test("macOS builds requiring signing still fail without an identity", async () => {
  await assert.rejects(
    signMac(
      { app: "nonexistent/Hydra.app", platform: "darwin" },
      { projectDir: "unused", forceCodeSigning: true }
    ),
    /no signing identity available/
  );
  await assert.rejects(
    signMac(
      { app: "nonexistent/Hydra.app", platform: "mas" },
      { projectDir: "unused", forceCodeSigning: false }
    ),
    /no signing identity available/
  );
});
