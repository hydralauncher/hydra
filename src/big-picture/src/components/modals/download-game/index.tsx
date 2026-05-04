import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Downloader, getDownloadersForUris } from "@shared";
import { DOWNLOADER_NAME, IS_DESKTOP } from "../../../constants";
import {
  sortAvailableDownloaders,
  sortDownloadOptions,
  type DownloadOptionsSortBy,
} from "../../../helpers";
import { SourceAnchor } from "../../common/source-anchor";
import { DownloadSourceOption } from "../../common/download-source-option";
import {
  DownloadSourceOptionSkeleton,
  SourceAnchorSkeleton,
} from "../../skeletons";
import type {
  DiskUsage,
  Game,
  GameRepack,
  LibraryGame,
  UserPreferences,
} from "@types";
import {
  useGameDownloadOptions,
  useNavigationScreenActions,
} from "../../../hooks";
import {
  Button,
  DropdownSelect,
  HorizontalFocusGroup,
  Input,
  Modal,
  Tabs,
  type TabsItem,
  UserDiskItem,
  VerticalFocusGroup,
} from "../../common";
import {
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  SortAscendingIcon,
  StarIcon,
} from "@phosphor-icons/react";

import "./styles.scss";

interface DownloadGameModalProps {
  visible: boolean;
  onClose: () => void;
  game: Pick<Game, "objectId" | "shop" | "title" | "libraryHeroImageUrl">;
}

interface DownloadGameSourceListProps {
  game: Pick<Game, "objectId" | "shop" | "title" | "libraryHeroImageUrl">;
  visible: boolean;
  onSelectOption: (option: GameRepack) => void;
}

interface DownloadGameOptionsProps {
  game: Pick<Game, "objectId" | "shop" | "title" | "libraryHeroImageUrl">;
  option: GameRepack;
  visible: boolean;
  onClose: () => void;
}

interface DownloadDirectorySuggestion {
  title: string;
  path: string;
  freeBytes: number;
  totalBytes: number;
}

function hasActiveLibraryDownload(library: Array<Pick<LibraryGame, "download">>) {
  return library.some((libraryGame) => {
    const download = libraryGame.download;

    return Boolean(
      download &&
        (download.status === "active" ||
          download.status === "extracting" ||
          download.extracting)
    );
  });
}

const DOWNLOAD_SORT_OPTIONS: Array<{
  value: DownloadOptionsSortBy;
  label: string;
}> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "largest", label: "Largest" },
  { value: "smallest", label: "Smallest" },
];

enum DownloadGameStep {
  SourceList,
  Options,
}

