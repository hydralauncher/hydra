import { spawn } from "node:child_process";
import path from "node:path";

const quotePowerShellString = (value: string) =>
  `'${value.replaceAll("'", "''")}'`;

const getTrustedPowerShellPath = () => {
  const systemRoot =
    process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
};

const buildElevatedStartProcessCommand = (
  command: string,
  args: string[],
  workingDirectory: string
): string => {
  const argumentListPart =
    args.length > 0
      ? ` -ArgumentList @(${args.map(quotePowerShellString).join(",")})`
      : "";

  return (
    `Start-Process -FilePath ${quotePowerShellString(command)}` +
    ` -WorkingDirectory ${quotePowerShellString(workingDirectory)}` +
    `${argumentListPart} -Verb RunAs`
  );
};

// Windows requires executables whose manifest declares
// requestedExecutionLevel="requireAdministrator" (common for both games and
// their installers) to be launched through a mechanism capable of showing
// the UAC elevation prompt. A plain spawn() can't do that -- Windows returns
// ERROR_ELEVATION_REQUIRED, which Node reports as EACCES -- so we retry
// through PowerShell's Start-Process -Verb RunAs, which elevates the same
// way double-clicking the exe (or a shortcut to it) in Explorer does. The
// command is passed base64-encoded via -EncodedCommand to sidestep quoting
// issues with paths/args.
export const spawnElevatedOnWindows = (
  command: string,
  args: string[],
  workingDirectory: string,
  env: NodeJS.ProcessEnv
) => {
  const psCommand = buildElevatedStartProcessCommand(
    command,
    args,
    workingDirectory
  );
  const encodedCommand = Buffer.from(psCommand, "utf16le").toString("base64");

  return spawn(
    getTrustedPowerShellPath(),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
    {
      shell: false,
      detached: true,
      stdio: "ignore",
      cwd: workingDirectory,
      env,
    }
  );
};
