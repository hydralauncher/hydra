import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  PlusCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@primer/octicons-react";

import {
  Badge,
  Button,
  DebridBadge,
  Modal,
  TextField,
  CheckboxField,
} from "@renderer/components";
import type { DownloadSource, GameRepack } from "@types";

import { DownloadSettingsModal } from "./download-settings-modal";
import { gameDetailsContext } from "@renderer/context";
import { Downloader } from "@shared";
import { orderBy } from "lodash-es";
import { useDate, useFeature, useAppDispatch } from "@renderer/hooks";
import { clearNewDownloadOptions } from "@renderer/features";
import "./repacks-modal.scss";

export interface RepacksModalProps {
  visible: boolean;
  startDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string,
    automaticallyExtract: boolean
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

  const [hashesInDebrid, setHashesInDebrid] = useState<Record<string, boolean>>(
    {}
  );
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

  const getHashFromMagnet = (magnet: string) => {
    if (!magnet || typeof magnet !== "string") {
      return null;
    }

    const hashRegex = /xt=urn:btih:([a-zA-Z0-9]+)/i;
    const match = magnet.match(hashRegex);

    return match ? match[1].toLowerCase() : null;
  };

  const { isFeatureEnabled, Feature } = useFeature();

  useEffect(() => {
    if (!isFeatureEnabled(Feature.NimbusPreview)) {
      return;
    }

    const magnets = repacks.flatMap((repack) =>
      repack.uris.filter((uri) => uri.startsWith("magnet:"))
    );

    window.electron.checkDebridAvailability(magnets).then((availableHashes) => {
      setHashesInDebrid(availableHashes);
    });
  }, [repacks, isFeatureEnabled, Feature]);

  useEffect(() => {
    const fetchDownloadSources = async () => {
      const sources = await window.electron.getDownloadSources();
      setDownloadSources(sources);
    };

    fetchDownloadSources();
  }, []);

  useEffect(() => {
    const fetchLastCheckTimestamp = async () => {
      setIsLoadingTimestamp(true);

      const timestamp = await window.electron.getDownloadSourcesSinceValue();

      setLastCheckTimestamp(timestamp);
      setIsLoadingTimestamp(false);
    };

    if (visible) {
      fetchLastCheckTimestamp();
    }
  }, [visible, repacks]);

  useEffect(() => {
    if (
      visible &&
      game?.newDownloadOptionsCount &&
      game.newDownloadOptionsCount > 0
    ) {
      // Clear the badge in the database
      globalThis.electron.clearNewDownloadOptions(game.shop, game.objectId);

      // Clear the badge in Redux store
      const gameId = `${game.shop}:${game.objectId}`;
      dispatch(clearNewDownloadOptions({ gameId }));
    }
  }, [visible, game, dispatch]);

  const sortedRepacks = useMemo(() => {
    return orderBy(
      repacks,
      [
        (repack) => {
          const magnet = repack.uris.find((uri) => uri.startsWith("magnet:"));
          const hash = magnet ? getHashFromMagnet(magnet) : null;
          return hash ? (hashesInDebrid[hash] ?? false) : false;
        },
        (repack) => repack.uploadDate,
      ],
      ["desc", "desc"]
    );
  }, [repacks, hashesInDebrid]);

  useEffect(() => {
    const term = filterTerm.trim().toLowerCase();

    const byTerm = sortedRepacks.filter((repack) => {
      if (!term) return true;
      const lowerTitle = repack.title.toLowerCase();
      const lowerRepacker = repack.downloadSourceName.toLowerCase();
      return lowerTitle.includes(term) || lowerRepacker.includes(term);
    });

    const bySource = byTerm.filter((repack) => {
      if (selectedFingerprints.length === 0) return true;

      return downloadSources.some(
        (src) =>
          src.fingerprint &&
          selectedFingerprints.includes(src.fingerprint) &&
          src.name === repack.downloadSourceName
      );
    });

    setFilteredRepacks(bySource);
  }, [sortedRepacks, filterTerm, selectedFingerprints, downloadSources]);

  const handleRepackClick = (repack: GameRepack) => {
    setRepack(repack);
    setShowSelectFolderModal(true);
    // Mark this repack as viewed to hide the "NEW" badge
    setViewedRepackIds((prev) => new Set(prev).add(repack.id));
  };

