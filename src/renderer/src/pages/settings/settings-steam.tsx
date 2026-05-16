import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  Link,
  Modal,
  TextField,
} from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import {
  CheckCircleFillIcon,
  PersonIcon,
  RepoIcon,
  StopIcon,
  SyncIcon,
} from "@primer/octicons-react";
import "./settings-steam.scss";

interface SyncProgress {
  current: number;
  total: number;
  gameTitle: string;
  done?: boolean;
  cancelled?: boolean;
}

type SyncType = "achievements" | "library";

interface SyncState {
  running: boolean;
  showModal: boolean;
  progress: SyncProgress | null;
}

const INITIAL_SYNC_STATE: SyncState = {
  running: false,
  showModal: false,
  progress: null,
};

export function SettingsSteam() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [isLinking, setIsLinking] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [steamDisplayName, setSteamDisplayName] = useState<string | null>(null);
  const [steamAvatarUrl, setSteamAvatarUrl] = useState<string | null>(null);

  const [achievementsSync, setAchievementsSync] =
    useState<SyncState>(INITIAL_SYNC_STATE);
  const [librarySync, setLibrarySync] = useState<SyncState>(INITIAL_SYNC_STATE);

  const achievementsUnsubRef = useRef<(() => void) | null>(null);
  const libraryUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (userPreferences?.steamApiKey) {
      setApiKey(userPreferences.steamApiKey);
    }
    if (userPreferences?.steamDisplayName) {
      setSteamDisplayName(userPreferences.steamDisplayName);
    }
    if (userPreferences?.steamAvatarUrl) {
      setSteamAvatarUrl(userPreferences.steamAvatarUrl);
    }
  }, [userPreferences]);

  const refreshSteamProfile = useCallback(async () => {
    try {
      const { displayName, avatarUrl } =
        await window.electron.fetchSteamProfile();
      setSteamDisplayName(displayName);
      setSteamAvatarUrl(avatarUrl);
      updateUserPreferences({
        steamDisplayName: displayName,
        steamAvatarUrl: avatarUrl,
      });
    } catch {
      // Silently ignore — profile fetch is best-effort
    }
  }, [updateUserPreferences]);

  const handleLinkAccount = async () => {
    setIsLinking(true);
    try {
      const { steamId } = await window.electron.authenticateSteam();
      updateUserPreferences({ steamLinkedAccountId: steamId });
      showSuccessToast(t("steam_account_linked"));
      // Fetch display name if API key already set
      if (userPreferences?.steamApiKey) {
        await refreshSteamProfile();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== "window_closed" && message !== "cancelled") {
        showErrorToast(t("steam_auth_failed"));
      }
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlinkAccount = () => {
    updateUserPreferences({
      steamLinkedAccountId: null,
      steamApiKey: null,
      steamDisplayName: null,
      steamAvatarUrl: null,
      steamAutoSyncOnStartup: false,
    });
    setApiKey("");
    setSteamDisplayName(null);
    setSteamAvatarUrl(null);
    showSuccessToast(t("steam_account_unlinked"));
  };

  const handleSaveApiKey = async () => {
    updateUserPreferences({ steamApiKey: apiKey.trim() || null });
    showSuccessToast(t("changes_saved"));
    if (apiKey.trim() && userPreferences?.steamLinkedAccountId) {
      await refreshSteamProfile();
    }
  };

  const startSync = useCallback(
    async (type: SyncType) => {
      const setState =
        type === "achievements" ? setAchievementsSync : setLibrarySync;
      const unsubRef =
        type === "achievements" ? achievementsUnsubRef : libraryUnsubRef;
      const progressChannel =
        type === "achievements"
          ? window.electron.onSteamAchievementsSyncProgress
          : window.electron.onSteamLibrarySyncProgress;

      setState({ running: true, showModal: true, progress: null });

      const unsub = progressChannel((p) => {
        setState((prev) => ({ ...prev, progress: p }));
      });
      unsubRef.current = unsub;

      try {
        if (type === "achievements") {
          const { totalNew, synced, cancelled } =
            await window.electron.syncAllSteamAchievements();
          if (cancelled) {
            showSuccessToast(t("steam_sync_cancelled"));
          } else if (totalNew > 0) {
            showSuccessToast(
              t("steam_achievements_sync_done"),
              t("steam_achievements_sync_new", {
                count: totalNew,
                total: synced,
              })
            );
          } else {
            showSuccessToast(
              t("steam_achievements_sync_done"),
              t("steam_achievements_sync_up_to_date", { total: synced })
            );
          }
        } else {
          const { imported, updated, skipped, cancelled } =
            await window.electron.syncSteamLibrary();
          if (cancelled) {
            showSuccessToast(t("steam_sync_cancelled"));
          } else {
            showSuccessToast(
              t("steam_library_sync_done"),
              t("steam_library_sync_result", { imported, updated, skipped })
            );
          }
        }
      } catch {
        showErrorToast(t("steam_sync_error"));
      } finally {
        unsub();
        unsubRef.current = null;
        setState({ running: false, showModal: false, progress: null });
      }
    },
    [showSuccessToast, showErrorToast, t]
  );

  const handleCancel = useCallback(async (type: SyncType) => {
    await window.electron.cancelSteamSync(type);
  }, []);

  const handleCloseModal = useCallback((type: SyncType) => {
    const setState =
      type === "achievements" ? setAchievementsSync : setLibrarySync;
    setState((prev) => ({ ...prev, showModal: false }));
  }, []);

  const handleReopenModal = useCallback((type: SyncType) => {
    const setState =
      type === "achievements" ? setAchievementsSync : setLibrarySync;
    setState((prev) => ({ ...prev, showModal: true }));
  }, []);

  const linkedSteamId = userPreferences?.steamLinkedAccountId;
  const hasApiKey = Boolean(userPreferences?.steamApiKey);
  const canSync = Boolean(linkedSteamId) && hasApiKey;
  const eitherSyncing = achievementsSync.running || librarySync.running;

  return (
    <div className="settings-steam__container">
      <p className="settings-steam__description">
        {t("steam_integration_description")}
      </p>

      {linkedSteamId ? (
        <>
          {/* Account info */}
          <div className="settings-steam__account-info">
            {steamAvatarUrl && (
              <img
                className="settings-steam__avatar"
                src={steamAvatarUrl}
                alt={steamDisplayName ?? linkedSteamId}
              />
            )}
            <div className="settings-steam__account-info__text">
              <div className="settings-steam__linked-info">
                <CheckCircleFillIcon size={14} />
                <strong>{steamDisplayName ?? linkedSteamId}</strong>
              </div>
              <span className="settings-steam__steam-id">
                {t("steam_id_label")}: {linkedSteamId}
              </span>
            </div>
          </div>

          <TextField
            label={t("steam_api_key_label")}
            value={apiKey}
            type="password"
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t("steam_api_key_placeholder")}
            hint={
              <Trans i18nKey="steam_api_key_hint" ns="settings">
                <Link to="https://steamcommunity.com/dev/apikey" />
              </Trans>
            }
            rightContent={
              <Button type="button" onClick={handleSaveApiKey}>
                {t("save_changes")}
              </Button>
            }
          />

          {canSync && (
            <>
              <div className="settings-steam__sync-actions">
                {/* Sync achievements */}
                <div className="settings-steam__sync-action">
                  <div className="settings-steam__sync-action__info">
                    <strong>{t("steam_sync_achievements_title")}</strong>
                    <span>{t("steam_sync_achievements_description")}</span>
                  </div>
                  <div className="settings-steam__sync-action__buttons">
                    {achievementsSync.running &&
                      !achievementsSync.showModal && (
                        <Button
                          type="button"
                          theme="outline"
                          onClick={() => handleReopenModal("achievements")}
                        >
                          {t("steam_view_progress")}
                        </Button>
                      )}
                    <Button
                      type="button"
                      theme="outline"
                      onClick={() => startSync("achievements")}
                      disabled={eitherSyncing}
                    >
                      <SyncIcon
                        size={14}
                        className={
                          achievementsSync.running
                            ? "settings-steam__spin"
                            : undefined
                        }
                      />
                      {achievementsSync.running
                        ? t("steam_syncing")
                        : t("steam_sync_achievements_button")}
                    </Button>
                  </div>
                </div>

                {/* Sync library */}
                <div className="settings-steam__sync-action">
                  <div className="settings-steam__sync-action__info">
                    <strong>{t("steam_sync_library_title")}</strong>
                    <span>{t("steam_sync_library_description")}</span>
                  </div>
                  <div className="settings-steam__sync-action__buttons">
                    {librarySync.running && !librarySync.showModal && (
                      <Button
                        type="button"
                        theme="outline"
                        onClick={() => handleReopenModal("library")}
                      >
                        {t("steam_view_progress")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      theme="outline"
                      onClick={() => startSync("library")}
                      disabled={eitherSyncing}
                    >
                      <RepoIcon size={14} />
                      {librarySync.running
                        ? t("steam_syncing")
                        : t("steam_sync_library_button")}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Auto-sync on startup */}
              <CheckboxField
                label={t("steam_auto_sync_on_startup")}
                checked={Boolean(userPreferences?.steamAutoSyncOnStartup)}
                onChange={(e) =>
                  updateUserPreferences({
                    steamAutoSyncOnStartup: e.target.checked,
                  })
                }
              />
            </>
          )}

          <div className="settings-steam__actions">
            <Button theme="outline" type="button" onClick={handleUnlinkAccount}>
              {t("steam_unlink_account")}
            </Button>
          </div>
        </>
      ) : (
        <div className="settings-steam__actions">
          <Button
            type="button"
            onClick={handleLinkAccount}
            disabled={isLinking}
          >
            <PersonIcon size={16} />
            {isLinking ? t("steam_linking") : t("steam_link_account")}
          </Button>
        </div>
      )}

      {/* Progress modals */}
      {(["achievements", "library"] as SyncType[]).map((type) => {
        const state = type === "achievements" ? achievementsSync : librarySync;
        const title =
          type === "achievements"
            ? t("steam_sync_achievements_title")
            : t("steam_sync_library_title");

        return (
          <Modal
            key={type}
            visible={state.showModal}
            title={title}
            onClose={() => handleCloseModal(type)}
            clickOutsideToClose={false}
          >
            <div className="settings-steam__progress-modal">
              {state.progress && state.progress.total > 0 ? (
                <>
                  <p className="settings-steam__progress-modal__game">
                    {state.progress.done
                      ? t("steam_sync_complete")
                      : state.progress.gameTitle}
                  </p>
                  <progress
                    className="settings-steam__progress-modal__bar"
                    max={state.progress.total}
                    value={state.progress.current}
                  />
                  <div className="settings-steam__progress-modal__footer">
                    <span className="settings-steam__progress-modal__count">
                      {state.progress.current} / {state.progress.total}
                    </span>
                    {!state.progress.done && (
                      <Button
                        theme="danger"
                        type="button"
                        onClick={() => handleCancel(type)}
                      >
                        <StopIcon size={14} />
                        {t("cancel")}
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <p>{t("steam_sync_preparing")}</p>
              )}
            </div>
          </Modal>
        );
      })}
    </div>
  );
}
