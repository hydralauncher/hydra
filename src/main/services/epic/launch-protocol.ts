import path from "node:path";
import { isRecord } from "./auth-protocol.js";
import { EpicSaveFailure } from "./cloud-save-protocol.js";

export interface EpicLaunchParameters {
  executable: string;
  args: string[];
  environment: Record<string, string>;
  workingDirectory: string;
}

const argumentArray = (input: unknown): input is string[] =>
  Array.isArray(input) &&
  input.every(
    (argument) => typeof argument === "string" && !argument.includes("\0")
  );
export function parseEpicLaunchParameters(
  input: unknown,
  installPath: string,
  expectedExecutable: string,
  paths: typeof path = path,
  windowsManifestPaths = false
): EpicLaunchParameters {
  if (
    !isRecord(input) ||
    typeof input.game_directory !== "string" ||
    typeof input.game_executable !== "string" ||
    typeof input.working_directory !== "string" ||
    !argumentArray(input.launch_command) ||
    input.launch_command.length !== 0 ||
    !argumentArray(input.game_parameters) ||
    !argumentArray(input.user_parameters) ||
    !argumentArray(input.egl_parameters) ||
    !isRecord(input.environment)
  )
    throw new EpicSaveFailure("invalid-response");
  const directory = paths.resolve(input.game_directory);
  const executable = paths.resolve(
    directory,
    input.game_executable.replace(/\\/g, paths.sep)
  );
  const cwd = paths.resolve(input.working_directory);
  const inside = (candidate: string) => {
    const relative = paths.relative(installPath, candidate);
    return (
      relative !== ".." &&
      !relative.startsWith(`..${paths.sep}`) &&
      !paths.isAbsolute(relative)
    );
  };
  if (
    !paths.isAbsolute(input.game_directory) ||
    !paths.isAbsolute(input.working_directory) ||
    !inside(directory) ||
    !inside(cwd) ||
    (paths.relative(expectedExecutable, executable) !== "" &&
      (!windowsManifestPaths ||
        expectedExecutable.toLowerCase() !== executable.toLowerCase()))
  )
    throw new EpicSaveFailure("invalid-path");
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.environment)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      typeof value !== "string" ||
      value.includes("\0")
    )
      throw new EpicSaveFailure("invalid-response");
    // Managed config never accepts Legendary wrappers or arbitrary preload injection.
    if (
      ["LEGENDARY_WRAPPER_EXE", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES"].includes(
        name
      )
    )
      throw new EpicSaveFailure("invalid-response");
    environment[name] = value;
  }
  return {
    executable,
    workingDirectory: cwd,
    environment,
    args: [
      ...input.game_parameters,
      ...input.user_parameters,
      ...input.egl_parameters,
    ],
  };
}