export function DownloadGameModal({
  visible,
  onClose,
  game,
}: Readonly<DownloadGameModalProps>) {
  const [selectedOption, setSelectedOption] = useState<GameRepack | null>(null);
  const [step, setStep] = useState<DownloadGameStep>(
    DownloadGameStep.SourceList
  );

  const isntFirstStep = useMemo(() => {
    return step !== DownloadGameStep.SourceList;
  }, [step]);

  const handleNextStep = (option: GameRepack) => {
    setSelectedOption(option);
    setStep(DownloadGameStep.Options);
  };

  const handleOnBack = () => {
    if (isntFirstStep) setStep(DownloadGameStep.SourceList);
  };

  useNavigationScreenActions(
    isntFirstStep ? { press: { b: handleOnBack } } : {}
  );

  const stepTransitionKey =
    step === DownloadGameStep.SourceList ? "source-list" : "options";

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={game.title}
      description="Pick a repack from your download sources"
      coverImage={game.libraryHeroImageUrl ?? undefined}
      className="download-game-modal"
      closeOnB={!isntFirstStep}
      onBack={handleOnBack}
      animateLayout
    >
      <div className="download-game-modal__content">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={stepTransitionKey}
            className={`download-game-modal__step download-game-modal__step--${stepTransitionKey}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{
              opacity: { duration: 0.18, ease: "easeOut" },
              y: { duration: 0.18, ease: "easeOut" },
            }}
          >
            {step === DownloadGameStep.SourceList && (
              <DownloadGameSourceList
                game={game}
                visible={visible}
                onSelectOption={handleNextStep}
              />
            )}

            {step === DownloadGameStep.Options && selectedOption && (
              <DownloadGameOptions
                key={selectedOption.id}
                game={game}
                option={selectedOption}
                visible={visible}
                onClose={onClose}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </Modal>
  );
}

function DownloadGameSourceList({
  game,
  visible,
  onSelectOption,
}: Readonly<DownloadGameSourceListProps>) {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedSortOption, setSelectedSortOption] =
    useState<DownloadOptionsSortBy>("newest");

  const { downloadOptions, isLoading } = useGameDownloadOptions(game, visible);

  const downloadSources = useMemo(() => {
    return Array.from(
      new Set(downloadOptions.map((option) => option.downloadSourceName))
    );
  }, [downloadOptions]);

  const filteredDownloadOptions = useMemo(() => {
    const term = searchTerm.toLowerCase();

    return downloadOptions
      .filter((option) => option.title.toLowerCase().includes(term))
      .filter((option) => {
        if (selectedSources.length === 0) return true;

        return selectedSources.includes(option.downloadSourceName);
      });
  }, [downloadOptions, searchTerm, selectedSources]);

  const sortedDownloadOptions = useMemo(
    () => sortDownloadOptions(filteredDownloadOptions, selectedSortOption),
    [filteredDownloadOptions, selectedSortOption]
  );

  const handleSourceClick = (source: string) => {
    setSelectedSources((previousSources) =>
      previousSources.includes(source)
        ? previousSources.filter((previousSource) => previousSource !== source)
        : [...previousSources, source]
    );
  };

  const optionsTransitionKey = isLoading
    ? "loading"
    : `sorted-${selectedSortOption}-${selectedSources.toSorted((a, b) => a.localeCompare(b)).join("|") || "all"}`;

  return (
    <VerticalFocusGroup className="download-game-modal__source-list">
      <Input
        placeholder="Search options"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        iconLeft={<MagnifyingGlassIcon size={24} />}
      />

      <HorizontalFocusGroup className="download-game-modal__source-list__toolbar">
        <HorizontalFocusGroup className="download-game-modal__source-list__sources">
          {isLoading &&
            Array.from({ length: 3 }, (_, index) => (
              <SourceAnchorSkeleton
                key={`source-anchor-skeleton-${index}`}
                size="large"
              />
            ))}

          {!isLoading &&
            downloadSources.map((source) => (
              <SourceAnchor
                key={source}
                title={source}
                size="large"
                isSelected={selectedSources.includes(source)}
                onClick={() => handleSourceClick(source)}
              />
            ))}
        </HorizontalFocusGroup>

        <HorizontalFocusGroup className="download-game-modal__source-list__sort-options">
          <DropdownSelect
            value={selectedSortOption}
            options={DOWNLOAD_SORT_OPTIONS}
            onValueChange={setSelectedSortOption}
            leadingIcon={<SortAscendingIcon size={22} />}
            ariaLabel="Sort options"
            className="download-game-modal__source-list__sort-options-select"
          />
        </HorizontalFocusGroup>
      </HorizontalFocusGroup>

      <div className="download-game-modal__source-list__options">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={optionsTransitionKey}
            className="download-game-modal__source-list__options-transition"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{
              opacity: { duration: 0.18, ease: "easeOut" },
              y: { duration: 0.18, ease: "easeOut" },
            }}
          >
            {isLoading &&
              Array.from({ length: 3 }, (_, index) => (
                <DownloadSourceOptionSkeleton
                  key={`download-source-option-skeleton-${index}`}
                />
              ))}

            {!isLoading &&
              sortedDownloadOptions.map((option) => (
                <DownloadSourceOption
                  key={option.id}
                  option={option}
                  onSelect={() => onSelectOption(option)}
                />
              ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </VerticalFocusGroup>
  );
}

function DownloadGameOptions({
  game,
  option,
  visible,
  onClose,
}: Readonly<DownloadGameOptionsProps>) {
  const [selectedDownloadPath, setSelectedDownloadPath] = useState("");
  const [downloadDirectorySuggestions, setDownloadDirectorySuggestions] =
    useState<DownloadDirectorySuggestion[]>([]);
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null);
  const [selectedDownloader, setSelectedDownloader] = useState<string>();
  const [hasActiveDownload, setHasActiveDownload] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const downloaderItems = useMemo(() => {
    const availableDownloaders = sortAvailableDownloaders(
      getDownloadersForUris(option.uris),
      userPreferences
    );

    return availableDownloaders.map((downloader) => ({
      value: String(downloader),
      label: (
        <>
          {downloader === Downloader.Hydra && (
            <StarIcon size={14} weight="fill" aria-hidden="true" />
          )}
          <span>{DOWNLOADER_NAME[downloader]}</span>
        </>
      ),
    })) satisfies Array<TabsItem<string>>;
  }, [option.uris, userPreferences]);

  useEffect(() => {
    setSelectedDownloader(downloaderItems[0]?.value);
  }, [downloaderItems]);

  useEffect(() => {
    if (!visible || !IS_DESKTOP) {
      setHasActiveDownload(false);
      return;
    }

    let cancelled = false;

    const refreshActiveDownloadState = async () => {
      const library = await globalThis.window.electron.getLibrary();

      if (cancelled) return;

      setHasActiveDownload(hasActiveLibraryDownload(library));
    };

    void refreshActiveDownloadState();

    const unsubscribe = globalThis.window.electron.onDownloadsUpdated(() => {
      void refreshActiveDownloadState();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || !IS_DESKTOP) {
      setSelectedDownloadPath("");
      setDownloadDirectorySuggestions([]);
      setUserPreferences(null);
      setIsSubmitting(false);
      return;
    }

    let cancelled = false;

    const getDirectoryTitle = (path: string) => {
      const segments = path.split(/[\\/]/).filter(Boolean);
      return segments.at(-1) || path;
    };

    const buildDownloadDirectorySuggestions = async () => {
      const preferences = await globalThis.window.electron.getUserPreferences();
      const defaultDownloadsPath =
        await globalThis.window.electron.getDefaultDownloadsPath();
      const initialDownloadPath =
        preferences?.downloadsPath || defaultDownloadsPath;
      const uniquePaths = Array.from(
        new Set(
          [preferences?.downloadsPath, defaultDownloadsPath].filter(
            (value): value is string => Boolean(value)
          )
        )
      );

      const suggestions = await Promise.all(
        uniquePaths.map(async (path) => {
          let diskUsage: DiskUsage = { free: 0, total: 0 };

          try {
            diskUsage = await globalThis.window.electron.getDiskFreeSpace(path);
          } catch {
            diskUsage = { free: 0, total: 0 };
          }

          return {
            title: getDirectoryTitle(path),
            path,
            freeBytes: diskUsage.free,
            totalBytes: diskUsage.total,
          };
        })
      );

      if (cancelled) return;

      setUserPreferences(preferences);
      setSelectedDownloadPath(initialDownloadPath);
      setDownloadDirectorySuggestions(suggestions);
    };

    void buildDownloadDirectorySuggestions();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  const resolvedDownloader = useMemo(() => {
    if (!selectedDownloader) return null;

    return Number(selectedDownloader) as Downloader;
  }, [selectedDownloader]);

  const selectedUri = useMemo(() => {
    if (resolvedDownloader == null) return null;

    return (
      option.uris.find((uri) =>
        getDownloadersForUris([uri]).includes(resolvedDownloader)
      ) ?? null
    );
  }, [option.uris, resolvedDownloader]);

  const isSubmitDisabled =
    isSubmitting ||
    !selectedDownloadPath ||
    resolvedDownloader == null ||
    !selectedUri;

  const handleStartDownload = async () => {
    if (
      !IS_DESKTOP ||
      !selectedDownloadPath ||
      resolvedDownloader == null ||
      !selectedUri
    ) {
      return;
    }

    const payload = {
      objectId: game.objectId,
      title: game.title,
      shop: game.shop,
      uri: selectedUri,
      downloadPath: selectedDownloadPath,
      downloader: resolvedDownloader,
      automaticallyExtract: false,
      automaticallyDeleteArchiveFiles: false,
      fileSize: option.fileSize,
    } as const;

    setIsSubmitting(true);
    let shouldQueue = hasActiveDownload;

    try {
      const library = await globalThis.window.electron.getLibrary();
      shouldQueue = hasActiveLibraryDownload(library);

      const response = shouldQueue
        ? await globalThis.window.electron.addGameToQueue(payload)
        : await globalThis.window.electron.startGameDownload(payload);

      if (response.ok) {
        onClose();
        return;
      }

      console.error("download-game-modal failed to submit download", {
        action: shouldQueue ? "queue" : "start",
        error: response.error,
        game,
        option,
        downloader: resolvedDownloader,
        downloadPath: selectedDownloadPath,
        uri: selectedUri,
      });
    } catch (error) {
      console.error("download-game-modal failed to submit download", {
        action: hasActiveDownload ? "queue" : "start",
        error,
        game,
        option,
        downloader: resolvedDownloader,
        downloadPath: selectedDownloadPath,
        uri: selectedUri,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="download-game-modal__options">
      <VerticalFocusGroup>
        <div className="download-game-modal__chosen-repack">
          <p className="download-game-modal__chosen-repack-label">
            Chosen Option
          </p>
          <p className="download-game-modal__chosen-repack-title">
            {option.title}
          </p>
        </div>

        <div className="download-game-modal__downloader">
          <div className="download-game-modal__downloader-copy">
            <p className="download-game-modal__downloader-label">Downloader</p>
            <p className="download-game-modal__downloader-description">
              Choose a download method
            </p>
          </div>

          <Tabs
            items={downloaderItems}
            value={selectedDownloader}
            defaultValue={downloaderItems[0]?.value}
            onValueChange={setSelectedDownloader}
            variant="segmented"
            ariaLabel="Download methods"
            className="download-game-modal__downloader-tabs"
          />
        </div>

        <div className="download-game-modal__directory">
          <div className="download-game-modal__directory-copy">
            <p className="download-game-modal__directory-label">
              Download directory
            </p>
            <p className="download-game-modal__directory-description">
              To create or change the default download folders, go to{" "}
              <span>Settings</span>
            </p>
          </div>

          <HorizontalFocusGroup
            className="download-game-modal__directory-disks"
            style={{
              display: "grid",
              width: "100%",
              alignItems: "stretch",
              gap: "calc(var(--spacing-unit) * 2)",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            }}
          >
            {downloadDirectorySuggestions.map((directory) => (
              <UserDiskItem
                key={directory.path}
                title={directory.title}
                path={directory.path}
                freeBytes={directory.freeBytes}
                totalBytes={directory.totalBytes}
                isSelected={selectedDownloadPath === directory.path}
                onClick={() => setSelectedDownloadPath(directory.path)}
                className="download-game-modal__directory-disk"
              />
            ))}
          </HorizontalFocusGroup>
        </div>

        <div className="download-game-modal__actions">
          <Button
            icon={<DownloadSimpleIcon size={20} />}
            loading={isSubmitting}
            disabled={isSubmitDisabled}
            onClick={handleStartDownload}
          >
            {hasActiveDownload ? "Add to Queue" : "Start Download"}
          </Button>
        </div>
      </VerticalFocusGroup>
    </div>
  );
}
