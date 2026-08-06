import assert from "node:assert/strict";
import test from "node:test";

import type { Game } from "@types";
import { resolveActiveOverlayGame } from "./overlay-active-game.js";

const game = (objectId: string) =>
  ({ shop: "steam", objectId, title: objectId }) as Game;

test("keeps the current overlay game while its session is running", () => {
  const first = game("1");
  const second = game("2");
  const sessions = new Map([
    ["steam:1", { firstTick: 1 }],
    ["steam:2", { firstTick: 2 }],
  ]);

  assert.equal(
    resolveActiveOverlayGame([first, second], sessions, first),
    first
  );
});

test("moves the overlay to the newest remaining game", () => {
  const first = game("1");
  const second = game("2");
  const sessions = new Map([["steam:2", { firstTick: 2 }]]);

  assert.equal(
    resolveActiveOverlayGame([first, second], sessions, first),
    second
  );
  assert.equal(resolveActiveOverlayGame([first], new Map(), first), null);
});
