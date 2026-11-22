const path = require("node:path");
const { sign } = require("app-builder-lib/out/codeSign/macCodeSign");

function stripHardenedRuntime(options) {
  const { signatureFlags } = options;
  const filteredFlags = Array.isArray(signatureFlags)
    ? signatureFlags.filter((flag) => flag !== "runtime")
    : typeof signatureFlags === "string"
      ? signatureFlags
          .split(",")
          .map((flag) => flag.trim())
          .filter((flag) => flag && flag !== "runtime")
      : signatureFlags;

  return {
    ...options,
    hardenedRuntime: false,
    ...(signatureFlags !== undefined ? { signatureFlags: filteredFlags } : {}),
  };
}

function createSigningOptions(options, projectDir, { adHoc = false } = {}) {
  const legendaryPath = path.join(
    options.app,
    "Contents",
    "Resources",
    "legendary",
    "legendary"
  );
  return {
    ...options,
    ...(adHoc ? { hardenedRuntime: false } : {}),
    optionsForFile(filePath) {
      const inherited = options.optionsForFile
        ? options.optionsForFile(filePath)
        : {};
      const resolved = adHoc ? stripHardenedRuntime(inherited) : inherited;
      if (filePath !== legendaryPath) return resolved;
      // Scope the PyInstaller library-validation entitlement to this helper.
      // Keep Hydra, Electron, and every other native binary's options intact.
      return {
        ...resolved,
        entitlements: path.join(
          projectDir,
          "build",
          "entitlements.legendary.mac.plist"
        ),
      };
    },
  };
}

async function signMac(options, packager) {
  // Without a Developer ID certificate on Apple Silicon, patching fuses leaves
  // Electron's pre-existing signature invalid; fall back to ad-hoc signing
  // without Hardened Runtime (otherwise dyld rejects mismatched ad-hoc Team IDs).
  if (!options.identity) {
    if (packager.forceCodeSigning || options.platform === "mas") {
      throw new Error(
        "Cannot sign macOS application: no signing identity available."
      );
    }
    await sign({
      ...createSigningOptions(options, packager.projectDir, { adHoc: true }),
      identity: "-",
      identityValidation: false,
    });
    return;
  }
  // Delegate to the same signer and retry policy electron-builder normally uses.
  await sign(createSigningOptions(options, packager.projectDir));
}

module.exports = signMac;
