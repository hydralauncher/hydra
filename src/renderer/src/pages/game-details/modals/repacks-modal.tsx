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
  const [sizeSortDirection, setSizeSortDirection] = useState<
    "none" | "asc" | "desc"
  >("none");
  const [dateSortDirection, setDateSortDirection] = useState<
    "none" | "asc" | "desc"
  >("none");

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

  const parseFileSizeToGb = (fileSize: string | null): number | null => {
    if (!fileSize) return null;

    const lower = fileSize.toLowerCase();
    const match = lower.match(/([0-9]+[0-9.,]*)/);
    if (!match) return null;

    const normalized = match[1].replace(",", ".");
    const value = Number.parseFloat(normalized);
    if (Number.isNaN(value)) return null;

    if (lower.includes("tb")) return value * 1024;
    if (lower.includes("mb")) return value / 1024;
    if (lower.includes("kb")) return value / (1024 * 1024);

    return value;
  };

  const parseUploadDateToTimestamp = (
    uploadDate: string | null
  ): number | null => {
    if (!uploadDate) return null;

    const direct = new Date(uploadDate);
    if (!Number.isNaN(direct.getTime())) {
      return direct.getTime();
    }

    const match = uploadDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      const parsed = new Date(
        Number.parseInt(year, 10),
        Number.parseInt(month, 10) - 1,
        Number.parseInt(day, 10)
      );
      const time = parsed.getTime();
      if (!Number.isNaN(time)) {
        return time;
      }
    }

    return null;
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
      globalThis.electron.clearNewDownloadOptions(game.shop, game.objectId);

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

    let sortedBy = bySource;

    if (sizeSortDirection !== "none") {
      sortedBy = [...sortedBy].sort((a, b) => {
        const sizeA = parseFileSizeToGb(a.fileSize);
        const sizeB = parseFileSizeToGb(b.fileSize);

        if (sizeA === null && sizeB === null) return 0;
        if (sizeA === null) return 1;
        if (sizeB === null) return -1;

        return sizeSortDirection === "asc" ? sizeA - sizeB : sizeB - sizeA;
      });
    } else if (dateSortDirection !== "none") {
      sortedBy = [...sortedBy].sort((a, b) => {
        const dateA = parseUploadDateToTimestamp(a.uploadDate);
        const dateB = parseUploadDateToTimestamp(b.uploadDate);

        if (dateA === null && dateB === null) return 0;
        if (dateA === null) return 1;
        if (dateB === null) return -1;

        return dateSortDirection === "asc" ? dateA - dateB : dateB - dateA;
      });
    }

    setFilteredRepacks(sortedBy);
  }, [
    sortedRepacks,
    filterTerm,
    selectedFingerprints,
    downloadSources,
    sizeSortDirection,
    dateSortDirection,
  ]);

  const handleRepackClick = (repack: GameRepack) => {
    setRepack(repack);
    setShowSelectFolderModal(true);
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
    if (isLoadingTimestamp) return false;

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

  const toggleSizeSortDirection = () => {
    setSizeSortDirection((prev) => {
      if (prev === "none") {
        setDateSortDirection("none");
        return "desc";
      }
      if (prev === "desc") return "asc";
      return "none";
    });
  };

  const toggleDateSortDirection = () => {
    setDateSortDirection((prev) => {
      if (prev === "none") {
        setSizeSortDirection("none");
        return "desc";
      }
      if (prev === "desc") return "asc";
      return "none";
    });
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
            <div className="repacks-modal__filter-actions">
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
              <Button
                type="button"
                theme="outline"
                onClick={toggleSizeSortDirection}
                className="repacks-modal__filter-toggle"
              >
                {t("sort_by_size")}
                {sizeSortDirection === "desc"
                  ? " ↓"
                  : sizeSortDirection === "asc"
                    ? " ↑"
                    : ""}
              </Button>
              <Button
                type="button"
                theme="outline"
                onClick={toggleDateSortDirection}
                className="repacks-modal__filter-toggle"
              >
                {t("sort_by_date")}
                {dateSortDirection === "desc"
                  ? " ↓"
                  : dateSortDirection === "asc"
                    ? " ↑"
                    : ""}
              </Button>
            </div>
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
