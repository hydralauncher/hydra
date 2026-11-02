const path = require("node:path");
const { sign } = require("app-builder-lib/out/codeSign/macCodeSign");

function createSigningOptions(options, projectDir) {
  const legendaryPath = path.join(
    options.app,
    "Contents",
    "Resources",
    "legendary",
    "legendary"
  );
  return {
    ...options,
    optionsForFile(filePath) {
      const inherited = options.optionsForFile
        ? options.optionsForFile(filePath)
        : {};
      if (filePath !== legendaryPath) return inherited;
      // Scope the PyInstaller library-validation entitlement to this helper.
      // Keep Hydra, Electron, and every other native binary's options intact.
      return {
        ...inherited,
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
  // A custom hook makes electron-builder call us even without a certificate.
  // Preserve its usual unsigned development build behavior.
  if (!options.identity) {
    if (packager.forceCodeSigning || options.platform === "mas") {
      throw new Error(
        "Cannot sign macOS application: no signing identity available."
      );
    }
    return;
  }
  // Delegate to the same signer and retry policy electron-builder normally uses.
  await sign(createSigningOptions(options, packager.projectDir));
}

module.exports = signMac;
