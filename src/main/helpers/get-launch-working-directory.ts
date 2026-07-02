import os from "node:os";
import { isDocPortalPath, isFlatpak } from "./sandbox";

/**
 * Returns a working directory safe to hand a launched game process as its cwd.
 *
 * Under Flatpak, a game installed into a folder reached through the document
 * portal lives on a FUSE mount. getcwd() fails there for a cwd inherited across
 * exec (the kernel can't reconstruct the path), so any launcher that calls it
 * during start-up dies — umu-launcher invokes Path.cwd() while setting up Proton
 * and crashes with FileNotFoundError, which Hydra surfaces as "umu-run exited
 * early". Fall back to the user's home in that case; Proton still manages the
 * game's own (Windows) working directory from the absolute executable path.
 *
 * Outside the document portal the executable directory is a real path, so it is
 * returned unchanged.
 */
export const getLaunchWorkingDirectory = (executableDir: string): string =>
  isFlatpak && isDocPortalPath(executableDir) ? os.homedir() : executableDir;
