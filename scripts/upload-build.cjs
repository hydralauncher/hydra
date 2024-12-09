const fs = require("node:fs");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("node:path");
const packageJson = require("../package.json");

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

const dist = path.resolve(__dirname, "..", "resources");

const extensionsToUpload = [".deb", ".exe", ".png"];

fs.readdir(dist, async (err, files) => {
  if (err) throw err;

  const results = await Promise.all(
    files.map(async (file) => {
      if (extensionsToUpload.includes(path.extname(file))) {
        const fileName = `${new Date().getTime()}-${file}`;

        const command = new PutObjectCommand({
          Bucket: process.env.S3_BUILDS_BUCKET_NAME,
          Key: fileName,
          Body: fs.createReadStream(path.resolve(dist, file)),
        });

        await s3.send(command);

        return {
          url: `${process.env.S3_ENDPOINT}/${process.env.S3_BUILDS_BUCKET_NAME}/${fileName}`,
          name: fileName,
        };
      }
    })
  );

  await fetch(process.env.BUILD_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      results,
      branchName: process.env.BRANCH_NAME,
      version: packageJson.version,
    }),
  });
});
