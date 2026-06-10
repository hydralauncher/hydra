import { registerEvent } from "../register-event";
import sudo from "sudo-prompt";

const runDefenderCommand = (psCommand: string): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      return reject(new Error("This feature is only available on Windows."));
    }

    const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`;

    sudo.exec(command, { name: "Hydra Launcher" }, (error) => {
      if (error) {
        return reject(error);
      }
      resolve(true);
    });
  });
};

const addWindowsDefenderExclusion = async (
  _event: Electron.IpcMainInvokeEvent,
  exclusionPath: string
) => {
  if (!exclusionPath?.trim()) throw new Error("Invalid path.");
  return runDefenderCommand(
    `Add-MpPreference -ExclusionPath '${exclusionPath}'`
  );
};

const removeWindowsDefenderExclusion = async (
  _event: Electron.IpcMainInvokeEvent,
  exclusionPath: string
) => {
  if (!exclusionPath?.trim()) throw new Error("Invalid path.");
  return runDefenderCommand(
    `Remove-MpPreference -ExclusionPath '${exclusionPath}'`
  );
};

const updateWindowsDefenderExclusion = async (
  _event: Electron.IpcMainInvokeEvent,
  oldPath: string,
  newPath: string
) => {
  if (!oldPath?.trim() || !newPath?.trim()) throw new Error("Invalid paths.");
  return runDefenderCommand(
    `Remove-MpPreference -ExclusionPath '${oldPath}'; Add-MpPreference -ExclusionPath '${newPath}'`
  );
};

registerEvent("addWindowsDefenderExclusion", addWindowsDefenderExclusion);
registerEvent("removeWindowsDefenderExclusion", removeWindowsDefenderExclusion);
registerEvent("updateWindowsDefenderExclusion", updateWindowsDefenderExclusion);
