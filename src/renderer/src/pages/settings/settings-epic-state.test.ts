import assert from "node:assert/strict";
import test from "node:test";
import type { EpicConnectionState } from "../../../../types/epic-integration.types.js";
import {
  getEpicIntegrationPresentation,
  isEpicStateForUser,
} from "./settings-epic-state.js";

const state = (
  overrides: Partial<EpicConnectionState> = {}
): EpicConnectionState => ({
  hydraLoggedIn: true,
  hydraUserId: "A",
  availability: { available: true },
  connection: {
    connected: true,
    connectionId: "HashId",
    epicAccountId: "a".repeat(32),
    displayName: "Epic",
    connectedAt: "2026-10-07T12:00:00Z",
  },
  verification: "confirmed",
  sessionState: "ready",
  operation: null,
  ...overrides,
});

test("offline and missing local session/dependencies preserve link and disconnect", () => {
  const cases: Array<[Partial<EpicConnectionState>, string, boolean]> = [
    [{ verification: "unconfirmed" }, "epic_status_unconfirmed", false],
    ...(["missing", "expired", "unavailable"] as const).map(
      (sessionState) =>
        [{ sessionState }, "epic_status_reconnect_required", true] as [
          Partial<EpicConnectionState>,
          string,
          boolean,
        ]
    ),
    ...(["legendary-missing", "unsupported-architecture"] as const).map(
      (reason) =>
        [
          { availability: { available: false, reason } },
          "epic_status_connected",
          false,
        ] as [Partial<EpicConnectionState>, string, boolean]
    ),
  ];
  for (const [overrides, status, reconnect] of cases) {
    const current = state(overrides);
    const view = getEpicIntegrationPresentation(current, true);
    assert.equal(view.statusKey, status);
    assert.equal(view.requiresReconnect, reconnect);
    assert.equal(view.canDisconnect, true);
    assert.equal(current.connection?.connected, true);
    if (overrides.availability) assert.equal(view.canAuthenticate, false);
  }
});

test("binary availability controls login and reconnect without blocking disconnect", () => {
  for (const connected of [false, true]) {
    for (const available of [false, true]) {
      const current = state({
        ...(connected ? {} : { connection: { connected: false } }),
        sessionState: "missing",
        availability: available
          ? { available: true }
          : { available: false, reason: "legendary-missing" },
      });
      const view = getEpicIntegrationPresentation(current, true);
      assert.equal(view.canAuthenticate, available);
      assert.equal(view.requiresReconnect, connected);
      assert.equal(view.canDisconnect, connected);
      assert.equal(
        view.statusKey,
        connected
          ? "epic_status_reconnect_required"
          : "integration_status_not_connected"
      );
    }
  }
});

test("unknown remote status and older API never claim disconnection", () => {
  assert.equal(
    getEpicIntegrationPresentation(null, true).statusKey,
    "epic_status_unknown"
  );
  assert.equal(
    getEpicIntegrationPresentation(
      state({ connection: null, verification: "unconfirmed" }),
      true
    ).statusKey,
    "epic_status_unknown"
  );
  assert.equal(
    getEpicIntegrationPresentation(
      state({ connection: { connected: false } }),
      true
    ).statusKey,
    "integration_status_not_connected"
  );
  const view = getEpicIntegrationPresentation(
    state({ error: "api-unavailable", verification: "unconfirmed" }),
    true
  );
  assert.equal(view.canAuthenticate, false);
  assert.equal(view.canDisconnect, true);
  assert.equal(view.statusKey, "epic_status_unconfirmed");
});

test("logout and active operations block account actions", () => {
  for (const status of [
    "awaiting-login",
    "authenticating",
    "connecting",
    "disconnecting",
  ] as const) {
    const view = getEpicIntegrationPresentation(
      state({ operation: { id: "operation", status } }),
      true
    );
    assert.equal(view.canAuthenticate, false);
    assert.equal(view.canDisconnect, false);
  }
  for (const current of [
    state(),
    state({ hydraLoggedIn: false, hydraUserId: null }),
  ]) {
    const view = getEpicIntegrationPresentation(current, false);
    assert.equal(view.canAuthenticate, false);
    assert.equal(view.canDisconnect, false);
  }
});

test("another Hydra account never receives cached Epic identity", () => {
  assert.equal(isEpicStateForUser(state(), "A"), true);
  assert.equal(isEpicStateForUser(state(), "B"), false);
  assert.equal(isEpicStateForUser(state(), null), false);
  assert.equal(
    isEpicStateForUser(
      state({ hydraLoggedIn: false, hydraUserId: null, connection: null }),
      "A"
    ),
    true
  );
});
