import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Downloader,
  getDownloadDirectoryTitle,
  resolveDownloadDirectories,
} from "@shared";
import { DOWNLOADER_NAME, IS_DESKTOP } from "../../../constants";
import useEmblaCarousel from "embla-carousel-react";
import {
  getDownloaderAvailabilityOptions,
  sortDownloadOptions,
  type DownloadOptionsSortBy,
} from "../../../helpers";
import { SourceAnchor } from "../../common/source-anchor";
import { DownloadSourceOption } from "../../common/download-source-option";
import {
  DownloadSourceOptionSkeleton,
  SourceAnchorSkeleton,
} from "../../skeletons";
import type { DiskUsage, Game, GameRepack, LibraryGame } from "@types";
import {
  useGameDownloadOptions,
  useFeature,
  useNavigationScreenActions,
  useBigPictureToast,
  useUserPreferences,
} from "../../../hooks";
import { useNavigationStore } from "../../../stores";
import {
  Button,
  Checkbox,
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
  CheckCircle,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  SortAscendingIcon,
  StarIcon,
} from "@phosphor-icons/react";

import "./styles.scss";

interface DownloadGameModalProps {
  visible: boolean;
  onClose: () => void;
  game: {
    objectId: string;
    shop: Game["shop"];
    title: string;
    libraryHeroImageUrl: string | null;
    iconUrl?: string | null;
    libraryImageUrl?: string | null;
    coverImageUrl?: string | null;
  };
}

interface DownloadGameSourceListProps {
  game: DownloadGameModalProps["game"];
  visible: boolean;
  onSelectOption: (option: GameRepack) => void;
}

