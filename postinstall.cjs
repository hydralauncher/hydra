const fs = require("fs");

if (process.platform === "win32") {
  if (!fs.existsSync("resources/dist")) {
    fs.mkdirSync("resources/dist");
  }

  fs.copyFileSync(
    "node_modules/ps-list/vendor/fastlist-0.3.0-x64.exe",
    "resources/dist/fastlist.exe"
  );
}
