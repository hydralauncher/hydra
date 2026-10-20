import { registerEvent } from "../register-event";
import { logger } from "@main/services";
import {
  loadStoredRetroAchievementsEmulatorUsername,
  requestRetroAchievementsConnectToken,
  saveRetroAchievementsEmulatorAccount,
} from "@main/services/retro-achievements/retro-achievements-emulator-account";
import {
  clearRetroAchievementsEmulatorCredentials,
  syncRetroAchievementsEmulatorCredentials,
} from "@main/services/retro-achievements/emulator-credentials/emulator-credential-sync";

const linkRetroAchievementsEmulatorAccount = async (
  _event: Electron.IpcMainInvokeEvent,
  username: string,
  password: string
) => {
  try {
    const account = await requestRetroAchievementsConnectToken(
      username,
      password
    );
    const previousUsername =
      await loadStoredRetroAchievementsEmulatorUsername();

    if (
      previousUsername &&
      previousUsername.toLowerCase() !== account.username.toLowerCase()
    ) {
      await clearRetroAchievementsEmulatorCredentials(previousUsername);
    }

    await saveRetroAchievementsEmulatorAccount(account);
    void syncRetroAchievementsEmulatorCredentials();
    return true;
  } catch (error) {
    logger.error(
      "Failed to link RetroAchievements account to emulators",
      error
    );
    return false;
  }
};

registerEvent(
  "linkRetroAchievementsEmulatorAccount",
  linkRetroAchievementsEmulatorAccount
);
