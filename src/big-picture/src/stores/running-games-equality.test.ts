import assert from "node:assert/strict";
import { it } from "node:test";

import { hasSameRunningGames } from "./running-games-equality.js";

it("treats an unchanged running games list as the same", () => {
  assert.equal(hasSameRunningGames({}, []), true);
  assert.equal(
    hasSameRunningGames(
      { game: { id: "game", sessionDurationInMillis: 1000 } },
      [{ id: "game", sessionDurationInMillis: 1000 }]
    ),
    true
  );
});

it("detects started, stopped and updated running games", () => {
  const running = { game: { id: "game", sessionDurationInMillis: 1000 } };

  assert.equal(
    hasSameRunningGames({}, [{ id: "game", sessionDurationInMillis: 0 }]),
    false
  );
  assert.equal(hasSameRunningGames(running, []), false);
  assert.equal(
    hasSameRunningGames(running, [
      { id: "game", sessionDurationInMillis: 2000 },
    ]),
    false
  );
  assert.equal(
    hasSameRunningGames(running, [
      { id: "other", sessionDurationInMillis: 1000 },
    ]),
    false
  );
});
