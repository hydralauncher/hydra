import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import { useEpicCloudSaveControls } from "@renderer/hooks/use-epic-cloud-save-controls";
import {
  Button,
  Checkbox,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../common";
import { getEpicManagedError } from "@renderer/helpers/epic-managed-error";

export function EpicCloudSaves({
  game,
  isGameRunning,
}: Readonly<{ game: LibraryGame | null; isGameRunning: boolean }>) {
  const cloud = useEpicCloudSaveControls(game?.epicInstallation ? game : null);
  const { t } = useTranslation("game_details");
  if (!game?.epicInstallation || !cloud.available || !cloud.state) return null;
  const disabled = cloud.busy || isGameRunning;
  const { state } = cloud;
  return (
    <VerticalFocusGroup asChild>
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: 24,
        }}
        aria-label={t("epic_cloud_saves")}
      >
        <h3>{t("epic_cloud_saves")}</h3>
        <p role="status">{t(`epic_save_status_${state.status}`)}</p>
        {(cloud.failure || state.error) && (
          <p role="alert">
            {t(getEpicManagedError(state.error).key, {
              ns: getEpicManagedError(state.error).ns,
            })}
          </p>
        )}
        {state.supportsCloudSaves && (
          <>
            <Checkbox
              label={t("epic_save_automatic")}
              checked={state.automaticSync}
              disabled={disabled}
              onChange={(enabled) => void cloud.updateSettings(enabled)}
            />
            <p>{state.savePath ?? t("epic_save_path_required")}</p>
            <HorizontalFocusGroup>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => void cloud.choosePath()}
              >
                {t("epic_save_select_path")}
              </Button>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => void cloud.sync()}
              >
                {t("epic_save_sync_now")}
              </Button>
            </HorizontalFocusGroup>
            {state.status === "conflict" && (
              <>
                <p>{t("epic_save_conflict_description")}</p>
                <p>
                  {t("cloud_save_v2_local")}:{" "}
                  {state.localModifiedAt
                    ? new Date(state.localModifiedAt).toLocaleString()
                    : "—"}{" "}
                  · Epic Games:{" "}
                  {state.remoteModifiedAt
                    ? new Date(state.remoteModifiedAt).toLocaleString()
                    : "—"}
                </p>
                <HorizontalFocusGroup>
                  <Button
                    variant="primary"
                    disabled={disabled}
                    onClick={() => void cloud.resolve("local")}
                  >
                    {t("epic_save_use_local")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => void cloud.resolve("remote")}
                  >
                    {t("epic_save_use_remote")}
                  </Button>
                </HorizontalFocusGroup>
              </>
            )}
          </>
        )}
      </section>
    </VerticalFocusGroup>
  );
}