  const handleFilter: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setFilterTerm(event.target.value);
  };

  const toggleFingerprint = (fingerprint: string) => {
    setSelectedFingerprints((prev) =>
      prev.includes(fingerprint)
        ? prev.filter((f) => f !== fingerprint)
        : [...prev, fingerprint]
    );
  };

  const checkIfLastDownloadedOption = (repack: GameRepack) => {
    if (!game?.download) return false;
    return repack.uris.some((uri) => uri.includes(game.download!.uri));
  };

  const isNewRepack = (repack: GameRepack): boolean => {
    // Don't show badge while loading timestamp
    if (isLoadingTimestamp) return false;

    // Don't show badge if user has already clicked this repack in current session
    if (viewedRepackIds.has(repack.id)) return false;

    if (!lastCheckTimestamp || !repack.createdAt) {
      return false;
    }

    const lastCheckUtc = new Date(lastCheckTimestamp).toISOString();

    return repack.createdAt > lastCheckUtc;
  };

  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

  useEffect(() => {
    if (!visible) {
      setFilterTerm("");
      setSelectedFingerprints([]);
      setIsFilterDrawerOpen(false);
    }
  }, [visible]);

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
        title={t("download_options")}
        description={t("repacks_modal_description")}
        onClose={onClose}
      >
        <div
          className={`repacks-modal__filter-container ${isFilterDrawerOpen ? "repacks-modal__filter-container--drawer-open" : ""}`}
        >
          <div className="repacks-modal__filter-top">
            <TextField
              placeholder={t("filter")}
              value={filterTerm}
              onChange={handleFilter}
            />
            {downloadSources.length > 0 && (
              <Button
                type="button"
                theme="outline"
                onClick={() => setIsFilterDrawerOpen(!isFilterDrawerOpen)}
                className="repacks-modal__filter-toggle"
              >
                {t("filter_by_source")}
                {isFilterDrawerOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
              </Button>
            )}
          </div>

          <div
            className={`repacks-modal__download-sources ${isFilterDrawerOpen ? "repacks-modal__download-sources--open" : ""}`}
          >
            <div className="repacks-modal__source-grid">
              {downloadSources
                .filter(
                  (
                    source
                  ): source is DownloadSource & { fingerprint: string } =>
                    source.fingerprint !== undefined
                )
                .map((source) => {
                  const label = source.name || source.url;
                  const truncatedLabel =
                    label.length > 16 ? label.substring(0, 16) + "..." : label;
                  return (
                    <div
                      key={source.fingerprint}
                      className="repacks-modal__source-item"
                    >
                      <CheckboxField
                        label={truncatedLabel}
                        checked={selectedFingerprints.includes(
                          source.fingerprint
                        )}
                        onChange={() => toggleFingerprint(source.fingerprint)}
                      />
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        <div className="repacks-modal__repacks">
          {filteredRepacks.length === 0 ? (
            <div className="repacks-modal__no-results">
              <div className="repacks-modal__no-results-content">
                <div className="repacks-modal__no-results-text">
                  {t("no_repacks_found")}
                </div>
                <div className="repacks-modal__no-results-button">
                  <Button
                    type="button"
                    theme="primary"
                    onClick={() => {
                      onClose();
                      navigate("/settings?tab=2");
                    }}
                  >
                    <PlusCircleIcon />
                    {t("add_download_source", { ns: "settings" })}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            filteredRepacks.map((repack) => {
              const isLastDownloadedOption =
                checkIfLastDownloadedOption(repack);

              return (
                <Button
                  key={repack.id}
                  theme="dark"
                  onClick={() => handleRepackClick(repack)}
                  className="repacks-modal__repack-button"
                >
                  <p className="repacks-modal__repack-title">
                    {repack.title}
                    {isNewRepack(repack) && (
                      <span className="repacks-modal__new-badge">
                        {t("new_download_option")}
                      </span>
                    )}
                  </p>

                  {isLastDownloadedOption && (
                    <Badge>{t("last_downloaded_option")}</Badge>
                  )}

                  <p className="repacks-modal__repack-info">
                    {repack.fileSize} - {repack.downloadSourceName} -{" "}
                    {repack.uploadDate ? formatDate(repack.uploadDate) : ""}
                  </p>

                  {hashesInDebrid[getHashFromMagnet(repack.uris[0]) ?? ""] && (
                    <DebridBadge />
                  )}
                </Button>
              );
            })
          )}
        </div>
      </Modal>
    </>
  );
}
