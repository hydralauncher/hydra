const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const projectRoot = process.cwd();
const unlockersSrcDir = path.join(projectRoot, "unlockers", "src");

const outputManifestPath =
  process.env.UNLOCKERS_MANIFEST_OUTPUT_PATH ||
  path.join(projectRoot, "unlockers", "manifest.json");

const explicitRef = process.env.UNLOCKERS_SOURCE_REF;
const gitSha = process.env.GITHUB_SHA;

const sourceRef =
  explicitRef ||
  gitSha ||
  childProcess
    .execSync("git rev-parse HEAD", { cwd: projectRoot })
    .toString()
    .trim();

const repository = process.env.GITHUB_REPOSITORY || "hydralauncher/hydra";
const minLauncherVersion =
  process.env.UNLOCKERS_MIN_LAUNCHER_VERSION || undefined;

const getDownloaderName = (sourceCode, fileName) => {
  const downloaderMatch = sourceCode.match(
    /downloader\s*:\s*"([A-Za-z0-9_]+)"/
  );
  if (downloaderMatch) {
    return downloaderMatch[1];
  }

  throw new Error(
    `Could not infer downloader for unlocker module: ${fileName}`
  );
};

const getSha256 = (content) => {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
};

const files = fs
  .readdirSync(unlockersSrcDir)
  .filter((entry) => entry.endsWith(".ts"))
  .sort((a, b) => a.localeCompare(b));

const modules = files.map((fileName) => {
  const filePath = path.join(unlockersSrcDir, fileName);
  const sourceCode = fs.readFileSync(filePath, "utf8");
  const id = path.basename(fileName, ".ts");
  const downloader = getDownloaderName(sourceCode, fileName);

  const module = {
    id,
    downloader,
    source: `https://raw.githubusercontent.com/${repository}/${sourceRef}/unlockers/src/${fileName}`,
    sha256: getSha256(sourceCode),
  };

  if (minLauncherVersion) {
    module.minLauncherVersion = minLauncherVersion;
  }

  return module;
});

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  commit: sourceRef,
  runtimeApiVersion: 1,
  modules,
};

fs.mkdirSync(path.dirname(outputManifestPath), { recursive: true });
fs.writeFileSync(
  outputManifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(`Unlocker manifest generated at ${outputManifestPath}`);
