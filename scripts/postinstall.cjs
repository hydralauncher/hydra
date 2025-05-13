const { default: axios } = require("axios");
const tar = require("tar");
const util = require("node:util");
const fs = require("node:fs");
const path = require("node:path");

const exec = util.promisify(require("node:child_process").exec);

const ludusaviVersion = "0.29.0";

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

  const stream = response.data.pipe(fs.createWriteStream(file));

  stream.on("finish", async () => {
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

    console.log(`Extracted ${file}, removing compressed downloaded file...`);
    fs.rmSync(file);
  });
};

downloadLudusavi();
