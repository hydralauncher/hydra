import { useEffect, useId, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import { Tooltip } from "react-tooltip";
import {
  ChevronDownIcon,
  DownloadIcon,
  ImageIcon,
  PlusIcon,
  SyncIcon,
} from "@primer/octicons-react";
import {
  Button,
  CheckboxField,
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

function ExtraName({
  name,
  tooltip,
  tooltipId,
}: Readonly<{ name: string; tooltip: string; tooltipId: string }>) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setTruncated(element.scrollWidth > element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [name]);
  return (
    <span
      ref={ref}
      className="epic-install-modal__extra-name"
      {...(truncated
        ? { "data-tooltip-id": tooltipId, "data-tooltip-content": tooltip }
        : {})}
    >
      {name}
    </span>
  );
}

function EpicInstallSubmitLabel({
  starting,
  queue,
}: Readonly<{ starting: boolean; queue: boolean }>) {
  const { t } = useTranslation("game_details");
  if (starting)
    return (
      <>
        <SyncIcon className="download-settings-modal__loading-spinner" />
        {t("loading")}
      </>
    );
  if (queue)
    return (
      <>
        <PlusIcon />
        {t("add_to_queue")}
      </>
    );
  return (
    <>
      <DownloadIcon />
      {t("download_now")}
    </>
  );
}

function useListHasMore(open: boolean, length: number) {
  const listRef = useRef<HTMLUListElement>(null);
  const [hasMore, setHasMore] = useState(false);
  const measure = () => {
    const list = listRef.current;
    setHasMore(
      !!list && list.scrollTop + list.clientHeight < list.scrollHeight - 1
    );
  };
  useEffect(() => {
    const list = listRef.current;
    if (!list) return setHasMore(false);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [open, length]);
  return { listRef, hasMore, measure };
}

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
  const summary = install.extrasSummary;
  const [openExtrasFor, setOpenExtrasFor] = useState<string | null>(null);
  const extrasOpen = !!game && openExtrasFor === game.objectId;
  const extrasPanelId = useId();
  const {
    listRef,
    hasMore: listHasMore,
    measure: measureList,
  } = useListHasMore(extrasOpen, install.extras.length);
  const extrasTooltipId = useId();
  const sizeLabel = (download: number) =>
    t("epic_selection_size", { size: formatBytes(download) });
  return (
    <Modal
      visible={!!game}
      className="epic-install-modal-dialog"
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
                          install.choice.downloadSizeInBytes == null
                            ? "—"
                            : formatBytes(install.choice.downloadSizeInBytes),
                      }}
                    />
                  </span>
                  <span>
                    <Trans
                      i18nKey="required_storage_space"
                      ns="game_details"
                      values={{
                        size:
                          install.choice.diskSizeInBytes == null
                            ? "—"
                            : formatBytes(install.choice.diskSizeInBytes),
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
        {!requiresOfficialLauncher && install.extras.length > 0 && (
          <div className="epic-install-modal__extras">
            <button
              type="button"
              className="epic-install-modal__extras-header"
              aria-expanded={extrasOpen}
              aria-controls={extrasPanelId}
              onClick={() =>
                setOpenExtrasFor(extrasOpen ? null : (game?.objectId ?? null))
              }
            >
              <span className="epic-install-modal__extras-heading">
                <strong>{t("epic_extras_title")}</strong>
                <span className="epic-install-modal__extras-summary">
                  {t("epic_extras_selected", {
                    selected: summary.selected,
                    total: summary.total,
                  })}
                </span>
              </span>
              {summary.selected > 0 && (
                <span className="epic-install-modal__extras-summary">
                  +{formatBytes(summary.selectedDownloadSizeInBytes)}
                </span>
              )}
              <ChevronDownIcon
                className={`epic-install-modal__extras-chevron ${
                  extrasOpen ? "epic-install-modal__extras-chevron--open" : ""
                }`}
              />
            </button>
            {extrasOpen && (
              <div
                id={extrasPanelId}
                className="epic-install-modal__extras-panel"
              >
                {summary.total > 0 && (
                  <div className="epic-install-modal__extras-all">
                    <CheckboxField
                      label={t("epic_select_all")}
                      checked={summary.selected === summary.total}
                      indeterminate={
                        summary.selected > 0 && summary.selected < summary.total
                      }
                      disabled={install.starting}
                      onChange={(event) =>
                        install.setAllExtras(event.target.checked)
                      }
                    />
                    <span className="epic-install-modal__extras-summary">
                      {summary.selected}/{summary.total}
                    </span>
                  </div>
                )}
                <div
                  className={`epic-install-modal__extras-scroll ${
                    listHasMore ? "epic-install-modal__extras-scroll--more" : ""
                  }`}
                >
                  <ul
                    ref={listRef}
                    className="epic-install-modal__extras-list"
                    onScroll={measureList}
                  >
                    {install.extras.map((extra) => (
                      <li key={extra.key} className="epic-install-modal__extra">
                        <CheckboxField
                          label={
                            <span className="epic-install-modal__extra-label">
                              <ExtraName
                                name={extra.name}
                                tooltipId={extrasTooltipId}
                                tooltip={`${extra.name} · ${sizeLabel(extra.downloadSizeInBytes)}`}
                              />
                              {extra.installed && (
                                <span className="epic-install-modal__extra-badge">
                                  {t("epic_dlc_installed")}
                                </span>
                              )}
                              <span className="epic-install-modal__extra-size">
                                {extra.installed
                                  ? "—"
                                  : formatBytes(extra.downloadSizeInBytes)}
                              </span>
                            </span>
                          }
                          checked={extra.checked}
                          disabled={extra.installed || install.starting}
                          onChange={(event) =>
                            install.toggleExtra(extra, event.target.checked)
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </div>
                <Tooltip id={extrasTooltipId} place="top-start" />
              </div>
            )}
          </div>
        )}
        {!requiresOfficialLauncher && install.insufficientSpace && (
          <p role="alert" className="epic-install-modal__warning">
            {t("epic_not_enough_space")}
          </p>
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
          <EpicInstallSubmitLabel
            starting={install.starting && !requiresOfficialLauncher}
            queue={hasActiveDownload && !requiresOfficialLauncher}
          />
        </Button>
      </div>
    </Modal>
  );
}
