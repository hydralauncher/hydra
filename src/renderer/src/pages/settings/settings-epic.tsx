import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon, PersonIcon, SyncIcon } from "@primer/octicons-react";

import { Button, ConfirmationModal } from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import { AuthPage } from "@shared";
import type { EpicConnectionState, EpicErrorCode, EpicSyncState } from "@types";
import EpicLogo from "@renderer/assets/epic-integration-logo.svg?react";
import {
  SettingsIntegrationCard,
  SettingsIntegrationLastSynced,
} from "./settings-integration-card";
import {
  getEpicAuthFailure,
  getEpicErrorTranslation,
  getEpicIntegrationPresentation,
  isEpicStateForUser,
} from "./settings-epic-state";

const STATUS_ICON_SIZE = 14;

export function SettingsEpic() {
  const { userDetails } = useUserDetails();
  const { showSuccessToast, showErrorToast } = useToast();
  const { t } = useTranslation("settings");
  const userId = userDetails?.id ?? null;

  const [syncState, setSyncState] = useState<EpicSyncState>({
    status: "idle",
    hydraUserId: null,
  });
  const [state, setState] = useState<EpicConnectionState | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(userId));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
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

      const failure = getEpicAuthFailure(previous, next);
      if (failure) showErrorToast(t(getEpicErrorTranslation(failure)));

      stateRef.current = next;
      setState(next);
      setRequestError(null);
      setIsLoading(false);
    },
    [showSuccessToast, showErrorToast, t]
  );

  const refreshStatus = useCallback(
    async (showLoading = false) => {
      const generation = ++requestGeneration.current;
      const requestedOwner = ownerRef.current;
      if (showLoading) setIsLoading(Boolean(requestedOwner));

      try {
        if (typeof window.electron.getEpicConnection !== "function") return;
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
    setIsDisconnecting(false);
    void refreshStatus(true);
    return invalidateRequests;
  }, [invalidateRequests, refreshStatus, userId]);

  useEffect(() => {
    if (typeof window.electron.onEpicConnectionChanged !== "function") return;
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
      setIsDisconnecting(false);
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

  useEffect(() => {
    setSyncState({ status: "idle", hydraUserId: userId });
    if (
      typeof window.electron.getEpicSyncState !== "function" ||
      typeof window.electron.onEpicSyncProgress !== "function" ||
      typeof window.electron.onEpicSyncFinished !== "function"
    )
      return;
    const apply = (next: EpicSyncState) => {
      if (next.hydraUserId !== ownerRef.current) return;
      const connection = stateRef.current?.connection;
      if (
        connection?.connected &&
        next.connectionId &&
        connection.connectionId !== next.connectionId
      )
        return;
      setSyncState(next);
    };
    void window.electron
      .getEpicSyncState()
      .then(apply)
      .catch(() => {});
    const progress = window.electron.onEpicSyncProgress(apply);
    const finished = window.electron.onEpicSyncFinished((result) => {
      if (result.hydraUserId !== ownerRef.current) return;
      const current = stateRef.current?.connection;
      if (!current?.connected || result.connectionId !== current.connectionId)
        return;
      if (result.origin === "manual") {
        if (result.ok)
          showSuccessToast(
            t(
              result.achievementSummary?.status === "partial"
                ? "epic_sync_partial"
                : "epic_sync_success",
              { count: result.achievementSummary?.gamesPending ?? 0 }
            )
          );
        else if (result.error !== "operation-cancelled")
          showErrorToast(
            t(
              result.requiresMerge
                ? "epic_sync_merge_pending"
                : getEpicErrorTranslation(result.error ?? "network")
            )
          );
      }
      void refreshStatus();
    });
    return () => {
      progress();
      finished();
    };
  }, [userId, refreshStatus, showSuccessToast, showErrorToast, t]);

  const handleSync = async () => {
    const current = stateRef.current?.connection;
    if (
      !current?.connected ||
      typeof window.electron.startEpicSync !== "function"
    )
      return;
    try {
      const result = await window.electron.startEpicSync(current.connectionId);
      if (result.hydraUserId === ownerRef.current) setSyncState(result);
    } catch {
      setRequestError("network");
    }
  };
  const handleCancelSync = async () => {
    const current = stateRef.current?.connection;
    if (
      !current?.connected ||
      typeof window.electron.cancelEpicSync !== "function"
    )
      return;
    await runOperation(() =>
      window.electron.cancelEpicSync(current.connectionId)
    );
  };

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
    setIsDisconnecting(options?.disconnected === true);
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
        setIsDisconnecting(false);
      }
    }
  };

  const handleConnect = () => {
    if (typeof window.electron.startEpicAuth !== "function") return;
    void runOperation(() => window.electron.startEpicAuth());
  };

  const handleCancel = async () => {
    const operation = stateRef.current?.operation;
    if (!operation || typeof window.electron.cancelEpicAuth !== "function")
      return;
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
    if (!disconnectId || typeof window.electron.disconnectEpic !== "function")
      return;
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
  const disconnecting =
    isDisconnecting || operation?.status === "disconnecting";
  const requiresReconnect =
    presentation.requiresReconnect || syncState.requiresReconnect === true;
  const supportsSync = typeof window.electron.startEpicSync === "function";
  const isSyncing =
    supportsSync &&
    Boolean(connection) &&
    (syncState.status !== "idle" ||
      (syncState.error === "sync-active" &&
        connection?.latestSyncRun?.status === "PENDING"));
  const showReconnectMessage = Boolean(connection) && requiresReconnect;
  const error =
    requestError ??
    syncState.error ??
    visibleState?.error ??
    visibleState?.availability.reason;
  const displayedErrorKey =
    error && error !== "operation-cancelled" && error !== "hydra-auth-required"
      ? getEpicErrorTranslation(error)
      : null;

  const renderActions = () => {
    if (!hydraLoggedIn) {
      return (
        <Button onClick={() => window.electron.openAuthWindow(AuthPage.SignIn)}>
          {t("steam_sign_in")}
        </Button>
      );
    }

    if (disconnecting) return null;

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
        {isSyncing ? (
          <Button
            theme="outline"
            onClick={() => void handleCancelSync()}
            disabled={syncState.status === "cancelling" || isSubmitting}
          >
            {t("cancel")}
          </Button>
        ) : !connection || requiresReconnect ? (
          <Button
            onClick={handleConnect}
            disabled={!presentation.canAuthenticate || isSubmitting}
          >
            <LinkExternalIcon size={STATUS_ICON_SIZE} />
            {t(connection ? "integration_reconnect" : "integration_connect")}
          </Button>
        ) : supportsSync ? (
          <Button
            theme="outline"
            onClick={() => void handleSync()}
            disabled={
              isSubmitting || visibleState?.verification !== "confirmed"
            }
          >
            <SyncIcon size={STATUS_ICON_SIZE} />
            {t("integration_sync")}
          </Button>
        ) : null}
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
        logo={<EpicLogo />}
        status={t(
          disconnecting
            ? "epic_status_disconnecting"
            : syncState.requiresReconnect
              ? "epic_status_reconnect_required"
              : presentation.statusKey
        )}
        statusTone={
          disconnecting
            ? "neutral"
            : syncState.requiresReconnect
              ? "warning"
              : presentation.statusTone
        }
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
              {typeof window.electron.getEpicSyncState === "function" && (
                <SettingsIntegrationLastSynced
                  lastSyncedAt={connection.lastSyncedAt}
                />
              )}
            </div>
          </div>
        ) : (
          <p className="settings-integration-card__description">
            {t("epic_description")}
          </p>
        )}

        {disconnecting ? (
          <output className="settings-integration-card__progress">
            <div className="settings-integration-card__progress-header">
              <span>{t("epic_status_disconnecting")}</span>
            </div>
            <div className="settings-integration-card__progress-track">
              <div className="settings-integration-card__progress-fill settings-integration-card__progress-fill--indeterminate" />
            </div>
          </output>
        ) : (
          syncState.status !== "idle" &&
          syncState.hydraUserId === userId && (
            <div
              className="settings-integration-card__progress"
              role="status"
              aria-live="polite"
            >
              <div className="settings-integration-card__progress-header">
                <span>
                  {t(
                    `epic_sync_${syncState.status === "cancelling" ? "cancelling" : (syncState.phase ?? "starting")}`
                  )}
                </span>
                {typeof syncState.total === "number" &&
                  syncState.total > 0 &&
                  (syncState.phase === "publishing" ||
                    syncState.phase === "achievements" ||
                    syncState.phase === "merging") && (
                    <span className="settings-integration-card__progress-count">
                      {syncState.processed ?? 0} / {syncState.total}
                    </span>
                  )}
              </div>
              <div className="settings-integration-card__progress-track">
                <div className="settings-integration-card__progress-fill settings-integration-card__progress-fill--indeterminate" />
              </div>
            </div>
          )
        )}
        {showReconnectMessage && (
          <p
            className="settings-integration-card__message"
            role={
              displayedErrorKey === "epic_reconnect_description"
                ? "alert"
                : undefined
            }
          >
            {t("epic_reconnect_description")}
          </p>
        )}
        {operation?.status === "awaiting-login" && (
          <p className="settings-integration-card__message">
            {t("epic_login_in_window")}
          </p>
        )}
        {displayedErrorKey &&
          !(
            showReconnectMessage &&
            displayedErrorKey === "epic_reconnect_description"
          ) && (
            <p className="settings-integration-card__message" role="alert">
              {t(displayedErrorKey)}
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
