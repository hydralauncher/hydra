import { spawn, type ChildProcess } from "node:child_process";

import type { ResolvedLaunchCommand } from "./resolve-launch-command";

export const spawnDetachedEmulator = async (
  resolvedLaunchCommand: ResolvedLaunchCommand,
  workingDirectory: string,
  makeSpawnError: () => Error
): Promise<ChildProcess> => {
  const processRef = spawn(
    resolvedLaunchCommand.command,
    resolvedLaunchCommand.args,
    {
      shell: false,
      detached: true,
      stdio: "ignore",
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...resolvedLaunchCommand.env,
      },
    }
  );

  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      processRef.off("error", onError);
      resolve();
    };
    const onError = () => {
      processRef.off("spawn", onSpawn);
      reject(makeSpawnError());
    };
    processRef.once("spawn", onSpawn);
    processRef.once("error", onError);
  });

  return processRef;
};
