import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  fetchSteamCommunityPlayerAchievements,
  isSteamCommunityLoginPage,
  isSteamCommunityPrivateStatsXml,
  mapCommunityHtmlToPlayerstats,
  parseSteamCommunityAchievementHtml,
  parseSteamCommunityAchievementsXml,
  parseSteamGameAchievementSchema,
  parseSteamTimezoneOffsetSeconds,
  parseSteamUnlockTimeText,
  shouldFetchSteamCommunityAchievements,
  steamCommunityOwnerStatsHtmlUrl,
  steamCommunityStatsHtmlUrl,
  steamCommunityStatsXmlUrl,
} from "./steam-community-achievements.ts";
const token = {
  steamId64: "76561199208012825",
  accessToken: "store-token",
};

const unlockedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<playerstats>
  <privacyState>public</privacyState>
  <achievements>
    <achievement closed="1">
      <name>Welcome to the City of the Dead</name>
      <apiname>NEW_ACHIEVEMENT_1_1</apiname>
      <unlockTimestamp>1742405280</unlockTimestamp>
    </achievement>
    <achievement closed="0">
      <name>Locked</name>
      <apiname>LOCKED</apiname>
    </achievement>
  </achievements>
</playerstats>`;

const privateXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<playerstats>
  <privacyState>private</privacyState>
  <visibilityState>1</visibilityState>
</playerstats>`;

const statsHtml = `
<div id="personalAchieve" class="achievements_list">
  <div role="button" class="achieveRow">
    <div class="achieveImgHolder">
      <img src="https://shared.fastly.steamstatic.com/community_assets/images/apps/883710/61eab059da93026fdff6dd4597ee87c5939f0929.jpg">
    </div>
    <div class="achieveTxtHolder">
      <div class="achieveTxt">
        <h3 class="ellipsis">Welcome to the City of the Dead</h3>
        <h5>Make it to the police station.</h5>
      </div>
      <div class="achieveUnlockTime">
        Unlocked 19 Mar, 2025 @ 6:28pm<br/>
      </div>
    </div>
  </div>
  <div role="button" class="achieveRow">
    <div class="achieveImgHolder">
      <img src="https://shared.fastly.steamstatic.com/community_assets/images/apps/883710/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg">
    </div>
    <div class="achieveTxtHolder">
      <div class="achieveTxt">
        <h3 class="ellipsis">Still locked</h3>
        <h5>Hidden.</h5>
      </div>
    </div>
  </div>
</div>`;

const schemaPayload = {
  response: {
    achievements: [
      {
        internal_name: "NEW_ACHIEVEMENT_1_1",
        localized_name: "Welcome to the City of the Dead",
        localized_desc: "Make it to the police station.",
        icon: "61eab059da93026fdff6dd4597ee87c5939f0929.jpg",
      },
    ],
  },
};

const textResponse = (status: number, body: string, url = "") => {
  const response = new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
};

describe("shouldFetchSteamCommunityAchievements", () => {
  it("skips community scrape when there is no playtime", () => {
    assert.equal(shouldFetchSteamCommunityAchievements(0), false);
    assert.equal(shouldFetchSteamCommunityAchievements(-1), false);
  });

  it("scrapes community when the account has playtime", () => {
    assert.equal(shouldFetchSteamCommunityAchievements(1), true);
    assert.equal(shouldFetchSteamCommunityAchievements(3600), true);
  });
});

describe("Steam community achievement parsers", () => {
  it("reads unlocked XML rows by apiname and unlockTimestamp", () => {
    assert.deepEqual(parseSteamCommunityAchievementsXml(unlockedXml), {
      playerstats: {
        achievements: [
          {
            apiname: "NEW_ACHIEVEMENT_1_1",
            achieved: 1,
            unlocktime: 1742405280,
          },
          { apiname: "LOCKED", achieved: 0, unlocktime: 0 },
        ],
      },
    });
  });

  it("detects private XML without achievement nodes", () => {
    assert.equal(isSteamCommunityPrivateStatsXml(privateXml), true);
    assert.equal(isSteamCommunityPrivateStatsXml(unlockedXml), false);
  });

  it("parses owner HTML unlock rows and ignores locked rows", () => {
    const unlocks = parseSteamCommunityAchievementHtml(statsHtml, -10800);

    assert.equal(unlocks.length, 1);
    assert.equal(unlocks[0].displayName, "Welcome to the City of the Dead");
    assert.equal(
      unlocks[0].iconHash,
      "61eab059da93026fdff6dd4597ee87c5939f0929"
    );
    assert.equal(unlocks[0].unlockTime, "2025-03-19T21:28:00.000Z");
  });

  it("parses month-first unlock timestamps", () => {
    assert.equal(
      parseSteamUnlockTimeText("Unlocked Mar 19, 2025 @ 6:28pm", 0),
      "2025-03-19T18:28:00.000Z"
    );
  });

  it("parses unlock timestamps that omit the year", () => {
    assert.equal(
      parseSteamUnlockTimeText(
        "Unlocked 25 Feb @ 3:27pm",
        -10800,
        Date.UTC(2026, 8, 10)
      ),
      "2026-02-25T18:27:00.000Z"
    );
  });

  it("maps HTML unlocks to schema internal names", () => {
    const unlocks = parseSteamCommunityAchievementHtml(statsHtml, 0);
    const payload = mapCommunityHtmlToPlayerstats(
      unlocks,
      parseSteamGameAchievementSchema(schemaPayload)
    );

    assert.deepEqual(payload.playerstats.achievements, [
      {
        apiname: "NEW_ACHIEVEMENT_1_1",
        achieved: 1,
        unlocktime: Date.parse(unlocks[0].unlockTime) / 1000,
      },
    ]);
  });

  it("reads timezone offsets from the Steam cookie value", () => {
    assert.equal(parseSteamTimezoneOffsetSeconds("-10800,0"), -10800);
    assert.equal(parseSteamTimezoneOffsetSeconds(undefined), 0);
  });

  it("detects Steam login pages", () => {
    assert.equal(
      isSteamCommunityLoginPage("https://login.steampowered.com/openid", ""),
      true
    );
    assert.equal(
      isSteamCommunityLoginPage(
        "https://steamcommunity.com/id/x/stats/1",
        statsHtml
      ),
      false
    );
  });
});

