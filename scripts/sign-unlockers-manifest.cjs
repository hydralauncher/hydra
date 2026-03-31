const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = process.cwd();

const manifestPath =
  process.env.UNLOCKERS_MANIFEST_PATH ||
  path.join(projectRoot, "unlockers", "manifest.json");

const outputSignaturePath =
  process.env.UNLOCKERS_SIGNATURE_OUTPUT_PATH ||
  path.join(projectRoot, "unlockers", "manifest.sig");

const fromEnv = process.env.UNLOCKERS_PRIVATE_KEY;
const privateKeyPath = process.env.UNLOCKERS_PRIVATE_KEY_PATH;

if (!fromEnv && !privateKeyPath) {
  console.error(
    "Missing private key. Set UNLOCKERS_PRIVATE_KEY or UNLOCKERS_PRIVATE_KEY_PATH"
  );
  process.exit(1);
}

const privateKeyPem = fromEnv
  ? fromEnv.replace(/\\n/g, "\n")
  : fs.readFileSync(privateKeyPath, "utf8");

const manifestContent = fs.readFileSync(manifestPath, "utf8");
const privateKey = crypto.createPrivateKey(privateKeyPem);

const signature = crypto.sign(
  null,
  Buffer.from(manifestContent, "utf8"),
  privateKey
);
const signatureBase64 = signature.toString("base64");

fs.mkdirSync(path.dirname(outputSignaturePath), { recursive: true });
fs.writeFileSync(outputSignaturePath, `${signatureBase64}\n`, "utf8");

console.log(`Unlocker manifest signature written to ${outputSignaturePath}`);
