import { userClientPreferencesRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const getUserClientPreferences = async () =>
  userClientPreferencesRepository.findOne({
    where: { id: 1 },
  });

registerEvent("getUserClientPreferences", getUserClientPreferences);
