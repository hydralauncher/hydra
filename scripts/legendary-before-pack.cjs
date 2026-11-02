const { Arch } = require("builder-util");
const { prepareLegendary } = require("./prepare-legendary.cjs");
const {
  buildEpicPrerequisiteRunner,
} = require("./build-epic-prerequisite-runner.cjs");

async function beforePack(context) {
  if (context.electronPlatformName === "linux")
    await buildEpicPrerequisiteRunner({
      projectDir: context.packager.projectDir,
    });
  await prepareLegendary({
    projectDir: context.packager.projectDir,
    platform: context.electronPlatformName,
    arch: Arch[context.arch],
  });
}

module.exports = beforePack;
