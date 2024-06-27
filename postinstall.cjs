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

      fs.renameSync(file.replace(".zip", ""), "aria2");
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

downloadAria2();
