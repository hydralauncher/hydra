import { userPreferencesRepository } from "@main/repository";
import { defaultDownloadsPath } from "@main/constants";

export const getDownloadsPath = async () => {
  const userPreferences = await userPreferencesRepository.findOne({
    where: {
      id: 1,
    },
  });

  if (userPreferences && userPreferences.downloadsPath)
    return userPreferences.downloadsPath;

  return defaultDownloadsPath;
};
