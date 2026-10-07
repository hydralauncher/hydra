import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon, PersonIcon } from "@primer/octicons-react";

import { Button, ConfirmationModal } from "@renderer/components";
import { useDate, useToast, useUserDetails } from "@renderer/hooks";
import { AuthPage } from "@shared";
import type { EpicConnectionState, EpicErrorCode } from "@types";
import { SettingsIntegrationCard } from "./settings-integration-card";
import {
  getEpicErrorTranslation,
  getEpicIntegrationPresentation,
  isEpicStateForUser,
} from "./settings-epic-state";

export function SettingsEpic() {
  const { userDetails } = useUserDetails();
  const { showSuccessToast, showErrorToast } = useToast();
  const { formatDateTime } = useDate();
  const { t } = useTranslation("settings");
  const userId = userDetails?.id ?? null;

  const [state, setState] = useState<EpicConnectionState | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(userId));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<EpicErrorCode | null>(null);

  const ownerRef = useRef(userId);
  const stateRef = useRef(state);
  const requestGeneration = useRef(0);
  const submittingRef = useRef(false);
  const ownerGeneration = useRef(0);
  const operationGeneration = useRef(0);
  if (ownerRef.current !== userId) ++ownerGeneration.current;
  ownerRef.current = userId;

  const applyState = useCallback(
    (next: EpicConnectionState) => {
      if (!isEpicStateForUser(next, ownerRef.current)) return;

      const previous = stateRef.current;
      if (
        previous?.hydraUserId === next.hydraUserId &&
        previous?.operation?.status === "connecting" &&
        !next.operation &&
        next.verification === "confirmed" &&
        next.connection?.connected &&
        next.sessionState === "ready" &&
        !next.error
      ) {
        showSuccessToast(t("epic_account_linked"));
      }

      stateRef.current = next;
      setState(next);
      setRequestError(null);
      setIsLoading(false);
    },
    [showSuccessToast, t]
  );

  const refreshStatus = useCallback(
    async (showLoading = false) => {
      const generation = ++requestGeneration.current;
      const requestedOwner = ownerRef.current;
      if (showLoading) setIsLoading(Boolean(requestedOwner));

      try {
        const next = await window.electron.getEpicConnection();
        if (
          generation === requestGeneration.current &&
          requestedOwner === ownerRef.current
        ) {
          applyState(next);
        }
      } catch {
        if (
          generation === requestGeneration.current &&
          requestedOwner === ownerRef.current
        ) {
          setRequestError("network");
          setState((previous) =>
            previous ? { ...previous, verification: "unconfirmed" } : null
          );
        }
      } finally {
        if (generation === requestGeneration.current) setIsLoading(false);
      }
    },
    [applyState]
  );

  const invalidateRequests = useCallback(() => {
    ++requestGeneration.current;
  }, []);

  useEffect(() => {
    stateRef.current = null;
    setState(null);
    setRequestError(null);
    setDisconnectId(null);
    ++operationGeneration.current;
    submittingRef.current = false;
    setIsSubmitting(false);
    void refreshStatus(true);
    return invalidateRequests;
  }, [invalidateRequests, refreshStatus, userId]);

  useEffect(() => {
    const unsubscribe = window.electron.onEpicConnectionChanged((next) => {
      if (!isEpicStateForUser(next, ownerRef.current)) return;
      ++requestGeneration.current;
      applyState(next);
    });
    const unsubscribeSignIn = window.electron.onSignIn(() => {
      void refreshStatus();
    });
    const unsubscribeSignOut = window.electron.onSignOut(() => {
      ++requestGeneration.current;
      ++ownerGeneration.current;
      ++operationGeneration.current;
      submittingRef.current = false;
      setIsSubmitting(false);
      stateRef.current = null;
      setState(null);
      setRequestError(null);
      setDisconnectId(null);
      setIsLoading(false);
    });
    return () => {
      unsubscribe();
      unsubscribeSignIn();
      unsubscribeSignOut();
    };
  }, [applyState, refreshStatus]);

  const runOperation = async (
    action: () => Promise<{ ok: boolean; error?: EpicErrorCode }>,
    options?: { disconnected?: boolean }
  ) => {
    if (submittingRef.current) return;
    const requestedOwner = ownerRef.current;
    const generation = ownerGeneration.current;
    const actionGeneration = ++operationGeneration.current;
    submittingRef.current = true;
    setIsSubmitting(true);
    setRequestError(null);
    try {
      const result = await action();
      if (
        requestedOwner !== ownerRef.current ||
        generation !== ownerGeneration.current
      )
        return;
      if (!result.ok) {
        if (result.error && result.error !== "operation-cancelled") {
          setRequestError(result.error);
          showErrorToast(t(getEpicErrorTranslation(result.error)));
        }
      } else if (options?.disconnected) {
        showSuccessToast(t("epic_account_unlinked"));
      }
      await refreshStatus();
    } catch {
      if (
        requestedOwner === ownerRef.current &&
        generation === ownerGeneration.current
      ) {
        setRequestError("network");
        showErrorToast(t("epic_error_network"));
        await refreshStatus();
      }
    } finally {
      if (actionGeneration === operationGeneration.current) {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const handleConnect = () =>
    void runOperation(() => window.electron.startEpicAuth());

  const handleCancel = async () => {
    const operation = stateRef.current?.operation;
    if (!operation) return;
    const generation = ownerGeneration.current;
    ++operationGeneration.current;
    try {
      const result = await window.electron.cancelEpicAuth(operation.id);
      if (generation !== ownerGeneration.current) return;
      if (!result.ok && result.error !== "operation-cancelled") {
        setRequestError(result.error);
      }
      await refreshStatus();
    } catch {
      if (generation === ownerGeneration.current) setRequestError("network");
    } finally {
      if (generation === ownerGeneration.current) {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const handleDisconnect = () => {
    if (!disconnectId) return;
    const expectedId = disconnectId;
    setDisconnectId(null);
    void runOperation(() => window.electron.disconnectEpic(expectedId), {
      disconnected: true,
    });
  };

  const visibleState =
    state && isEpicStateForUser(state, userId) ? state : null;
  const hydraLoggedIn =
    Boolean(userId) && visibleState?.hydraLoggedIn !== false;
  const presentation = getEpicIntegrationPresentation(
    visibleState,
    hydraLoggedIn
  );
  const connection = visibleState?.connection?.connected
    ? visibleState.connection
    : null;
  const operation = visibleState?.operation;
  const error =
    requestError ?? visibleState?.error ?? visibleState?.availability.reason;
  const displayedError =
    error && error !== "operation-cancelled" && error !== "hydra-auth-required"
      ? error
      : null;

  const renderActions = () => {
    if (!hydraLoggedIn) {
      return (
        <Button onClick={() => window.electron.openAuthWindow(AuthPage.SignIn)}>
          {t("steam_sign_in")}
        </Button>
      );
    }

    if (operation) {
      return (
        <>
          {operation.status !== "disconnecting" && (
            <Button theme="outline" onClick={() => void handleCancel()}>
              {t("cancel")}
            </Button>
          )}
        </>
      );
    }

    return (
      <>
        {(!connection || presentation.requiresReconnect) && (
          <Button
            onClick={handleConnect}
            disabled={!presentation.canAuthenticate || isSubmitting}
          >
            <LinkExternalIcon size={14} />
            {t(connection ? "integration_reconnect" : "integration_connect")}
          </Button>
        )}
        {(visibleState?.verification === "unconfirmed" ||
          visibleState?.availability.reason === "api-unavailable" ||
          requestError === "network") && (
          <Button
            theme="outline"
            onClick={() => void refreshStatus(true)}
            disabled={isSubmitting}
          >
            {t("epic_check_connection")}
          </Button>
        )}
        {connection && (
          <Button
            theme="danger"
            onClick={() => setDisconnectId(connection.connectionId)}
            disabled={!presentation.canDisconnect || isSubmitting}
          >
            {t("integration_disconnect")}
          </Button>
        )}
      </>
    );
  };

  return (
    <>
      <SettingsIntegrationCard
        title={t("epic_games")}
        logo={<LinkExternalIcon size={18} />}
        status={t(presentation.statusKey)}
        statusTone={presentation.statusTone}
        actions={renderActions()}
        loading={isLoading}
      >
        {connection ? (
          <div className="settings-integration-card__profile">
            <div className="settings-integration-card__avatar">
              <PersonIcon size={28} />
            </div>
            <div className="settings-integration-card__account">
              <span className="settings-integration-card__username">
                {connection.displayName}
              </span>
              <span className="settings-integration-card__meta">
                {t("epic_connected_at", {
                  date: formatDateTime(connection.connectedAt),
                })}
              </span>
            </div>
          </div>
        ) : (
          <p className="settings-integration-card__description">
            {t("epic_description")}
          </p>
        )}

        {connection && presentation.requiresReconnect && (
          <p className="settings-integration-card__message">
            {t("epic_reconnect_description")}
          </p>
        )}
        {operation?.status === "awaiting-login" && (
          <p className="settings-integration-card__message">
            {t("epic_login_in_window")}
          </p>
        )}
        {displayedError && (
          <p className="settings-integration-card__message" role="alert">
            {t(getEpicErrorTranslation(displayedError))}
          </p>
        )}
      </SettingsIntegrationCard>

      <ConfirmationModal
        visible={disconnectId !== null}
        onClose={() => setDisconnectId(null)}
        title={t("epic_disconnect_title")}
        descriptionText={t("epic_disconnect_description")}
        confirmButtonLabel={t("integration_disconnect")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        buttonsIsDisabled={isSubmitting}
        onConfirm={handleDisconnect}
      />
    </>
  );
}
