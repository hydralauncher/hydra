const { Arch } = require("builder-util");
const { prepareLegendary } = require("./prepare-legendary.cjs");

async function beforePack(context) {
  await prepareLegendary({
    projectDir: context.packager.projectDir,
    platform: context.electronPlatformName,
    arch: Arch[context.arch],
  });
}

module.exports = beforePack;
