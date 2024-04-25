import { userPreferencesRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const getUserPreferences = async () =>
  userPreferencesRepository.findOne({
    where: { id: 1 },
  });

registerEvent(getUserPreferences, {
  name: "getUserPreferences",
});
