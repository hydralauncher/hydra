const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "upload-build.cjs"),
  "utf8"
);
const environment = {
  S3_ENDPOINT: "https://storage.example.com",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  S3_BUILDS_BUCKET_NAME: "builds",
  BUILDS_URL: "https://builds.example.com/",
};

async function runUpload(env, files, failUpload = false) {
  const objects = [];
  const notifications = [];
  let completion;
  let skipped = false;
  const exit = new Error("exit");
  const mocks = {
    "node:path": path,
    "../package.json": { version: "4.1.3" },
    "node:fs": {
      readdir: (_directory, callback) => {
        completion = callback(null, files);
      },
      createReadStream: (file) => file,
    },
    "@aws-sdk/client-s3": {
      S3Client: class {
        async send(command) {
          if (failUpload) throw new Error("Upload failed");
          objects.push(command.input);
        }
      },
      PutObjectCommand: class {
        constructor(input) {
          this.input = input;
        }
      },
    },
  };
  try {
    vm.runInNewContext(source, {
      require: (name) => {
        assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
        return mocks[name];
      },
      __dirname,
      process: {
        env: { ...environment, ...env },
        exit: () => {
          skipped = true;
          throw exit;
        },
      },
      console: { log: () => undefined },
      fetch: async (_url, options) => {
        notifications.push(JSON.parse(options.body));
      },
    });
  } catch (error) {
    if (error !== exit) throw error;
  }
  await completion;
  return { objects, notifications, skipped };
}

test("release uploads without webhook use versioned keys and no expiry", async () => {
  const files = [
    "hydralauncher-4.1.3-setup.exe",
    "hydralauncher-4.1.3-portable.exe",
    "hydralauncher-4.1.3.AppImage",
    "hydralauncher_4.1.3_amd64.deb",
    "hydra.rpm",
    "hydra.snap",
    "hydra.zip",
    "hydra.dmg",
    "hydra.tar.gz",
    "latest.yml",
    "hydra.exe.blockmap",
  ];
  const result = await runUpload({ BUILD_FLAVOR: "release" }, [
    ...files,
    "builder-debug.yml.bak",
    "win-unpacked",
  ]);
  assert.equal(result.skipped, false);
  assert.deepEqual(
    result.objects.map((object) => object.Key),
    files.map((file) => `releases/4.1.3/${file}`)
  );
  assert.ok(
    result.objects.every((object) => !Object.hasOwn(object, "Expires"))
  );
  assert.equal(result.notifications.length, 0);
});

test("release webhook links use the public base URL and encoded filenames", async () => {
  const result = await runUpload(
    {
      BUILD_FLAVOR: "release",
      BUILD_WEBHOOK_URL: "https://webhook.example.com",
    },
    ["Hydra Setup.exe"]
  );
  assert.match(
    result.notifications[0].embeds[0].fields[0].value,
    /https:\/\/builds\.example\.com\/releases\/4\.1\.3\/Hydra%20Setup\.exe/
  );
});

test("staging and production builds preserve timestamped uploads and cache expiry", async () => {
  for (const flavor of ["staging", "production"]) {
    const result = await runUpload(
      {
        BUILD_FLAVOR: flavor,
        BUILD_WEBHOOK_URL: "https://webhook.example.com",
      },
      ["hydra.exe", "hydra.zip"]
    );
    assert.equal(result.objects.length, 1);
    assert.match(
      result.objects[0].Key,
      new RegExp(`^${flavor}-\\d+-hydra\\.exe$`)
    );
    assert.ok(result.objects[0].Expires.getTime() > Date.now());
    assert.equal(result.notifications.length, 1);
  }
});

test("non-release builds without a webhook still skip upload", async () => {
  const result = await runUpload({ BUILD_FLAVOR: "staging" }, ["hydra.exe"]);
  assert.equal(result.skipped, true);
  assert.equal(result.objects.length, 0);
});

test("release upload fails when required storage configuration is missing", async () => {
  await assert.rejects(
    runUpload({ BUILD_FLAVOR: "release", S3_ENDPOINT: "" }, ["hydra.exe"]),
    /Missing S3_ENDPOINT/
  );
});

test("storage failures fail the upload instead of announcing a download", async () => {
  await assert.rejects(
    runUpload({ BUILD_FLAVOR: "release" }, ["hydra.exe"], true),
    /Upload failed/
  );
});
