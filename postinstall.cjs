const fs = require("fs");

if (process.platform === "win32") {
  fs.copyFileSync(
    "node_modules/ps-list/vendor/fastlist-0.3.0-x64.exe",
    "fastlist.exe"
  );

  fs.copyFileSync(
    "resources/aria2c.exe",
    "aria2c.exe"
  );
}
