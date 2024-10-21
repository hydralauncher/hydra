const { default: axios } = require("axios");
const util = require("node:util");
const fs = require("node:fs");
const path = require("node:path");

const exec = util.promisify(require("node:child_process").exec);

const fileName = {
  win32: "ludusavi-v0.25.0-win64.zip",
  linux: "ludusavi-v0.25.0-linux.zip",
  darwin: "ludusavi-v0.25.0-mac.zip",
};

const downloadLudusavi = async () => {
  if (fs.existsSync("ludusavi")) {
    console.log("Ludusavi already exists, skipping download...");
    return;
  }

  const file = fileName[process.platform];
  const downloadUrl = `https://github.com/mtkennerly/ludusavi/releases/download/v0.25.0/${file}`;

  console.log(`Downloading ${file}...`);

  const response = await axios.get(downloadUrl, { responseType: "stream" });

  const stream = response.data.pipe(fs.createWriteStream(file));

  stream.on("finish", async () => {
    console.log(`Downloaded ${file}, extracting...`);

    const pwd = process.cwd();

    const targetPath = path.join(pwd, "ludusavi");

    await exec(`npx extract-zip ${file} ${targetPath}`);

    if (process.platform !== "win32") {
      fs.chmodSync(path.join(targetPath, "ludusavi"), 0o755);
    }

    console.log("Extracted. Renaming folder...");

    console.log(`Extracted ${file}, removing compressed downloaded file...`);
    fs.rmSync(file);
  });
};

downloadLudusavi();
