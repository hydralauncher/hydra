const fs = require("node:fs");

function updatePkgver(newVersion, pkgbuildPath) {
  try {
    const content = fs.readFileSync(pkgbuildPath, "utf8");
    const lines = content.split("\n");

    const updatedLines = lines.map((line) => {
      if (line.trim().startsWith("pkgver=")) {
        return `pkgver=${newVersion}`;
      }
      return line;
    });

    fs.writeFileSync(pkgbuildPath, updatedLines.join("\n"), "utf8");

    console.log(
      `✅ Successfully updated pkgver to ${newVersion} in ${pkgbuildPath}`
    );
  } catch (error) {
    console.error(`❌ Error updating pkgver: ${error.message}`);
    process.exit(1);
  }
}

// Get version from command line arguments
const args = process.argv.slice(2);

const newVersion = args[0];
const pkgbuildPath = args[1] || "./PKGBUILD";

updatePkgver(newVersion, pkgbuildPath);
