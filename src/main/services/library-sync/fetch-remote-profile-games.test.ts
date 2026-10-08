import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchRemoteProfileGames } from "./fetch-remote-profile-games.ts";

describe("remote profile library fetching", () => {
  it("reads visible and hidden games separately for PC and classics", async () => {
    const calls: Array<{ path: string; params: Record<string, unknown> }> = [];

    const games = await fetchRemoteProfileGames(async (path, params) => {
      calls.push({ path, params });
      const collection = path.endsWith("/hidden") ? "hidden" : "visible";
      return [`${collection}-${params.shop ?? "pc"}`];
    });

    assert.deepEqual(games, [
      "visible-pc",
      "visible-launchbox",
      "hidden-pc",
      "hidden-launchbox",
    ]);
    assert.deepEqual(calls, [
      { path: "/profile/games", params: { take: 100, skip: 0 } },
      {
        path: "/profile/games",
        params: { shop: "launchbox", take: 100, skip: 0 },
      },
      { path: "/profile/games/hidden", params: { take: 100, skip: 0 } },
      {
        path: "/profile/games/hidden",
        params: { shop: "launchbox", take: 100, skip: 0 },
      },
    ]);
  });

  it("keeps hidden endpoints and shop filters across concurrent pages", async () => {
    const visible = Array.from({ length: 230 }, (_, i) => `visible-${i}`);
    const hidden = Array.from({ length: 421 }, (_, i) => `hidden-${i}`);
    const hiddenClassics = Array.from(
      { length: 102 },
      (_, i) => `classics-${i}`
    );
    let activeHiddenRequests = 0;
    let maxHiddenRequests = 0;

    const games = await fetchRemoteProfileGames(async (path, params) => {
      const isHidden = path === "/profile/games/hidden";
      const isClassics = params.shop === "launchbox";
      const trackConcurrency = isHidden && !isClassics;
      if (trackConcurrency) {
        activeHiddenRequests++;
        maxHiddenRequests = Math.max(maxHiddenRequests, activeHiddenRequests);
      }

      await new Promise<void>((resolve) => setImmediate(resolve));

      if (trackConcurrency) activeHiddenRequests--;
      const source = isHidden
        ? isClassics
          ? hiddenClassics
          : hidden
        : isClassics
          ? []
          : visible;
      const skip = params.skip as number;
      return source.slice(skip, skip + (params.take as number));
    });

    assert.deepEqual(games, [...visible, ...hidden, ...hiddenClassics]);
    assert.equal(maxHiddenRequests, 3);
  });

  it("keeps the visible library when optional endpoints are unavailable", async () => {
    const games = await fetchRemoteProfileGames(async (path, params) => {
      if (path === "/profile/games/hidden") {
        throw Object.assign(new Error("Not found"), {
          response: { status: 404 },
        });
      }
      if (params.shop === "launchbox") throw new Error("Classics unavailable");
      return ["visible-pc"];
    });

    assert.deepEqual(games, ["visible-pc"]);
  });

  it("rejects failed hidden reads instead of treating hidden imports as removed", async () => {
    for (const status of [401, 500]) {
      const failure = Object.assign(new Error("Hidden library unavailable"), {
        response: { status },
      });

      await assert.rejects(
        fetchRemoteProfileGames(async (path) => {
          if (path === "/profile/games/hidden") throw failure;
          return ["visible-pc"];
        }),
        (error) => error === failure
      );
    }
  });
});
