import { registerEvent } from "../register-event";
import sudo from "sudo-prompt";

const runDefenderCommand = (psScript: string): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      return reject(new Error("This feature is only available on Windows."));
    }

    const b64Script = Buffer.from(psScript, "utf-8").toString("base64");
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${b64Script}`;

    sudo.exec(command, { name: "Hydra Launcher" }, (error) => {
      if (error) {
        return reject(error);
      }
      resolve(true);
    });
  });
};

const getPsString = (str: string) => {
  const b64 = Buffer.from(str, "utf-8").toString("base64");
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))`;
};

const addWindowsDefenderExclusion = async (
  _event: Electron.IpcMainInvokeEvent,
  exclusionPath: string
) => {
  if (!exclusionPath?.trim()) throw new Error("Invalid path.");
  return runDefenderCommand(
    `Add-MpPreference -ExclusionPath ${getPsString(exclusionPath)}`
  );
};

const removeWindowsDefenderExclusion = async (
  _event: Electron.IpcMainInvokeEvent,
  exclusionPath: string
) => {
  if (!exclusionPath?.trim()) throw new Error("Invalid path.");
  return runDefenderCommand(
    `Remove-MpPreference -ExclusionPath ${getPsString(exclusionPath)}`
  );
};

const updateWindowsDefenderExclusion = async (
  _event: Electron.IpcMainInvokeEvent,
  oldPath: string,
  newPath: string
) => {
  if (!oldPath?.trim() || !newPath?.trim()) throw new Error("Invalid paths.");
  return runDefenderCommand(
    `Remove-MpPreference -ExclusionPath ${getPsString(oldPath)}; Add-MpPreference -ExclusionPath ${getPsString(newPath)}`
  );
};

registerEvent("addWindowsDefenderExclusion", addWindowsDefenderExclusion);
registerEvent("removeWindowsDefenderExclusion", removeWindowsDefenderExclusion);
registerEvent("updateWindowsDefenderExclusion", updateWindowsDefenderExclusion);
