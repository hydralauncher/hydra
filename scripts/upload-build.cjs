const fs = require("node:fs");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("node:path");
const packageJson = require("../package.json");

if (!process.env.BUILD_WEBHOOK_URL) {
  console.log("No BUILD_WEBHOOK_URL provided, skipping upload");
  process.exit(0);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

const dist = path.resolve(__dirname, "..", "dist");

const extensionsToUpload = [".deb", ".exe", ".pacman"];

fs.readdir(dist, async (err, files) => {
  if (err) throw err;

  const uploads = await Promise.all(
    files
      .filter((file) => extensionsToUpload.includes(path.extname(file)))
      .map(async (file) => {
        console.log(`⌛️ Uploading ${file}...`);
        const fileName = `${new Date().getTime()}-${file}`;

        const command = new PutObjectCommand({
          Bucket: process.env.S3_BUILDS_BUCKET_NAME,
          Key: fileName,
          Body: fs.createReadStream(path.resolve(dist, file)),
          // 3 days
          Expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3),
        });

        await s3.send(command);

        return {
          url: `${process.env.BUILDS_URL}/${fileName}`,
          name: fileName,
        };
      })
  );

  if (uploads.length > 0) {
    await fetch(process.env.BUILD_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uploads,
        branchName: process.env.BRANCH_NAME,
        version: packageJson.version,
        githubActor: process.env.GITHUB_ACTOR,
      }),
    });
  }
});
