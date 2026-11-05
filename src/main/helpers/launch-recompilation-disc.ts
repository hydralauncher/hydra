import { logger } from "@main/services";

const codedError = (code: string, objectId: string, slug: string) =>
  Object.assign(new Error(`${code}: ${objectId}/${slug}`), { code });

const launchError = (code: string, objectId: string, slug: string) => {
  logger.error("Failed to launch recompilation disc", { code, objectId, slug });
  return codedError(code, objectId, slug);
};

export const launchRecompilationDisc = async (
  objectId: string,
  slug: string
) => {
  const [{ getRecompilationRomState }, { playRecompilation }] =
    await Promise.all([
      import("@main/events/recompilation/recompilation-rom"),
      import("@main/events/recompilation/recompilation-installer"),
    ]);
  const ref = { objectId, slug };

  const rom = await getRecompilationRomState(ref);
  if (
    rom?.handlesRom &&
    !rom.isReady &&
    (!rom.romPath || rom.needsPreparation)
  ) {
    throw launchError("RECOMPILATION_NEEDS_SETUP", objectId, slug);
  }

  const result = await playRecompilation(ref);
  if (
    result.ok ||
    result.reason === "running" ||
    result.reason === "cloud_save_conflict"
  ) {
    return;
  }
  if (result.reason === "already_running") {
    throw codedError("RECOMPILATION_ALREADY_RUNNING", objectId, slug);
  }
  throw launchError("RECOMPILATION_LAUNCH_FAILED", objectId, slug);
};
