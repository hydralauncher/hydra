const { default: axios } = require("axios");
const util = require("node:util");
const fs = require("node:fs");

const exec = util.promisify(require("node:child_process").exec);

const downloadAria2 = async () => {
  if (fs.existsSync("aria2")) {
    console.log("Aria2 already exists, skipping download...");
    return;
  }

  const file =
    process.platform === "win32"
      ? "aria2-1.37.0-win-64bit-build1.zip"
      : "aria2-1.37.0-aarch64-linux-android-build1.zip";

  console.log(`Downloading ${file}...`);

  const response = await axios.get(
    `https://github.com/aria2/aria2/releases/download/release-1.37.0/${file}`,
    { responseType: "stream" }
  );

  const stream = response.data.pipe(fs.createWriteStream(file));

  stream.on("finish", async () => {
    console.log(`Downloaded ${file}, extracting...`);

    await exec(`npx extract-zip ${file}`);
    console.log("Extracted. Renaming folder...");

    fs.renameSync(file.replace(".zip", ""), "aria2");

    console.log(`Extracted ${file}, removing zip file...`);
    fs.rmSync(file);
  });
};

if (process.platform === "win32") {
  fs.copyFileSync(
    "node_modules/ps-list/vendor/fastlist-0.3.0-x64.exe",
    "fastlist.exe"
  );
}

downloadAria2();
