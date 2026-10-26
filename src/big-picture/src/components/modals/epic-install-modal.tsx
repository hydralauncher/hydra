import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import { formatBytes } from "@shared";
import { DownloadSimpleIcon, ImageIcon, PlusIcon } from "@phosphor-icons/react";
import { useEpicInstall } from "@renderer/hooks/use-epic-install";
import { getVerticalCoverCardImageSources } from "@renderer/components/vertical-cover-card/vertical-cover-card-image-sources";
import { getEpicManagedError } from "@renderer/helpers/epic-managed-error";
import { useNavigate } from "react-router-dom";
import {
  Button,
  DropdownSelect,
  HorizontalFocusGroup,
  Input,
  Modal,
  Skeleton,
  VerticalFocusGroup,
} from "../common";
import { useBigPictureDownloadsStore } from "../../stores";

import "./epic-install-modal.scss";

const EPIC_INSTALL_SUBMIT_FOCUS_ID = "epic-install-modal-submit";
const EPIC_INSTALL_CHANGE_PATH_FOCUS_ID = "epic-install-modal-change-path";

export function EpicInstallModal({
  game,
  onClose,
  onStarted,
}: Readonly<{
  game: LibraryGame | null;
  onClose: () => void;
  onStarted: () => void;
}>) {
  const { t } = useTranslation("game_details");
  const navigate = useNavigate();
  const install = useEpicInstall(game, onStarted);
  const hasActiveDownload = useBigPictureDownloadsStore(
    (state) => state.lastPacket !== null
  );
  const requiresOfficialLauncher =
    install.error === "external-launcher-required";
  const coverSources = getVerticalCoverCardImageSources([
    game?.customCoverImageUrl,
    game?.coverImageUrl,
    game?.libraryImageUrl,
    game?.customIconUrl,
    game?.iconUrl,
  ]);
  const coverSourcesKey = coverSources.join("\u0000");
  const [coverIndex, setCoverIndex] = useState(0);
  useEffect(() => setCoverIndex(0), [coverSourcesKey]);

  const managedError = install.error
    ? getEpicManagedError(install.error)
    : null;
  const disabled =
    requiresOfficialLauncher ||
    install.loading ||
    install.starting ||
    !install.option ||
    !install.result?.connectionId ||
    !install.path;
  const formatSize = (bytes: number | null | undefined) =>
    bytes == null ? "—" : formatBytes(bytes);

  return (
    <Modal
      visible={!!game}
      title={t("download_settings")}
      description={
        requiresOfficialLauncher || install.diskFreeSpace === null
          ? undefined
          : t("space_left_on_disk", {
              space: formatBytes(install.diskFreeSpace),
            })
      }
      initialFocusId={EPIC_INSTALL_SUBMIT_FOCUS_ID}
      onClose={onClose}
    >
      <VerticalFocusGroup className="epic-install-modal">
        <div className="epic-install-modal__summary">
          <div className="epic-install-modal__cover">
            {coverSources[coverIndex] ? (
              <img
                src={coverSources[coverIndex]}
                alt=""
                onError={() => setCoverIndex((index) => index + 1)}
              />
            ) : (
              <ImageIcon size={28} />
            )}
          </div>

          <strong className="epic-install-modal__title" title={game?.title}>
            {game?.title}
          </strong>

          {!requiresOfficialLauncher && (
            <div
              className="epic-install-modal__sizes"
              aria-busy={install.loading}
              aria-label={
                install.loading ? t("epic_preparing_install") : undefined
              }
            >
              {install.loading ? (
                <>
                  <Skeleton className="epic-install-modal__size-skeleton" />
                  <Skeleton className="epic-install-modal__size-skeleton epic-install-modal__size-skeleton--wide" />
                </>
              ) : (
                <>
                  <span>
                    <Trans
                      i18nKey="download_size"
                      ns="game_details"
                      values={{
                        size: formatSize(install.option?.downloadSizeInBytes),
                      }}
                    />
                  </span>
                  <span>
                    <Trans
                      i18nKey="required_storage_space"
                      ns="game_details"
                      values={{
                        size: formatSize(install.option?.diskSizeInBytes),
                      }}
                    />
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {!requiresOfficialLauncher &&
          install.result &&
          install.result.options.length > 1 && (
            <DropdownSelect
              label={t("epic_install_build")}
              value={install.selected}
              disabled={install.starting}
              onValueChange={install.setSelected}
              options={[
                { value: "", label: t("epic_select_build") },
                ...install.result.options.map((option, index) => ({
                  value: String(index),
                  label: `${option.artifactId} (${option.platform})`,
                })),
              ]}
            />
          )}

        {!requiresOfficialLauncher && (
          <div className="epic-install-modal__path">
            <HorizontalFocusGroup
              className="epic-install-modal__path-row"
              style={{ alignItems: "flex-end" }}
            >
              <Input
                className="epic-install-modal__path-input"
                label={t("download_path")}
                value={install.path}
                readOnly
                focusNavigationState="hidden"
              />
              <Button
                focusId={EPIC_INSTALL_CHANGE_PATH_FOCUS_ID}
                variant="secondary"
                disabled={install.starting}
                onClick={() => void install.chooseDirectory()}
              >
                {t("change")}
              </Button>
            </HorizontalFocusGroup>
            <p className="epic-install-modal__hint">
              <Trans i18nKey="select_folder_hint" ns="game_details">
                <strong />
              </Trans>
            </p>
          </div>
        )}

        {managedError && (
          <div className="epic-install-modal__error">
            <p role="alert">{t(managedError.key, { ns: managedError.ns })}</p>
            {!requiresOfficialLauncher && (
              <HorizontalFocusGroup className="epic-install-modal__error-actions">
                <Button
                  variant="secondary"
                  disabled={install.loading || install.starting}
                  onClick={() => void install.retry()}
                >
                  {t("epic_retry")}
                </Button>
                {managedError.ns === "settings" && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onClose();
                      navigate("/settings?tab=integrations");
                    }}
                  >
                    {t("integrations", { ns: "settings" })}
                  </Button>
                )}
              </HorizontalFocusGroup>
            )}
          </div>
        )}

        <Button
          className="epic-install-modal__submit"
          focusId={EPIC_INSTALL_SUBMIT_FOCUS_ID}
          data-epic-install-submit={game?.objectId}
          variant="primary"
          disabled={disabled}
          loading={install.starting && !requiresOfficialLauncher}
          icon={
            hasActiveDownload && !requiresOfficialLauncher ? (
              <PlusIcon size={20} />
            ) : (
              <DownloadSimpleIcon size={20} />
            )
          }
          onClick={() => void install.start(hasActiveDownload)}
        >
          {hasActiveDownload && !requiresOfficialLauncher
            ? t("add_to_queue")
            : t("download_now")}
        </Button>
      </VerticalFocusGroup>
    </Modal>
  );
}
