import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EpicConnectionState } from "../../../../types/epic-integration.types.js";

import {
  getEpicErrorTranslation,
  getEpicIntegrationPresentation,
  isEpicStateForUser,
} from "./settings-epic-state.js";

const connectedState = (
  overrides: Partial<EpicConnectionState> = {}
): EpicConnectionState => ({
  hydraLoggedIn: true,
  hydraUserId: "hydra-a",
  availability: { available: true },
  connection: {
    connected: true,
    connectionId: "ConnectionHashId",
    epicAccountId: "a".repeat(32),
    displayName: "Epic user",
    connectedAt: "2026-10-07T12:00:00.000Z",
  },
  verification: "confirmed",
  sessionState: "ready",
  operation: null,
  ...overrides,
});

describe("Epic integration presentation", () => {
  it("preserves the linked account while an offline check is unconfirmed", () => {
    const state = connectedState({ verification: "unconfirmed" });
    const presentation = getEpicIntegrationPresentation(state, true);
    assert.equal(presentation.statusKey, "epic_status_unconfirmed");
    assert.equal(presentation.statusTone, "warning");
    assert.equal(presentation.canDisconnect, true);
    assert.equal(presentation.requiresReconnect, false);
    assert.equal(state.connection?.connected, true);
  });

  it("does not report a disconnected account when its status is unknown", () => {
    assert.equal(
      getEpicIntegrationPresentation(null, true).statusKey,
      "epic_status_unknown"
    );
    assert.equal(
      getEpicIntegrationPresentation(
        connectedState({ connection: null, verification: "unconfirmed" }),
        true
      ).statusKey,
      "epic_status_unknown"
    );
    assert.equal(
      getEpicIntegrationPresentation(
        connectedState({ connection: { connected: false } }),
        true
      ).statusKey,
      "integration_status_not_connected"
    );
  });

  it("asks for sign-in again without treating a missing or expired session as an unlink", () => {
    for (const sessionState of ["missing", "expired", "unavailable"] as const) {
      const presentation = getEpicIntegrationPresentation(
        connectedState({ sessionState }),
        true
      );
      assert.equal(presentation.statusKey, "epic_status_reconnect_required");
      assert.equal(presentation.requiresReconnect, true);
      assert.equal(presentation.canDisconnect, true);
    }
  });

  it("keeps disconnect available when optional local auth dependencies fail", () => {
    for (const reason of [
      "legendary-missing",
      "vault-unavailable",
      "unsupported-architecture",
    ] as const) {
      const presentation = getEpicIntegrationPresentation(
        connectedState({ availability: { available: false, reason } }),
        true
      );
      assert.equal(presentation.canAuthenticate, false);
      assert.equal(presentation.canDisconnect, true);
    }
  });

  it("disables auth when an older API lacks Epic endpoints", () => {
    for (const connection of [
      { connected: false } as const,
      connectedState().connection,
    ]) {
      const presentation = getEpicIntegrationPresentation(
        connectedState({
          connection,
          verification: "unconfirmed",
          error: "api-unavailable",
        }),
        true
      );
      assert.equal(presentation.canAuthenticate, false);
      assert.equal(presentation.statusTone, "warning");
    }
  });

  it("blocks new operations until the active operation finishes", () => {
    for (const status of [
      "awaiting-login",
      "authenticating",
      "connecting",
      "disconnecting",
    ] as const) {
      const presentation = getEpicIntegrationPresentation(
        connectedState({ operation: { id: "operation", status } }),
        true
      );
      assert.equal(presentation.canAuthenticate, false);
      assert.equal(presentation.canDisconnect, false);
    }
  });

  it("blocks account operations when Hydra login is missing", () => {
    for (const state of [
      connectedState(),
      connectedState({ hydraLoggedIn: false, hydraUserId: null }),
    ]) {
      const presentation = getEpicIntegrationPresentation(state, false);
      assert.equal(presentation.canAuthenticate, false);
      assert.equal(presentation.canDisconnect, false);
    }
  });

  it("ignores stale identities from another Hydra account", () => {
    assert.equal(isEpicStateForUser(connectedState(), "hydra-a"), true);
    assert.equal(isEpicStateForUser(connectedState(), "hydra-b"), false);
    assert.equal(isEpicStateForUser(connectedState(), null), false);
    assert.equal(
      isEpicStateForUser(
        connectedState({
          hydraLoggedIn: false,
          hydraUserId: null,
          connection: null,
        }),
        "hydra-a"
      ),
      true
    );
  });

  it("maps conflict, expired proof and missing server configuration to useful messages", () => {
    assert.equal(
      getEpicErrorTranslation("account-in-use"),
      "epic_error_account_in_use"
    );
    assert.equal(getEpicErrorTranslation("invalid-proof"), "epic_error_proof");
    assert.equal(getEpicErrorTranslation("api-unavailable"), "epic_error_api");
    assert.equal(getEpicErrorTranslation("network"), "epic_error_network");
  });
});
