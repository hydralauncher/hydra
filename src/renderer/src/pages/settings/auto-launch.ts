import AutoLaunch from "auto-launch";

export const autoLaunch = () => {
  Promise.all([window.electron.getUserPreferences()]).then(
    (userPreferences) => {
      if (userPreferences && userPreferences.length > 0) {
        const appLauncher = new AutoLaunch({
          name: "Hydra",
        });
        if (userPreferences[0]?.startWithSystem) {
          appLauncher
            .enable()
            .catch((err) => console.error("Error enabling auto-launch:", err));
        } else {
          appLauncher
            .disable()
            .catch((err) => console.error("Error disabling auto-launch:", err));
        }
      }
    }
  );
};