interface DownloadGameOptionsProps {
  game: DownloadGameModalProps["game"];
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

function hasActiveLibraryDownload(
  library: Array<Pick<LibraryGame, "download">>
) {
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

type SourceCarouselEmblaApi = ReturnType<typeof useEmblaCarousel>[1];
type ResolvedSourceCarouselEmblaApi = NonNullable<SourceCarouselEmblaApi>;

const PARTIAL_VISIBLE_SLIDE_RATIO = 0.5;
const SLIDE_MEASUREMENT_EPSILON_PX = 1;
const DOWNLOAD_GAME_SOURCE_CAROUSEL_REGION_ID =
  "download-game-modal-source-carousel";
const DOWNLOAD_GAME_AUTOMATIC_EXTRACT_CHECKBOX_ID =
  "download-game-modal-automatic-extract";
const DOWNLOAD_GAME_DELETE_ARCHIVE_CHECKBOX_ID =
  "download-game-modal-delete-archive";

function getSourceFocusId(sourceId: string, sourceName: string, index: number) {
  const normalizedSource = sourceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `download-game-source-${sourceId}-${normalizedSource || "source"}-${index}`;
}

function getSourceViewportSlideMetrics(
  emblaApi: ResolvedSourceCarouselEmblaApi
) {
  const viewportRect = emblaApi.rootNode().getBoundingClientRect();
  const slideRects = emblaApi
    .slideNodes()
    .map((slideNode) => slideNode.getBoundingClientRect());

  if (slideRects.length === 0) return null;

  const visibleIndexes = slideRects.reduce<number[]>(
    (indexes, slideRect, index) => {
      const visibleWidth = Math.max(
        0,
        Math.min(slideRect.right, viewportRect.right) -
          Math.max(slideRect.left, viewportRect.left)
      );

      if (
        visibleWidth + SLIDE_MEASUREMENT_EPSILON_PX >=
        slideRect.width * PARTIAL_VISIBLE_SLIDE_RATIO
      ) {
        indexes.push(index);
      }

      return indexes;
    },
    []
  );

  if (visibleIndexes.length === 0) return null;

  return {
    firstVisibleIndex: visibleIndexes[0],
    visibleCount: visibleIndexes.length,
    visibleIndexes,
  };
}

function syncSourceThresholdFocusScroll(
  emblaApi: ResolvedSourceCarouselEmblaApi,
  previousFocusedIndex: number | null,
  nextFocusedIndex: number
) {
  const didNotChange =
    previousFocusedIndex == null || previousFocusedIndex === nextFocusedIndex;

  if (didNotChange) return;

  const viewportMetrics = getSourceViewportSlideMetrics(emblaApi);

  if (!viewportMetrics) return;

  const { visibleIndexes } = viewportMetrics;
  const visibleCount = visibleIndexes.length;
  const visiblePosition = visibleIndexes.indexOf(nextFocusedIndex);
  const isOutOfBounds = visiblePosition === -1;

  if (isOutOfBounds) return;

  const selectedPosition = Math.floor(visibleCount / 2) + 1;
  const isMovingRight = nextFocusedIndex > previousFocusedIndex;
  const shouldScroll = isMovingRight
    ? visiblePosition + 1 > selectedPosition && emblaApi.canScrollNext()
    : visiblePosition + 1 < selectedPosition && emblaApi.canScrollPrev();

  if (!shouldScroll) return;

  if (isMovingRight) emblaApi.scrollNext();
  else emblaApi.scrollPrev();
}

function useSourceThresholdFocusScroll(emblaApi: SourceCarouselEmblaApi) {
  const lastFocusedIndexRef = useRef<number | null>(null);

  return useCallback(
    (nextFocusedIndex: number) => {
      const previousFocusedIndex = lastFocusedIndexRef.current;
      lastFocusedIndexRef.current = nextFocusedIndex;

      if (!emblaApi) return;

      syncSourceThresholdFocusScroll(
        emblaApi,
        previousFocusedIndex,
        nextFocusedIndex
      );
    },
    [emblaApi]
  );
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
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const rememberedFocusId = useNavigationStore(
    (state) =>
      state.debugSnapshot.lastFocusedByRegionId[
        DOWNLOAD_GAME_SOURCE_CAROUSEL_REGION_ID
      ] ?? null
  );
  const [sourcesViewportRef, sourcesEmblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    duration: 12,
    dragFree: true,
  });
  const lastAlignedFocusIdRef = useRef<string | null>(null);

  const { downloadOptions, localDownloadSources, isLoading } =
    useGameDownloadOptions(game, visible);

  const localDownloadSourceNameById = useMemo(
    () =>
      new Map(
        localDownloadSources.map((downloadSource) => [
          downloadSource.id,
          downloadSource.name,
        ])
      ),
    [localDownloadSources]
  );
  const downloadSources = useMemo(() => {
    return localDownloadSources.map((downloadSource) => ({
      id: downloadSource.id,
      name: downloadSource.name,
    }));
  }, [localDownloadSources]);
  const sourceItems = useMemo(
    () =>
      downloadSources.map((source, index) => ({
        ...source,
        focusId: getSourceFocusId(source.id, source.name, index),
      })),
    [downloadSources]
  );

  const filteredDownloadOptions = useMemo(() => {
    const term = searchTerm.toLowerCase();

    return downloadOptions
      .filter((option) => option.title.toLowerCase().includes(term))
      .filter((option) => {
        if (selectedSources.length === 0) return true;

        return selectedSources.includes(option.downloadSourceId);
      });
  }, [downloadOptions, searchTerm, selectedSources]);

  const sortedDownloadOptions = useMemo(
    () => sortDownloadOptions(filteredDownloadOptions, selectedSortOption),
    [filteredDownloadOptions, selectedSortOption]
  );
  const handleSourceFocused = useSourceThresholdFocusScroll(sourcesEmblaApi);

  useEffect(() => {
    const getFocusedIndex = (focusId: string | null) => {
      if (!focusId) return -1;

      return sourceItems.findIndex(
        (sourceItem) => sourceItem.focusId === focusId
      );
    };

    const currentFocusedIndex = getFocusedIndex(currentFocusId);
    const targetFocusId = currentFocusedIndex === -1 ? rememberedFocusId : null;
    const focusedIndex = getFocusedIndex(targetFocusId);

    if (!sourcesEmblaApi || focusedIndex === -1 || !targetFocusId) return;
    if (lastAlignedFocusIdRef.current === targetFocusId) return;

    const animationFrameId = globalThis.requestAnimationFrame(() => {
      const viewportMetrics = getSourceViewportSlideMetrics(sourcesEmblaApi);

      if (!viewportMetrics) return;

      const selectedPosition = Math.floor(viewportMetrics.visibleCount / 2) + 1;
      const maxStartIndex = Math.max(
        0,
        sourceItems.length - viewportMetrics.visibleCount
      );
      const targetStartIndex = Math.max(
        0,
        Math.min(focusedIndex - (selectedPosition - 1), maxStartIndex)
      );

      lastAlignedFocusIdRef.current = targetFocusId;

      if (viewportMetrics.firstVisibleIndex !== targetStartIndex) {
        sourcesEmblaApi.scrollTo(targetStartIndex, true);
      }
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
    };
  }, [currentFocusId, rememberedFocusId, sourceItems, sourcesEmblaApi]);

  useEffect(() => {
    lastAlignedFocusIdRef.current = null;
  }, [sourceItems]);

  const handleSourceClick = (sourceId: string) => {
    setSelectedSources((previousSources) =>
      previousSources.includes(sourceId)
        ? previousSources.filter(
            (previousSource) => previousSource !== sourceId
          )
        : [...previousSources, sourceId]
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
        <div className="download-game-modal__source-list__sources-carousel">
          <div
            className="download-game-modal__source-list__sources-viewport"
            ref={sourcesViewportRef}
          >
            <HorizontalFocusGroup
              className="download-game-modal__source-list__sources"
              regionId={DOWNLOAD_GAME_SOURCE_CAROUSEL_REGION_ID}
            >
              {isLoading &&
                Array.from({ length: 3 }, (_, index) => (
                  <div
                    key={`source-anchor-skeleton-${index}`}
                    className="download-game-modal__source-list__source-slide"
                  >
                    <SourceAnchorSkeleton size="large" />
                  </div>
                ))}

              {!isLoading &&
                sourceItems.map(({ id, name, focusId }, index) => (
                  <div
                    key={focusId}
                    className="download-game-modal__source-list__source-slide"
                    onFocusCapture={() => handleSourceFocused(index)}
                  >
                    <SourceAnchor
                      focusId={focusId}
                      title={name}
                      size="large"
                      isSelected={selectedSources.includes(id)}
                      onClick={() => handleSourceClick(id)}
                    />
                  </div>
                ))}
            </HorizontalFocusGroup>
          </div>
        </div>

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
                  option={
                    localDownloadSourceNameById.has(option.downloadSourceId)
                      ? {
                          ...option,
                          downloadSourceName:
                            localDownloadSourceNameById.get(
                              option.downloadSourceId
                            ) ?? option.downloadSourceName,
                        }
                      : option
                  }
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
  const { showErrorToast } = useBigPictureToast();
  const downloadPathTouchedRef = useRef(false);
  const automaticExtractionTouchedRef = useRef(false);
  const deleteArchiveTouchedRef = useRef(false);
  const [selectedDownloadPath, setSelectedDownloadPath] = useState("");
  const [downloadDirectorySuggestions, setDownloadDirectorySuggestions] =
    useState<DownloadDirectorySuggestion[]>([]);
  const [automaticExtractionEnabled, setAutomaticExtractionEnabled] =
    useState(true);
  const [
    deleteArchiveFilesAfterExtraction,
    setDeleteArchiveFilesAfterExtraction,
  ] = useState(false);
  const [selectedDownloader, setSelectedDownloader] = useState<string>();
  const [hasActiveDownload, setHasActiveDownload] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { features } = useFeature();
  const userPreferences = useUserPreferences();

  const availableDownloaderOptions = useMemo(() => {
    return getDownloaderAvailabilityOptions(
      option,
      userPreferences,
      features
    ).filter((downloaderOption) => downloaderOption.isAvailable);
  }, [features, option, userPreferences]);

  const downloaderItems = useMemo(() => {
    return availableDownloaderOptions.map((downloaderOption) => ({
      value: String(downloaderOption.downloader),
      label: (
        <span className="download-game-modal__downloader-option-label">
          <span className="download-game-modal__downloader-option-slot download-game-modal__downloader-option-slot--left">
            {downloaderOption.downloader === Downloader.Hydra && (
              <StarIcon
                size={14}
                weight="fill"
                aria-hidden="true"
                className="download-game-modal__downloader-option-icon"
              />
            )}
          </span>
          <span className="download-game-modal__downloader-option-name">
            {DOWNLOADER_NAME[downloaderOption.downloader]}
          </span>
          <span className="download-game-modal__downloader-option-slot download-game-modal__downloader-option-slot--right">
            {selectedDownloader === String(downloaderOption.downloader) && (
              <CheckCircle
                size={16}
                weight="fill"
                aria-hidden="true"
                className="download-game-modal__downloader-option-checkmark"
              />
            )}
          </span>
        </span>
      ),
    })) satisfies Array<TabsItem<string>>;
  }, [availableDownloaderOptions, selectedDownloader]);

  const getDefaultDownloader = useCallback(
    (availableDownloaders: Downloader[]) => {
      if (availableDownloaders.length === 0) return null;

      if (availableDownloaders.includes(Downloader.RealDebrid)) {
        return Downloader.RealDebrid;
      }

      if (availableDownloaders.includes(Downloader.Premiumize)) {
        return Downloader.Premiumize;
      }

      if (availableDownloaders.includes(Downloader.AllDebrid)) {
        return Downloader.AllDebrid;
      }

      if (availableDownloaders.includes(Downloader.TorBox)) {
        return Downloader.TorBox;
      }

      return availableDownloaders[0];
    },
    []
  );

  useEffect(() => {
    const availableDownloaders = availableDownloaderOptions.map(
      (downloaderOption) => downloaderOption.downloader
    );
    const defaultDownloader = getDefaultDownloader(availableDownloaders);
    const availableDownloaderValues = new Set(
      availableDownloaders.map((downloader) => String(downloader))
    );

    setSelectedDownloader((currentSelectedDownloader) => {
      if (
        currentSelectedDownloader &&
        availableDownloaderValues.has(currentSelectedDownloader)
      ) {
        return currentSelectedDownloader;
      }

      return defaultDownloader != null ? String(defaultDownloader) : undefined;
    });
  }, [availableDownloaderOptions, getDefaultDownloader]);

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
      downloadPathTouchedRef.current = false;
      automaticExtractionTouchedRef.current = false;
      deleteArchiveTouchedRef.current = false;
      setSelectedDownloadPath("");
      setDownloadDirectorySuggestions([]);
      setSelectedDownloader(undefined);
      setAutomaticExtractionEnabled(true);
      setDeleteArchiveFilesAfterExtraction(false);
      setIsSubmitting(false);
      return;
    }

    let cancelled = false;

    const buildDownloadDirectorySuggestions = async () => {
      const defaultDownloadsPath =
        await globalThis.window.electron.getDefaultDownloadsPath();
      const resolvedDirectories = resolveDownloadDirectories(
        userPreferences,
        defaultDownloadsPath
      );

      const suggestions = await Promise.all(
        resolvedDirectories.allPaths.map(async (path) => {
          let diskUsage: DiskUsage = { free: 0, total: 0 };

          try {
            diskUsage = await globalThis.window.electron.getDiskFreeSpace(path);
          } catch {
            diskUsage = { free: 0, total: 0 };
          }

          return {
            title: getDownloadDirectoryTitle(path),
            path,
            freeBytes: diskUsage.free,
            totalBytes: diskUsage.total,
          };
        })
      );

      if (cancelled) return;

      if (!downloadPathTouchedRef.current) {
        setSelectedDownloadPath(resolvedDirectories.defaultPath);
      }

      setDownloadDirectorySuggestions(suggestions);

      if (!automaticExtractionTouchedRef.current) {
        setAutomaticExtractionEnabled(
          userPreferences?.extractFilesByDefault ?? true
        );
      }

      if (!deleteArchiveTouchedRef.current) {
        setDeleteArchiveFilesAfterExtraction(
          userPreferences?.deleteArchiveFilesAfterExtractionByDefault ?? false
        );
      }
    };

    void buildDownloadDirectorySuggestions();

    return () => {
      cancelled = true;
    };
  }, [userPreferences, visible]);

  const handleSelectDownloadPath = useCallback((path: string) => {
    downloadPathTouchedRef.current = true;
    setSelectedDownloadPath(path);
  }, []);

  const handleAutomaticExtractionChange = useCallback((checked: boolean) => {
    automaticExtractionTouchedRef.current = true;
    setAutomaticExtractionEnabled(checked);
  }, []);

  const handleDeleteArchiveFilesAfterExtractionChange = useCallback(
    (checked: boolean) => {
      deleteArchiveTouchedRef.current = true;
      setDeleteArchiveFilesAfterExtraction(checked);
    },
    []
  );

  const resolvedDownloader = useMemo(() => {
    if (!selectedDownloader) return null;

    return Number(selectedDownloader) as Downloader;
  }, [selectedDownloader]);

  const selectedDownloaderOption = useMemo(() => {
    if (resolvedDownloader == null) return null;

    return (
      availableDownloaderOptions.find(
        (downloaderOption) => downloaderOption.downloader === resolvedDownloader
      ) ?? null
    );
  }, [availableDownloaderOptions, resolvedDownloader]);

  const selectedUri = selectedDownloaderOption?.availableUri ?? null;
  const hasAvailableDownloader = availableDownloaderOptions.length > 0;

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
      automaticallyExtract: automaticExtractionEnabled,
      automaticallyDeleteArchiveFiles: deleteArchiveFilesAfterExtraction,
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

      showErrorToast("Download failed", {
        fallbackVisual: "downloads",
        color: "var(--error)",
        message:
          response.error ??
          "Hydra couldn't start this download. Try again in a moment.",
      });

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
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Hydra couldn't start this download. Try again in a moment.";
      showErrorToast("Download failed", {
        fallbackVisual: "downloads",
        color: "var(--error)",
        message,
      });

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
      <VerticalFocusGroup className="download-game-modal__options-stack">
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

          {hasAvailableDownloader ? (
            <Tabs
              items={downloaderItems}
              value={selectedDownloader}
              defaultValue={downloaderItems[0]?.value}
              onValueChange={setSelectedDownloader}
              variant="segmented"
              ariaLabel="Download methods"
              className="download-game-modal__downloader-tabs"
            />
          ) : (
            <p className="download-game-modal__downloader-empty">
              No download methods are available for your current setup.
            </p>
          )}
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
                showSelectedIndicator
                onClick={() => handleSelectDownloadPath(directory.path)}
                className="download-game-modal__directory-disk"
              />
            ))}
          </HorizontalFocusGroup>
        </div>

        <div className="download-game-modal__download-options">
          <Checkbox
            block
            focusId={DOWNLOAD_GAME_AUTOMATIC_EXTRACT_CHECKBOX_ID}
            label="Automatically extract downloaded files"
            checked={automaticExtractionEnabled}
            onChange={handleAutomaticExtractionChange}
          />

          <Checkbox
            block
            focusId={DOWNLOAD_GAME_DELETE_ARCHIVE_CHECKBOX_ID}
            label="Always delete archive files after extraction"
            checked={deleteArchiveFilesAfterExtraction}
            onChange={handleDeleteArchiveFilesAfterExtractionChange}
          />
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
