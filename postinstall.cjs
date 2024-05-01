const fs = require("fs");

if (process.platform === "win32") {
  fs.copyFileSync(
    "node_modules/ps-list/vendor/fastlist-0.3.0-x64.exe",
    "fastlist.exe"
  );
}
