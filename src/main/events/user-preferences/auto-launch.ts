import { registerEvent } from "../register-event";
import AutoLaunch from "auto-launch";

const autoLaunch = async (
  _event: Electron.IpcMainInvokeEvent,
  enabled: boolean
) => {
  const appLauncher = new AutoLaunch({
    name: "Hydra",
  });
  if (enabled) {
    appLauncher
      .enable()
      .catch((err) => console.error("Error enabling auto-launch:", err));
  } else {
    appLauncher
      .disable()
      .catch((err) => console.error("Error disabling auto-launch:", err));
  }
};

registerEvent(autoLaunch, {
  name: "autoLaunch",
});
