import { defaultDownloadsPath } from "@main/constants";
import { isDocPortalPath, isFlatpak } from "@main/helpers/sandbox";
import { db, levelKeys } from "@main/level";
import { logger, PathGrants } from "@main/services";
import type { UserPreferences } from "@types";

export const getDownloadsPath = async () => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (userPreferences?.downloadsPath) {
    const { downloadsPath } = userPreferences;

    // A portal-granted downloads folder can become unreachable when the
    // grant is revoked; fall back to the default instead of failing writes.
    if (
      isFlatpak &&
      isDocPortalPath(downloadsPath) &&
      !(await PathGrants.verifyAccess(downloadsPath))
    ) {
      logger.warn(
        `Downloads path ${downloadsPath} is no longer accessible; falling back to default`
      );
      return defaultDownloadsPath;
    }

    return downloadsPath;
  }

  return defaultDownloadsPath;
};
