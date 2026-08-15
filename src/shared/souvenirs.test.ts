import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProfileSouvenirVisibilityPath,
  buildUserSouvenirLikePath,
  buildUserSouvenirsPath,
  getSouvenirKey,
  getSouvenirVisualVariant,
} from "./souvenirs.js";

describe("souvenir API helpers", () => {
  it("builds an encoded paginated feed path", () => {
    const path = buildUserSouvenirsPath({
      userId: "user/id",
      skip: 24,
      sortBy: "rare",
      language: "pt-BR",
    });

    const [pathname, query] = path.split("?");
    const params = new URLSearchParams(query);

    assert.equal(pathname, "/users/user%2Fid/souvenirs");
    assert.equal(params.get("take"), "24");
    assert.equal(params.get("skip"), "24");
    assert.equal(params.get("sortBy"), "rare");
    assert.equal(params.get("language"), "pt-BR");
    assert.deepEqual(params.getAll("shop"), ["steam", "launchbox"]);
  });

  it("keeps souvenir identities stable across game and achievement names", () => {
    assert.notEqual(
      getSouvenirKey("game:a", "achievement"),
      getSouvenirKey("game", "a:achievement")
    );
  });

  it("encodes every mutable souvenir path segment", () => {
    assert.equal(
      buildUserSouvenirLikePath("owner/id", "game/id", "name/value"),
      "/users/owner%2Fid/souvenirs/game%2Fid/name%2Fvalue/like"
    );
    assert.equal(
      buildProfileSouvenirVisibilityPath("game/id", "name/value"),
      "/profile/games/achievements/game%2Fid/name%2Fvalue/image/visibility"
    );
  });

  it("uses the platinum design when a souvenir is both rare and platinum", () => {
    assert.equal(
      getSouvenirVisualVariant({ isRare: true, isPlatinum: true }),
      "platinum"
    );
    assert.equal(
      getSouvenirVisualVariant({ isRare: true, isPlatinum: false }),
      "rare"
    );
    assert.equal(
      getSouvenirVisualVariant({ isRare: false, isPlatinum: false }),
      null
    );
  });
});
