import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import {
  DownloadIcon,
  ImageIcon,
  PlusIcon,
  SyncIcon,
} from "@primer/octicons-react";
import {
  Button,
  Link,
  Modal,
  SelectField,
  TextField,
} from "@renderer/components";
import { getVerticalCoverCardImageSources } from "@renderer/components/vertical-cover-card/vertical-cover-card-image-sources";
import { useDownload } from "@renderer/hooks/use-download";
import { useEpicInstall } from "@renderer/hooks/use-epic-install";
import { formatBytes } from "@shared";
import type { LibraryGame } from "@types";
import "./epic-install-modal.scss";
import { getEpicManagedError } from "@renderer/helpers/epic-managed-error";
import { useNavigate } from "react-router-dom";
import "./download-settings-modal.scss";

export function EpicInstallModal({
  game,
  presentationGame,
  onClose,
  onStarted,
}: Readonly<{
  game: LibraryGame | null;
  presentationGame?: LibraryGame | null;
  onClose: () => void;
  onStarted: () => void;
}>) {
  const { t } = useTranslation("game_details");
  const navigate = useNavigate();
  const install = useEpicInstall(game, onStarted);
  const requiresOfficialLauncher =
    install.error === "external-launcher-required";
  const { lastPacket } = useDownload();
  const hasActiveDownload = lastPacket !== null;
  const displayedGame = presentationGame ?? game;
  const coverSources = getVerticalCoverCardImageSources([
    displayedGame?.customCoverImageUrl,
    displayedGame?.coverImageUrl,
    displayedGame?.libraryImageUrl,
    displayedGame?.customIconUrl,
    displayedGame?.iconUrl,
  ]);
  const coverSourcesKey = coverSources.join("\u0000");
  const [coverIndex, setCoverIndex] = useState(0);
  useEffect(() => setCoverIndex(0), [coverSourcesKey]);
  const disabled =
    requiresOfficialLauncher ||
    install.loading ||
    install.starting ||
    !install.option ||
    !install.result?.connectionId ||
    !install.path;
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
      onClose={onClose}
    >
      <div className="download-settings-modal__container epic-install-modal">
        <div className="epic-install-modal__summary">
          <div className="epic-install-modal__cover">
            {coverSources[coverIndex] ? (
              <img
                src={coverSources[coverIndex]}
                alt=""
                onError={() => setCoverIndex((index) => index + 1)}
              />
            ) : (
              <ImageIcon size={24} />
            )}
          </div>
          <strong
            className="epic-install-modal__title"
            title={displayedGame?.title}
          >
            {displayedGame?.title}
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
                  <Skeleton
                    width={100}
                    height={14}
                    containerClassName="epic-install-modal__size-skeleton"
                  />
                  <Skeleton
                    width={150}
                    height={14}
                    containerClassName="epic-install-modal__size-skeleton"
                  />
                </>
              ) : (
                <>
                  <span>
                    <Trans
                      i18nKey="download_size"
                      ns="game_details"
                      values={{
                        size:
                          install.option?.downloadSizeInBytes == null
                            ? "—"
                            : formatBytes(install.option.downloadSizeInBytes),
                      }}
                    />
                  </span>
                  <span>
                    <Trans
                      i18nKey="required_storage_space"
                      ns="game_details"
                      values={{
                        size:
                          install.option?.diskSizeInBytes == null
                            ? "—"
                            : formatBytes(install.option.diskSizeInBytes),
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
            <SelectField
              label={t("epic_install_build")}
              value={install.selected}
              disabled={install.starting}
              onChange={(event) => install.setSelected(event.target.value)}
              options={[
                { key: "", value: "", label: t("epic_select_build") },
                ...install.result.options.map((option, index) => ({
                  key: String(index),
                  value: String(index),
                  label: `${option.artifactId} (${option.platform})`,
                })),
              ]}
            />
          )}
        {!requiresOfficialLauncher && (
          <div className="download-settings-modal__downloads-path-field">
            <TextField
              label={t("download_path")}
              value={install.path}
              readOnly
              disabled
              rightContent={
                <Button
                  className="download-settings-modal__change-path-button"
                  theme="outline"
                  disabled={install.starting}
                  onClick={() => void install.chooseDirectory()}
                >
                  {t("change")}
                </Button>
              }
            />
            <p className="download-settings-modal__hint-text">
              <Trans i18nKey="select_folder_hint" ns="game_details">
                <Link to="/settings" />
              </Trans>
            </p>
          </div>
        )}
        {install.error && (
          <>
            <p role="alert">
              {t(getEpicManagedError(install.error).key, {
                ns: getEpicManagedError(install.error).ns,
              })}
            </p>
            {!requiresOfficialLauncher && (
              <>
                <Button
                  theme="outline"
                  disabled={install.loading || install.starting}
                  onClick={() => void install.retry()}
                >
                  {t("epic_retry")}
                </Button>
                {getEpicManagedError(install.error).ns === "settings" && (
                  <Button
                    theme="outline"
                    onClick={() => {
                      onClose();
                      navigate("/settings?tab=integrations");
                    }}
                  >
                    {t("integrations", { ns: "settings" })}
                  </Button>
                )}
              </>
            )}
          </>
        )}
        <Button
          data-epic-install-submit={game?.objectId}
          disabled={disabled}
          onClick={() => void install.start(hasActiveDownload)}
        >
          {install.starting && !requiresOfficialLauncher ? (
            <>
              <SyncIcon className="download-settings-modal__loading-spinner" />
              {t("loading")}
            </>
          ) : hasActiveDownload && !requiresOfficialLauncher ? (
            <>
              <PlusIcon />
              {t("add_to_queue")}
            </>
          ) : (
            <>
              <DownloadIcon />
              {t("download_now")}
            </>
          )}
        </Button>
      </div>
    </Modal>
  );
}