describe("fetchSteamCommunityPlayerAchievements", () => {
  it("uses public XML when the owner HTML page has no achievement rows", async () => {
    const payload = await fetchSteamCommunityPlayerAchievements({
      steamId64: token.steamId64,
      steamAppId: "883710",
      loadSchema: async () => {
        throw new Error("schema should not be loaded for public XML");
      },
      communityFetch: (input) => {
        const url = String(input);
        if (url.includes("xml=1")) {
          assert.equal(
            url,
            steamCommunityStatsXmlUrl(token.steamId64, "883710")
          );
          return Promise.resolve(textResponse(200, unlockedXml, url));
        }
        if (url.includes("/my/stats/")) {
          assert.equal(url, steamCommunityOwnerStatsHtmlUrl("883710"));
          return Promise.resolve(textResponse(200, "<html></html>", url));
        }
        assert.equal(
          url,
          steamCommunityStatsHtmlUrl(token.steamId64, "883710")
        );
        return Promise.resolve(textResponse(200, "<html></html>", url));
      },
    });

    assert.equal(
      (payload as { playerstats: { achievements: unknown[] } }).playerstats
        .achievements.length,
      2
    );
  });

  it("reads owner HTML and schema first", async () => {
    const payload = await fetchSteamCommunityPlayerAchievements({
      steamId64: token.steamId64,
      steamAppId: "883710",
      timeZoneOffsetSeconds: -10800,
      loadSchema: async (steamAppId) => {
        assert.equal(steamAppId, "883710");
        return schemaPayload;
      },
      communityFetch: (input) => {
        const url = String(input);
        assert.equal(
          url,
          steamCommunityStatsHtmlUrl(token.steamId64, "883710")
        );
        return Promise.resolve(textResponse(200, statsHtml, url));
      },
    });

    assert.deepEqual(
      (payload as { playerstats: { achievements: { apiname: string }[] } })
        .playerstats.achievements,
      [
        {
          apiname: "NEW_ACHIEVEMENT_1_1",
          achieved: 1,
          unlocktime: Date.parse("2025-03-19T21:28:00.000Z") / 1000,
        },
      ]
    );
  });

  it("does not fall back to XML when owner HTML has rows without unlock times", async () => {
    const payload = await fetchSteamCommunityPlayerAchievements({
      steamId64: token.steamId64,
      steamAppId: "883710",
      loadSchema: async () => {
        throw new Error("schema should not be loaded without unlock rows");
      },
      communityFetch: (input) => {
        const url = String(input);
        const emptyRows = `<div class="achieveRow"><h3 class="ellipsis">Locked</h3></div>`;
        if (url.includes("/my/stats/")) {
          return Promise.resolve(textResponse(200, emptyRows, url));
        }
        assert.equal(
          url,
          steamCommunityStatsHtmlUrl(token.steamId64, "883710")
        );
        return Promise.resolve(textResponse(200, emptyRows, url));
      },
    });

    assert.deepEqual(
      (payload as { playerstats: { achievements: unknown[] } }).playerstats
        .achievements,
      []
    );
  });

  it("throws when community redirects to login", async () => {
    await assert.rejects(
      () =>
        fetchSteamCommunityPlayerAchievements({
          steamId64: token.steamId64,
          steamAppId: "883710",
          loadSchema: async () => ({}),
          communityFetch: () =>
            Promise.resolve(
              textResponse(
                200,
                "<html><title>Sign In</title></html>",
                "https://login.steampowered.com/"
              )
            ),
        }),
      (error: unknown) =>
        error instanceof Error && error.name === "SteamSessionRequiredError"
    );
  });
});
