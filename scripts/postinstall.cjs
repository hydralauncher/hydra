const { default: axios } = require("axios");
const fs = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");
const util = require("node:util");

const execPromise = util.promisify(exec);

const fileName = {
  win32: "ludusavi-v0.25.0-win64.zip",
  linux: "ludusavi-v0.25.0-linux.zip",
  darwin: "ludusavi-v0.25.0-mac.zip",
};

const downloadFile = async (url, destination) => {
  const response = await axios.get(url, { responseType: "stream" });
  const writer = fs.createWriteStream(destination);

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
};

const extractZip = async (file, targetPath) => {
  console.log(`Extracting ${file} to ${targetPath}...`);
  await execPromise(`npx extract-zip ${file} ${targetPath}`);
};

const cleanUp = (file) => {
  if (fs.existsSync(file)) {
    fs.rmSync(file, { recursive: true, force: true });
  }
};

const downloadAndExtractLudusavi = async () => {
  if (fs.existsSync("ludusavi")) {
    console.log("Ludusavi already exists, skipping download...");
    return;
  }

  const file = fileName[process.platform];
  const downloadUrl = `https://github.com/mtkennerly/ludusavi/releases/download/v0.25.0/${file}`;

  console.log(`Downloading ${file}...`);
  await downloadFile(downloadUrl, file);

  console.log(`Downloaded ${file}, extracting...`);
  const targetPath = path.join(process.cwd(), "ludusavi");
  await extractZip(file, targetPath);

  if (process.platform !== "win32") {
    const executablePath = path.join(targetPath, "ludusavi");
    fs.chmodSync(executablePath, 0o755);
  }

  cleanUp(file);
  console.log("Ludusavi downloaded and extracted.");
};

const downloadAndExtractAria2 = async () => {
  const file =
    process.platform === "win32"
      ? "aria2-1.37.0-win-64bit-build1.zip"
      : "aria2-1.37.0-1-x86_64.pkg.tar.zst";
  const downloadUrl =
    process.platform === "win32"
      ? `https://github.com/aria2/aria2/releases/download/release-1.37.0/${file}`
      : "https://archlinux.org/packages/extra/x86_64/aria2/download/";

  console.log(`Downloading ${file}...`);
  await downloadFile(downloadUrl, file);

  console.log(`Downloaded ${file}, extracting...`);
  const aria2Folder = "aria2";
  if (process.platform === "win32") {
    await extractZip(file, aria2Folder);
    fs.copyFileSync(path.join(file.replace(".zip", ""), "aria2c.exe"), path.join(aria2Folder, "aria2c.exe"));
  } else {
    await execPromise(`tar --zstd -xvf ${file} usr/bin/aria2c`);
    fs.mkdirSync(aria2Folder, { recursive: true });
    fs.copyFileSync("usr/bin/aria2c", path.join(aria2Folder, "aria2c"));
  }

  cleanUp(file);
  console.log("Aria2 downloaded and extracted.");
};

const checkAndCopyAria2Macos = async () => {
  console.log("Checking if aria2 is installed on macOS...");
  const { stdout, stderr } = await execPromise("which aria2c");

  if (stderr) {
    console.log("aria2 not found. Please install it using 'brew install aria2'.");
    return;
  }

  console.log("Copying aria2 binary...");
  fs.mkdirSync("aria2", { recursive: true });
  await execPromise(`cp ${stdout.trim()} aria2/aria2c`);
  console.log("Aria2 copied to 'aria2' folder.");
};

const handleAria2Download = async () => {
  const aria2Path =
    process.platform === "win32" ? "aria2/aria2c.exe" : "aria2/aria2c";

  if (fs.existsSync(aria2Path)) {
    console.log("Aria2 already exists, skipping download...");
    return;
  }

  if (process.platform === "darwin") {
    await checkAndCopyAria2Macos();
  } else {
    await downloadAndExtractAria2();
  }
};

const main = async () => {
  await handleAria2Download();
  await downloadAndExtractLudusavi();
};

main().catch((error) => {
  console.error("An error occurred:", error);
});
