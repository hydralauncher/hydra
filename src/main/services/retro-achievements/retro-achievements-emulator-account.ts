import axios from "axios";
import { safeStorage } from "electron";

import type { UserPreferences } from "@types";
import { appVersion } from "@main/constants";
import { db, levelKeys } from "@main/level";

export interface RetroAchievementsEmulatorAccount {
  username: string;
  token: string;
}

interface StoredRetroAchievementsEmulatorAccount {
  username: string;
  token: string;
  encrypted: boolean;
}

interface RetroAchievementsLoginResponse {
  Success?: boolean;
  User?: unknown;
  Token?: unknown;
}

const RETROACHIEVEMENTS_DOREQUEST_URL =
  "https://retroachievements.org/dorequest.php";
const RETROACHIEVEMENTS_LOGIN_TIMEOUT_MS = 15_000;

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
};

const getUserAgent = () =>
  `Hydra/${appVersion} (${PLATFORM_NAMES[process.platform] ?? process.platform})`;

export const requestRetroAchievementsConnectToken = async (
  username: string,
  password: string
): Promise<RetroAchievementsEmulatorAccount> => {
  const response = await axios.post<RetroAchievementsLoginResponse>(
    RETROACHIEVEMENTS_DOREQUEST_URL,
    new URLSearchParams({ r: "login2", u: username, p: password }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": getUserAgent(),
      },
      timeout: RETROACHIEVEMENTS_LOGIN_TIMEOUT_MS,
    }
  );

  const { Success, User, Token } = response.data ?? {};
  if (!Success || typeof User !== "string" || typeof Token !== "string") {
    throw new Error("RetroAchievements did not return a connect token");
  }

  return { username: User, token: Token };
};

export const saveRetroAchievementsEmulatorAccount = async (
  account: RetroAchievementsEmulatorAccount
) => {
  const encrypted = safeStorage.isEncryptionAvailable();

  await db.put<string, StoredRetroAchievementsEmulatorAccount>(
    levelKeys.retroAchievementsEmulatorAccount,
    {
      username: account.username,
      token: encrypted
        ? safeStorage.encryptString(account.token).toString("base64")
        : account.token,
      encrypted,
    },
    { valueEncoding: "json" }
  );
};

const readStoredAccount = () =>
  db
    .get<
      string,
      StoredRetroAchievementsEmulatorAccount | null
    >(levelKeys.retroAchievementsEmulatorAccount, { valueEncoding: "json" })
    .catch(() => null);

export const loadRetroAchievementsEmulatorAccount =
  async (): Promise<RetroAchievementsEmulatorAccount | null> => {
    const [stored, userPreferences] = await Promise.all([
      readStoredAccount(),
      db
        .get<string, UserPreferences | null>(levelKeys.userPreferences, {
          valueEncoding: "json",
        })
        .catch(() => null),
    ]);

    if (!stored?.username || !stored.token) return null;
    if (
      !userPreferences?.retroAchievementsWebApiKey ||
      userPreferences.retroAchievementsUsername?.toLowerCase() !==
        stored.username.toLowerCase()
    ) {
      return null;
    }

    try {
      return {
        username: stored.username,
        token: stored.encrypted
          ? safeStorage.decryptString(Buffer.from(stored.token, "base64"))
          : stored.token,
      };
    } catch {
      return null;
    }
  };

export const deleteRetroAchievementsEmulatorAccount = async () => {
  await db
    .del(levelKeys.retroAchievementsEmulatorAccount)
    .catch(() => undefined);
};
