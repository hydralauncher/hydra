export const STEAM_COMMUNITY_ORIGIN = "https://steamcommunity.com";

export const shouldFetchSteamCommunityAchievements = (
  playTimeInSeconds: number
) => playTimeInSeconds > 0;

const throwCommunityHttpError = (status: number, body: unknown) => {
  const error = new Error(`steam-web-api-http-${status}`) as Error & {
    status: number;
    body: unknown;
  };
  error.name = "SteamWebApiHttpError";
  error.status = status;
  error.body = body;
  throw error;
};

const throwCommunitySessionRequired = () => {
  const error = new Error("steam-session-required");
  error.name = "SteamSessionRequiredError";
  throw error;
};

const STEAM_UNLOCK_MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

export type SteamCommunityHtmlUnlock = {
  displayName: string;
  description: string;
  iconHash: string | null;
  unlockTime: string;
};

type SteamGameAchievementSchemaItem = {
  internalName: string;
  localizedName: string;
  localizedDesc: string;
  icon: string;
  iconHash: string | null;
  hidden: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeXmlText = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

const xmlTagValue = (block: string, tag: string) => {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return match ? decodeXmlText(match[1]) : "";
};

const iconHashFromUrl = (value: string) => {
  const match = /(?:\/|^)([a-f0-9]{16,})\.[a-z]+(?:\?|$)/i.exec(value);
  return match ? match[1].toLowerCase() : null;
};

const playerstatsPayload = (
  achievements: { apiname: string; achieved: number; unlocktime: number }[]
) => ({
  playerstats: { achievements },
});

export const parseSteamTimezoneOffsetSeconds = (
  value: string | null | undefined
) => {
  if (!value) return 0;
  const match = /^-?\d+/.exec(value);
  return match ? Number(match[0]) : 0;
};

export const isSteamCommunityLoginUrl = (url: string) =>
  url.includes("login.steampowered.com") ||
  /(?:^|[/.])login(?:[/?#]|$)/i.test(url);

export const isSteamCommunityPlayerstatsXml = (body: string) =>
  /<playerstats[\s>]/i.test(body);

export const isSteamCommunityPrivateStatsXml = (body: string) =>
  /<privacyState>\s*private\s*<\/privacyState>/i.test(body) &&
  !/<achievement\b/i.test(body);

export const isSteamCommunityLoginPage = (url: string, body: string) => {
  if (isSteamCommunityLoginUrl(url)) return true;
  if (isSteamCommunityPlayerstatsXml(body)) return false;
  if (/\bachieveRow\b/.test(body)) return false;
  return /login\.steampowered\.com/i.test(body) && /sign in/i.test(body);
};

export const parseSteamUnlockTimeText = (
  text: string,
  timeZoneOffsetSeconds = 0,
  nowMs = Date.now()
): string | null => {
  const dayFirst =
    /Unlocked\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:,?\s+(\d{4}))?\s+@\s+(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(
      text
    );
  const monthFirst =
    /Unlocked\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?\s+@\s+(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(
      text
    );

  let day: number;
  let monthName: string;
  let year: number | null;
  let hour: number;
  let minute: number;
  let meridiem: string;

  if (dayFirst) {
    day = Number(dayFirst[1]);
    monthName = dayFirst[2];
    year = dayFirst[3] ? Number(dayFirst[3]) : null;
    hour = Number(dayFirst[4]);
    minute = Number(dayFirst[5]);
    meridiem = dayFirst[6];
  } else if (monthFirst) {
    monthName = monthFirst[1];
    day = Number(monthFirst[2]);
    year = monthFirst[3] ? Number(monthFirst[3]) : null;
    hour = Number(monthFirst[4]);
    minute = Number(monthFirst[5]);
    meridiem = monthFirst[6];
  } else {
    return null;
  }

  const month = STEAM_UNLOCK_MONTHS[monthName.slice(0, 3)];
  if (month == null || !Number.isFinite(day)) {
    return null;
  }

  const meridiemLower = meridiem.toLowerCase();
  if (meridiemLower === "pm" && hour < 12) hour += 12;
  if (meridiemLower === "am" && hour === 12) hour = 0;

  if (year == null) {
    year = new Date(nowMs).getUTCFullYear();
    const guessed =
      Date.UTC(year, month, day, hour, minute) - timeZoneOffsetSeconds * 1000;
    if (guessed > nowMs + 24 * 60 * 60 * 1000) {
      year -= 1;
    }
  }

  if (!Number.isFinite(year)) return null;

  const utcMs =
    Date.UTC(year, month, day, hour, minute) - timeZoneOffsetSeconds * 1000;
  return new Date(utcMs).toISOString();
};

export const parseSteamCommunityAchievementsXml = (xml: string) => {
  const blocks = xml.split(/<achievement\b/i).slice(1);

  return playerstatsPayload(
    blocks.flatMap((block) => {
      const apiname = xmlTagValue(block, "apiname");
      if (!apiname) return [];

      const closed = /closed\s*=\s*["']1["']/i.test(block);
      const unlockUnix = Number(xmlTagValue(block, "unlockTimestamp"));

      return [
        {
          apiname,
          achieved: closed ? 1 : 0,
          unlocktime: Number.isFinite(unlockUnix) ? unlockUnix : 0,
        },
      ];
    })
  );
};

export const parseSteamCommunityAchievementHtml = (
  html: string,
  timeZoneOffsetSeconds = 0
): SteamCommunityHtmlUnlock[] => {
  const chunks = html.split(/<div(?=[^>]*\bachieveRow\b)/i).slice(1);

  return chunks.flatMap((chunk) => {
    const window = chunk.slice(0, 5000);
    const displayName = decodeXmlText(
      /<h3 class="ellipsis">([\s\S]*?)<\/h3>/i.exec(window)?.[1] ?? ""
    );
    const unlockText = /<div class="achieveUnlockTime">([\s\S]*?)<\/div>/i.exec(
      window
    )?.[1];
    if (!displayName || !unlockText) return [];

    const unlockTime = parseSteamUnlockTimeText(
      unlockText.replace(/<br\s*\/?>/gi, " "),
      timeZoneOffsetSeconds
    );
    if (!unlockTime) return [];

    const imageSrc = /<img[^>]+src="([^"]+)"/i.exec(window)?.[1] ?? "";

    return [
      {
        displayName,
        description: decodeXmlText(
          /<h5>([\s\S]*?)<\/h5>/i.exec(window)?.[1] ?? ""
        ),
        iconHash: iconHashFromUrl(imageSrc),
        unlockTime,
      },
    ];
  });
};

export const parseSteamGameAchievementSchema = (
  payload: unknown
): SteamGameAchievementSchemaItem[] => {
  const root = isRecord(payload)
    ? isRecord(payload.response)
      ? payload.response
      : payload
    : null;
  const achievements =
    root && Array.isArray(root.achievements) ? root.achievements : [];

  return achievements.flatMap((item) => {
    if (!isRecord(item)) return [];
    const internalName = String(item.internal_name ?? "").trim();
    if (!internalName) return [];

    const icon = String(item.icon ?? item.icon_gray ?? "").trim();
    return [
      {
        internalName,
        localizedName: String(item.localized_name ?? "").trim(),
        localizedDesc: String(item.localized_desc ?? "").trim(),
        icon,
        iconHash: iconHashFromUrl(icon),
        hidden: Boolean(item.hidden),
      },
    ];
  });
};

export const mapCommunityHtmlToPlayerstats = (
  unlocks: SteamCommunityHtmlUnlock[],
  schema: SteamGameAchievementSchemaItem[]
) => {
  const used = new Set<string>();

  return playerstatsPayload(
    unlocks.flatMap((unlock) => {
      const byIcon = unlock.iconHash
        ? schema.find(
            (item) =>
              item.iconHash === unlock.iconHash && !used.has(item.internalName)
          )
        : undefined;
      const byName =
        byIcon ??
        schema.find(
          (item) =>
            item.localizedName === unlock.displayName &&
            !used.has(item.internalName)
        );
      const byDesc =
        byName ??
        (unlock.description
          ? schema.find(
              (item) =>
                item.localizedDesc === unlock.description &&
                !used.has(item.internalName)
            )
          : undefined);

      if (!byDesc) return [];
      used.add(byDesc.internalName);

      return [
        {
          apiname: byDesc.internalName,
          achieved: 1,
          unlocktime: Math.trunc(Date.parse(unlock.unlockTime) / 1000),
        },
      ];
    })
  );
};

const readResponseText = async (response: Response) => {
  const body = await response.text();
  if (!response.ok) {
    throwCommunityHttpError(response.status, body);
  }
  return body;
};

const throwIfCommunityLogin = (url: string, body: string) => {
  if (isSteamCommunityLoginPage(url, body)) {
    throwCommunitySessionRequired();
  }
};

export const steamCommunityStatsXmlUrl = (
  steamId64: string,
  steamAppId: string
) =>
  `${STEAM_COMMUNITY_ORIGIN}/profiles/${steamId64}/stats/${steamAppId}/?xml=1`;

export const steamCommunityStatsHtmlUrl = (
  steamId64: string,
  steamAppId: string
) =>
  `${STEAM_COMMUNITY_ORIGIN}/profiles/${steamId64}/stats/${steamAppId}/achievements?l=english`;

export const steamCommunityOwnerStatsHtmlUrl = (steamAppId: string) =>
  `${STEAM_COMMUNITY_ORIGIN}/my/stats/${steamAppId}`;

export const catalogueFromSteamSchema = (
  steamAppId: string,
  payload: unknown
) =>
  parseSteamGameAchievementSchema(payload).map((item) => {
    const icon = steamAchievementIconUrl(steamAppId, item.icon);
    return {
      name: item.internalName,
      displayName: item.localizedName || item.internalName,
      description: item.localizedDesc || undefined,
      icon,
      icongray: icon,
      hidden: item.hidden,
    };
  });

export const steamAchievementIconUrl = (steamAppId: string, icon: string) => {
  if (!icon) return "";
  if (/^https?:\/\//i.test(icon)) return icon;
  const file = icon.includes(".") ? icon : `${icon}.jpg`;
  return `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${steamAppId}/${file}`;
};

export const fetchSteamCommunityPlayerAchievements = async ({
  steamId64,
  steamAppId,
  signal,
  communityFetch = fetch,
  loadSchema,
  timeZoneOffsetSeconds = 0,
}: {
  steamId64: string;
  steamAppId: string;
  signal?: AbortSignal;
  communityFetch?: typeof fetch;
  loadSchema: (steamAppId: string) => Promise<unknown>;
  timeZoneOffsetSeconds?: number;
}): Promise<unknown> => {
  const readHtml = async (url: string) => {
    const response = await communityFetch(url, { signal, redirect: "follow" });
    const body = await readResponseText(response);
    throwIfCommunityLogin(response.url, body);
    return body;
  };

  const mapUnlocks = async (htmlBody: string) => {
    const unlocks = parseSteamCommunityAchievementHtml(
      htmlBody,
      timeZoneOffsetSeconds
    );
    if (unlocks.length === 0) return null;
    const schema = parseSteamGameAchievementSchema(
      await loadSchema(steamAppId)
    );
    return mapCommunityHtmlToPlayerstats(unlocks, schema);
  };

  const profileHtml = await readHtml(
    steamCommunityStatsHtmlUrl(steamId64, steamAppId)
  );
  const fromProfile = await mapUnlocks(profileHtml);
  if (fromProfile) return fromProfile;

  const ownerHtml = await readHtml(steamCommunityOwnerStatsHtmlUrl(steamAppId));
  const fromOwner = await mapUnlocks(ownerHtml);
  if (fromOwner) return fromOwner;

  if (/\bachieveRow\b/.test(profileHtml) || /\bachieveRow\b/.test(ownerHtml)) {
    return playerstatsPayload([]);
  }

  const xmlBody = await readHtml(
    steamCommunityStatsXmlUrl(steamId64, steamAppId)
  );
  if (
    isSteamCommunityPlayerstatsXml(xmlBody) &&
    !isSteamCommunityPrivateStatsXml(xmlBody)
  ) {
    return parseSteamCommunityAchievementsXml(xmlBody);
  }

  return playerstatsPayload([]);
};
