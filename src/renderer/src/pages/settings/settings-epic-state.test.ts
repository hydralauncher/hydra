import assert from "node:assert/strict";
import test from "node:test";
import type { EpicConnectionState } from "../../../../types/epic-integration.types.js";
import {
  getEpicAuthFailure,
  getEpicIntegrationPresentation,
  getEpicErrorTranslation,
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

test("invalid account data uses the payload error message", () => {
  assert.equal(
    getEpicErrorTranslation("invalid-account-data"),
    "epic_error_account_data"
  );
});

test("failed Epic linking notifies once when the asynchronous operation ends", () => {
  const pending = state({
    connection: { connected: false },
    operation: { id: "operation", status: "connecting" },
  });
  const failed = state({
    connection: { connected: false },
    error: "account-in-use",
  });
  const failure = getEpicAuthFailure(pending, failed);
  assert.equal(failure, "account-in-use");
  assert.equal(getEpicErrorTranslation(failure!), "epic_error_account_in_use");
  assert.equal(getEpicAuthFailure(failed, failed), null);
  assert.equal(
    getEpicIntegrationPresentation(failed, true).statusKey,
    "integration_status_not_connected"
  );
});

test("Epic auth feedback excludes cancellation, other users and disconnects", () => {
  const pending = state({
    operation: { id: "operation", status: "authenticating" },
  });
  const failed = state({ error: "auth-failed" });
  assert.equal(getEpicAuthFailure(pending, failed), "auth-failed");
  for (const next of [
    state(),
    state({ error: "operation-cancelled" }),
    state({ hydraUserId: "B", error: "auth-failed" }),
    state({ hydraLoggedIn: false, error: "hydra-auth-required" }),
    state({ ...pending, error: "auth-failed" }),
  ]) {
    assert.equal(getEpicAuthFailure(pending, next), null);
  }
  assert.equal(getEpicAuthFailure(null, failed), null);
  assert.equal(
    getEpicAuthFailure(
      state({ operation: { id: "operation", status: "disconnecting" } }),
      failed
    ),
    null
  );
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
  for (const [status, statusKey] of [
    ["awaiting-login", "epic_status_awaiting_login"],
    ["authenticating", "epic_status_connecting"],
    ["connecting", "epic_status_connecting"],
    ["disconnecting", "epic_status_disconnecting"],
  ] as const) {
    const view = getEpicIntegrationPresentation(
      state({ operation: { id: "operation", status } }),
      true
    );
    assert.deepEqual(view, {
      statusKey,
      statusTone: "neutral",
      requiresReconnect: false,
      canAuthenticate: false,
      canDisconnect: false,
    });
  }
  for (const current of [
    state(),
    state({ hydraLoggedIn: false, hydraUserId: null }),
  ]) {
    const view = getEpicIntegrationPresentation(current, false);
    assert.deepEqual(view, {
      statusKey: "integration_status_not_connected",
      statusTone: "neutral",
      requiresReconnect: false,
      canAuthenticate: false,
      canDisconnect: false,
    });
  }
});

test("confirmed links preserve their status tone and available actions", () => {
  const cases: [
    Partial<EpicConnectionState>,
    string,
    string,
    boolean,
    boolean,
  ][] = [
    [{}, "epic_status_connected", "success", false, true],
    [
      { sessionState: "missing" },
      "epic_status_reconnect_required",
      "warning",
      true,
      true,
    ],
    [
      { connection: { connected: false } },
      "integration_status_not_connected",
      "neutral",
      false,
      false,
    ],
    [
      { verification: "unconfirmed" },
      "epic_status_unconfirmed",
      "warning",
      false,
      true,
    ],
  ];
  for (const [
    overrides,
    statusKey,
    statusTone,
    requiresReconnect,
    canDisconnect,
  ] of cases) {
    assert.deepEqual(getEpicIntegrationPresentation(state(overrides), true), {
      statusKey,
      statusTone,
      requiresReconnect,
      canAuthenticate: true,
      canDisconnect,
    });
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
