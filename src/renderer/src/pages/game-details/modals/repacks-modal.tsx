import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { PlusCircleIcon } from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";

import { Badge, Button, Modal, TextField } from "@renderer/components";
import type { DownloadSource, Game, GameRepack } from "@types";

import { DownloadSettingsModal } from "./download-settings-modal";
import { RepacksSourcesSidebar } from "./repacks-sources-sidebar";
import { gameDetailsContext } from "@renderer/context";
import { Downloader } from "@shared";
import { orderBy } from "lodash-es";
import { useDate, useAppDispatch, useAppSelector } from "@renderer/hooks";
import { clearNewDownloadOptions } from "@renderer/features";
import { levelDBService } from "@renderer/services/leveldb.service";
import { getGameKey } from "@renderer/helpers";
import "./repacks-modal.scss";

export interface RepacksModalProps {
  visible: boolean;
  startDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string,
    automaticallyExtract: boolean,
    addToQueueOnly?: boolean,
    fileIndices?: number[],
    selectedFilesSize?: number | null,
    automaticallyDeleteArchiveFiles?: boolean,
    signal?: AbortSignal
  ) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

export function RepacksModal({
  visible,
  startDownload,
  onClose,
}: Readonly<RepacksModalProps>) {
  const [filteredRepacks, setFilteredRepacks] = useState<GameRepack[]>([]);
  const [repack, setRepack] = useState<GameRepack | null>(null);
  const [showSelectFolderModal, setShowSelectFolderModal] = useState(false);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [selectedFingerprints, setSelectedFingerprints] = useState<string[]>(
    []
  );
  const [filterTerm, setFilterTerm] = useState("");
  const [lastCheckTimestamp, setLastCheckTimestamp] = useState<string | null>(
    null
  );
  const [isLoadingTimestamp, setIsLoadingTimestamp] = useState(true);
  const [viewedRepackIds, setViewedRepackIds] = useState<Set<string>>(
    new Set()
  );

  const { game, repacks } = useContext(gameDetailsContext);
  const { t } = useTranslation("game_details");
  const { formatDate } = useDate();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  useEffect(() => {
    levelDBService
      .values("downloadSources")
      .then((sources) =>
        setDownloadSources(
          orderBy((sources as DownloadSource[]) || [], "createdAt", "desc")
        )
      )
      .catch(() => setDownloadSources([]));
  }, []);

  useEffect(() => {
    if (visible && userPreferences?.enableNewDownloadOptionsBadges !== false) {
      setIsLoadingTimestamp(true);
      levelDBService
        .get("downloadSourcesSinceValue", null, "utf8")
        .then((ts) => setLastCheckTimestamp(ts as string | null))
        .catch(() => setLastCheckTimestamp(null))
        .finally(() => setIsLoadingTimestamp(false));
    } else {
      setIsLoadingTimestamp(false);
    }
  }, [visible, userPreferences?.enableNewDownloadOptionsBadges]);

  useEffect(() => {
    if (
      visible &&
      game?.newDownloadOptionsCount &&
      game.newDownloadOptionsCount > 0
    ) {
      const gameKey = getGameKey(game.shop, game.objectId);
      levelDBService
        .get(gameKey, "games")
        .then((data) => {
          if (data)
            levelDBService.put(
              gameKey,
              { ...(data as Game), newDownloadOptionsCount: undefined },
              "games"
            );
        })
        .catch(() => {});
      dispatch(
        clearNewDownloadOptions({ gameId: `${game.shop}:${game.objectId}` })
      );
    }
  }, [visible, game, dispatch]);

  const sortedRepacks = useMemo(
    () => orderBy(repacks, [(r) => r.uploadDate], ["desc"]),
    [repacks]
  );

  const getRepackAvailabilityStatus = (
    r: GameRepack
  ): "online" | "partial" | "offline" => {
    const uris = Array.isArray(r.uris) ? r.uris : [];
    const unavailableSet = new Set(r.unavailableUris ?? []);
    const availableCount = uris.filter(
      (uri) => !unavailableSet.has(uri)
    ).length;
    const unavailableCount = uris.length - availableCount;
    if (uris.length === 0 || availableCount === 0) return "offline";
    if (unavailableCount === 0) return "online";
    return "partial";
  };

  useEffect(() => {
    const term = filterTerm.trim().toLowerCase();
    const byTerm = sortedRepacks.filter((r) => {
      if (!term) return true;
      return (
        r.title.toLowerCase().includes(term) ||
        r.downloadSourceName.toLowerCase().includes(term)
      );
    });

    const bySource = byTerm.filter((r) => {
      if (selectedFingerprints.length === 0) return true;
      return downloadSources.some(
        (src) =>
          src.fingerprint &&
          selectedFingerprints.includes(src.fingerprint) &&
          src.name === r.downloadSourceName
      );
    });

    setFilteredRepacks(bySource);
  }, [sortedRepacks, filterTerm, selectedFingerprints, downloadSources]);

  const handleRepackClick = (r: GameRepack) => {
    setRepack(r);
    setShowSelectFolderModal(true);
    setViewedRepackIds((prev) => new Set(prev).add(r.id));
  };

  const isNewRepack = (r: GameRepack): boolean => {
    if (
      isLoadingTimestamp ||
      viewedRepackIds.has(r.id) ||
      !lastCheckTimestamp ||
      !r.createdAt
    )
      return false;
    try {
      const lastDate = new Date(lastCheckTimestamp);
      return !isNaN(lastDate.getTime()) && r.createdAt > lastDate.toISOString();
    } catch {
      return false;
    }
  };

  return (
    <>
      <DownloadSettingsModal
        visible={showSelectFolderModal}
        onClose={() => setShowSelectFolderModal(false)}
        startDownload={startDownload}
        repack={repack}
      />

      <Modal
        visible={visible}
        title={t("download_options_title")}
        description={t("repacks_modal_description")}
        onClose={onClose}
        large
        className="repacks-modal"
      >
        <div className="repacks-modal__container">
          <RepacksSourcesSidebar
            sources={downloadSources}
            selectedFingerprints={selectedFingerprints}
            onToggleFingerprint={(fp) =>
              setSelectedFingerprints((prev) =>
                prev.includes(fp) ? prev.filter((f) => f !== fp) : [...prev, fp]
              )
            }
            onClearFingerprints={() => setSelectedFingerprints([])}
            repacks={sortedRepacks}
          />

          <section className="repacks-modal__main">
            <div className="repacks-modal__search-bar">
              <TextField
                placeholder={t("filter")}
                value={filterTerm}
                onChange={(e) => setFilterTerm(e.target.value)}
              />
            </div>

            <div className="repacks-modal__repacks-list">
              {filteredRepacks.length === 0 ? (
                <div className="repacks-modal__no-results">
                  <div className="repacks-modal__no-results-content">
                    <p className="repacks-modal__no-results-text">
                      {t("no_repacks_found")}
                    </p>
                    <Button
                      type="button"
                      theme="primary"
                      onClick={() => {
                        onClose();
                        navigate("/settings?tab=download_sources");
                      }}
                    >
                      <PlusCircleIcon />
                      {t("add_download_source", { ns: "settings" })}
                    </Button>
                  </div>
                </div>
              ) : (
                filteredRepacks.map((r) => {
                  const availability = getRepackAvailabilityStatus(r);
                  const isLastDownloaded =
                    game?.download?.uri &&
                    Array.isArray(r.uris) &&
                    r.uris.some((u) => u.includes(game.download!.uri));
                  const tooltipId = `orb-${r.id}`;

                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handleRepackClick(r)}
                      className="repacks-modal__repack-item"
                    >
                      <span
                        className={`repacks-modal__availability-orb repacks-modal__availability-orb--${availability}`}
                        data-tooltip-id={tooltipId}
                        data-tooltip-content={t(`source_${availability}`)}
                      />
                      <Tooltip id={tooltipId} />

                      <div className="repacks-modal__repack-content">
                        <div className="repacks-modal__repack-header-row">
                          <span className="repacks-modal__repack-title">
                            {r.title}
                          </span>
                          {userPreferences?.enableNewDownloadOptionsBadges !==
                            false &&
                            isNewRepack(r) && (
                              <span className="repacks-modal__new-badge">
                                {t("new_download_option")}
                              </span>
                            )}
                          {isLastDownloaded && (
                            <Badge>{t("last_downloaded_option")}</Badge>
                          )}
                        </div>

                        <div className="repacks-modal__repack-meta">
                          <span className="repacks-modal__repack-size">
                            {r.fileSize}
                          </span>
                          <span className="repacks-modal__repack-separator">
                            •
                          </span>
                          <span className="repacks-modal__repack-source">
                            {r.downloadSourceName}
                          </span>
                          {r.uploadDate && (
                            <>
                              <span className="repacks-modal__repack-separator">
                                •
                              </span>
                              <span>{formatDate(r.uploadDate)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </Modal>
    </>
  );
}
