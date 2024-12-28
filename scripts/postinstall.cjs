const { default: axios } = require("axios");
const util = require("node:util");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

const downloadAria2WindowsAndLinux = async () => {
  if (fs.existsSync("aria2")) {
    console.log("Aria2 already exists, skipping download...");
    return;
  }

  const file =
    process.platform === "win32"
      ? "aria2-1.37.0-win-64bit-build1.zip"
      : "aria2-1.37.0-1-x86_64.pkg.tar.zst";

  const downloadUrl =
    process.platform === "win32"
      ? `https://github.com/aria2/aria2/releases/download/release-1.37.0/${file}`
      : "https://archlinux.org/packages/extra/x86_64/aria2/download/";

  console.log(`Downloading ${file}...`);

  const response = await axios.get(downloadUrl, { responseType: "stream" });

  const stream = response.data.pipe(fs.createWriteStream(file));

  stream.on("finish", async () => {
    console.log(`Downloaded ${file}, extracting...`);

    if (process.platform === "win32") {
      await exec(`npx extract-zip ${file}`);
      console.log("Extracted. Renaming folder...");

      fs.mkdirSync("aria2");
      fs.copyFileSync(
        path.join(file.replace(".zip", ""), "aria2c.exe"),
        "aria2/aria2c.exe"
      );
      fs.rmSync(file.replace(".zip", ""), { recursive: true });
    } else {
      await exec(`tar --zstd -xvf ${file} usr/bin/aria2c`);
      console.log("Extracted. Copying binary file...");
      fs.mkdirSync("aria2");
      fs.copyFileSync("usr/bin/aria2c", "aria2/aria2c");
      fs.rmSync("usr", { recursive: true });
    }

    console.log(`Extracted ${file}, removing compressed downloaded file...`);
    fs.rmSync(file);
  });
};

const copyAria2Macos = async () => {
  console.log("Checking if aria2 is installed...");

  const isAria2Installed = spawnSync("which", ["aria2c"]).status;

  if (isAria2Installed != 0) {
    console.log("Please install aria2");
    console.log("brew install aria2");
    return;
  }

  console.log("Copying aria2 binary...");
  fs.mkdirSync("aria2");
  await exec(`cp $(which aria2c) aria2/aria2c`);
};

if (process.platform == "darwin") {
  copyAria2Macos();
} else {
  downloadAria2WindowsAndLinux();
}

downloadLudusavi();
