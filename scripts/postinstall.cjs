const { default: axios } = require("axios");
const tar = require("tar");
const util = require("node:util");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const exec = util.promisify(require("node:child_process").exec);

const ludusaviVersion = "0.29.0";
const MAX_DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_RETRY_DELAY_MS = 1_000;

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableDownloadError = (error) => {
  if (!axios.isAxiosError(error)) return false;

  const status = error.response?.status;
  return !status || status === 408 || status === 429 || status >= 500;
};

const downloadFile = async (downloadUrl, file) => {
  const response = await axios.get(downloadUrl, { responseType: "stream" });
  await pipeline(response.data, fs.createWriteStream(file));
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

  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      await downloadFile(downloadUrl, file);
      break;
    } catch (error) {
      await fs.promises.rm(file, { force: true });

      if (
        !isRetryableDownloadError(error) ||
        attempt === MAX_DOWNLOAD_ATTEMPTS
      ) {
        throw error;
      }

      const retryDelay = DOWNLOAD_RETRY_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `Failed to download ${file}; retrying (${attempt}/${MAX_DOWNLOAD_ATTEMPTS}) in ${retryDelay}ms...`
      );
      await delay(retryDelay);
    }
  }

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
  await fs.promises.rm(file, { force: true });
};

downloadLudusavi().catch((error) => {
  console.error("Failed to download Ludusavi:", error);
  process.exitCode = 1;
});
