const { default: axios } = require("axios");
const tar = require("tar");
const util = require("node:util");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");

const exec = util.promisify(require("node:child_process").exec);

const ludusaviVersion = "0.29.0";
const presentMonVersion = "2.5.1";
const presentMonSha256 =
  "9bec3083069f58f911e6a512f4806db51a27bd096103087bc1d05ef54c80a191";

const fileName = {
  win32: `ludusavi-v${ludusaviVersion}-win64.zip`,
  linux: `ludusavi-v${ludusaviVersion}-linux.tar.gz`,
  darwin: `ludusavi-v${ludusaviVersion}-mac.tar.gz`,
};

const ludusaviBinaryName = {
  win32: "ludusavi.exe",
  linux: "ludusavi",
  darwin: "ludusavi",
};

const downloadLudusavi = async () => {
  if (
    fs.existsSync(
      path.join(process.cwd(), "ludusavi", ludusaviBinaryName[process.platform])
    )
  ) {
    console.log("Ludusavi already exists, skipping download...");
    return;
  }

  const file = fileName[process.platform];
  const downloadUrl = `https://github.com/mtkennerly/ludusavi/releases/download/v${ludusaviVersion}/${file}`;

  console.log(`Downloading ${file}...`);

  const response = await axios.get(downloadUrl, { responseType: "stream" });
  await pipeline(response.data, fs.createWriteStream(file));

  try {
    console.log(`Downloaded ${file}, extracting...`);

    const pwd = process.cwd();
    const targetPath = path.join(pwd, "ludusavi");

    await fs.promises.mkdir(targetPath, { recursive: true });

    if (process.platform === "win32") {
      await exec(`npx extract-zip ${file} ${targetPath}`);
    } else {
      await tar.x({
        file: file,
        cwd: targetPath,
      });
    }

    if (process.platform !== "win32") {
      fs.chmodSync(path.join(targetPath, "ludusavi"), 0o755);
    }

    console.log("Extracted. Renaming folder...");
  } finally {
    await fs.promises.rm(file, { force: true });
  }
};

const downloadPresentMon = async () => {
  if (process.platform !== "win32") return;

  const targetDirectory = path.join(process.cwd(), "presentmon");
  const targetPath = path.join(targetDirectory, "PresentMon.exe");
  const licensePath = path.join(targetDirectory, "PresentMon-LICENSE.txt");
  const checksum = (contents) =>
    crypto.createHash("sha256").update(contents).digest("hex");
  const validBinary =
    fs.existsSync(targetPath) &&
    checksum(await fs.promises.readFile(targetPath)) === presentMonSha256;
  if (validBinary) {
    console.log("PresentMon already exists, skipping download...");
  } else {
    const file = `PresentMon-${presentMonVersion}-x64.exe`;
    const downloadUrl = `https://github.com/GameTechDev/PresentMon/releases/download/v${presentMonVersion}/${file}`;
    console.log(`Downloading ${file}...`);
    const response = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
    });
    const contents = Buffer.from(response.data);
    if (checksum(contents) !== presentMonSha256) {
      throw new Error(`PresentMon ${presentMonVersion} checksum mismatch`);
    }
    await fs.promises.mkdir(targetDirectory, { recursive: true });
    await fs.promises.writeFile(targetPath, contents);
    console.log(`PresentMon ready at ${targetPath}`);
  }

  if (!fs.existsSync(licensePath)) {
    const licenseUrl = `https://raw.githubusercontent.com/GameTechDev/PresentMon/v${presentMonVersion}/LICENSE.txt`;
    const response = await axios.get(licenseUrl, { responseType: "text" });
    await fs.promises.mkdir(targetDirectory, { recursive: true });
    await fs.promises.writeFile(licensePath, response.data, "utf8");
  }
};

Promise.all([downloadLudusavi(), downloadPresentMon()]).catch((error) => {
  console.error("Failed to download a development dependency", error);
  process.exitCode = 1;
});
