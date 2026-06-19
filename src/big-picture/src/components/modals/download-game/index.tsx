import { AnimatePresence, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
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
import { MeasurementContext } from "../../context/measurement.context";
import type {
  DiskUsage,
  DownloadSource,
  Game,
  GameRepack,
  LibraryGame,
} from "@types";
import {
  type DownloadOptionsEmptyStateReason,
  useGameDownloadOptions,
  useFeature,
  useNavigationScreenActions,
  useBigPictureToast,
  useUserPreferences,
} from "../../../hooks";
import { useNavigationStore, useVirtualKeyboardStore } from "../../../stores";

import {
  Button,
  Checkbox,
  DropdownSelect,
  EmptyState,
  GridFocusGroup,
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
    downloadSources?: string[];
  };
}

interface DownloadGameSourceListProps {
  onClose: () => void;
  onSelectOption: (option: GameRepack) => void;
  downloadOptions: GameRepack[];
  localDownloadSources: DownloadSource[];
  isCheckingSources: boolean;
  isLoading: boolean;
  emptyStateReason: DownloadOptionsEmptyStateReason | null;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  selectedSources: string[];
  onToggleSource: (sourceId: string) => void;
  selectedSortOption: DownloadOptionsSortBy;
  onSelectedSortOptionChange: (value: DownloadOptionsSortBy) => void;
}

interface DownloadGameOptionsProps {
  game: DownloadGameModalProps["game"];
  option: GameRepack;
  visible: boolean;
  onClose: () => void;
  downloadDirectorySuggestions: DownloadDirectorySuggestion[];
  selectedDownloadPath: string;
  automaticExtractionEnabled: boolean;
  deleteArchiveFilesAfterExtraction: boolean;
  onSelectDownloadPath: (path: string) => void;
  onAutomaticExtractionChange: (checked: boolean) => void;
  onDeleteArchiveFilesAfterExtractionChange: (checked: boolean) => void;
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

type StepTransitionPhase = "idle" | "exiting" | "entering";

type SourceCarouselEmblaApi = ReturnType<typeof useEmblaCarousel>[1];
type ResolvedSourceCarouselEmblaApi = NonNullable<SourceCarouselEmblaApi>;

const PARTIAL_VISIBLE_SOURCE_RATIO = 0.5;
const SLIDE_MEASUREMENT_EPSILON_PX = 1;
const DOWNLOAD_GAME_STEP_FADE_DURATION_SECONDS = 0.1;
const DOWNLOAD_GAME_STEP_HEIGHT_DURATION_SECONDS = 0.15;
const DOWNLOAD_GAME_SOURCE_CAROUSEL_REGION_ID =
  "download-game-modal-source-carousel";
const DOWNLOAD_GAME_AUTOMATIC_EXTRACT_CHECKBOX_ID =
  "download-game-modal-automatic-extract";
const DOWNLOAD_GAME_DELETE_ARCHIVE_CHECKBOX_ID =
  "download-game-modal-delete-archive";
const DOWNLOAD_GAME_EMPTY_STATE_SETTINGS_BUTTON_ID =
  "download-game-modal-empty-state-settings";

function getSourceFocusId(sourceId: string, sourceName: string, index: number) {
  const normalizedSource = sourceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `download-game-source-${sourceId}-${normalizedSource || "source"}-${index}`;
}

function getSearchQueryPreview(query: string, maxCharacters = 16) {
  if (query.length <= maxCharacters) return query;

  return `${query.slice(0, maxCharacters).trimEnd()}...`;
}

function getSourceTrackPadding(viewportWidth: number, slideWidth: number) {
  if (viewportWidth <= 0 || slideWidth <= 0) return 0;

  return Math.max(0, viewportWidth / 2 - slideWidth / 2);
}

function getSourceSlideStep(slideRects: DOMRect[]) {
  if (slideRects.length <= 1) return slideRects[0]?.width ?? 0;

  const step = slideRects[1].left - slideRects[0].left;

  if (step <= SLIDE_MEASUREMENT_EPSILON_PX) {
    return slideRects[0]?.width ?? 0;
  }

  return step;
}

function getSourceViewportSlideMetrics(
  emblaApi: ResolvedSourceCarouselEmblaApi,
  viewportElement: HTMLElement
) {
  const slideNodes = emblaApi.slideNodes();
  const viewportRect = viewportElement.getBoundingClientRect();
  const slideRects = slideNodes.map((slideNode) =>
    slideNode.getBoundingClientRect()
  );

  if (slideRects.length === 0) return null;

  const slideWidth = slideRects[0]?.width ?? 0;
  const slideStep = getSourceSlideStep(slideRects);

  if (slideWidth <= 0 || slideStep <= 0) return null;

  const visibleIndexes = slideRects.reduce<number[]>(
    (indexes, slideRect, index) => {
      const visibleWidth = Math.max(
        0,
        Math.min(slideRect.right, viewportRect.right) -
          Math.max(slideRect.left, viewportRect.left)
      );

      if (
        visibleWidth + SLIDE_MEASUREMENT_EPSILON_PX >=
        slideRect.width * PARTIAL_VISIBLE_SOURCE_RATIO
      ) {
        indexes.push(index);
      }

      return indexes;
    },
    []
  );

  if (visibleIndexes.length === 0) return null;

  const firstVisibleIndex = visibleIndexes[0];
  const visibleCount = Math.max(
    1,
    Math.min(visibleIndexes.length, slideRects.length - firstVisibleIndex)
  );

  return {
    firstVisibleIndex,
    visibleCount,
    visibleIndexes,
    viewportRect,
    slideRects,
  };
}

function getSourceTargetStartIndex(
  focusedIndex: number,
  visibleCount: number,
  slideCount: number
) {
  const selectedPosition = Math.floor(visibleCount / 2) + 1;
  const maxStartIndex = Math.max(0, slideCount - visibleCount);

  return Math.max(
    0,
    Math.min(focusedIndex - (selectedPosition - 1), maxStartIndex)
  );
}

function nudgeClippedFocusedSource(
  emblaApi: ResolvedSourceCarouselEmblaApi,
  viewportElement: HTMLElement,
  focusedIndex: number
) {
  const focusedSlideNode = emblaApi.slideNodes()[focusedIndex];

  if (!focusedSlideNode) return;

  const viewportRect = viewportElement.getBoundingClientRect();
  const focusedSlideRect = focusedSlideNode.getBoundingClientRect();
  const rightOverflow =
    focusedSlideRect.right - viewportRect.right + SLIDE_MEASUREMENT_EPSILON_PX;
  const leftOverflow =
    viewportRect.left - focusedSlideRect.left + SLIDE_MEASUREMENT_EPSILON_PX;
  let deltaX = 0;

  if (rightOverflow > SLIDE_MEASUREMENT_EPSILON_PX) {
    deltaX = -rightOverflow;
  } else if (leftOverflow > SLIDE_MEASUREMENT_EPSILON_PX) {
    deltaX = leftOverflow;
  }

  if (Math.abs(deltaX) <= SLIDE_MEASUREMENT_EPSILON_PX) return;

  const internalEngine = emblaApi.internalEngine();
  const signedDistance = internalEngine.axis.direction(deltaX);

  internalEngine.scrollTo.distance(signedDistance, false);
}

function scrollToRestoreFocus(
  emblaApi: ResolvedSourceCarouselEmblaApi,
  viewportElement: HTMLElement,
  nextFocusedIndex: number,
  firstVisibleIndex: number,
  rightTriggerPosition: number,
  targetStartIndex: number
) {
  if (nextFocusedIndex <= rightTriggerPosition) {
    if (firstVisibleIndex !== 0) {
      emblaApi.scrollTo(0, true);
    }
  } else if (firstVisibleIndex !== targetStartIndex) {
    emblaApi.scrollTo(targetStartIndex, true);
  }

  globalThis.requestAnimationFrame(() => {
    nudgeClippedFocusedSource(emblaApi, viewportElement, nextFocusedIndex);
  });
}

function handleNudgeIfClipped(
  emblaApi: ResolvedSourceCarouselEmblaApi,
  viewportElement: HTMLElement,
  nextFocusedIndex: number,
  isClippedOnLeft: boolean,
  isClippedOnRight: boolean
) {
  if (isClippedOnLeft || isClippedOnRight) {
    nudgeClippedFocusedSource(emblaApi, viewportElement, nextFocusedIndex);
  }
}

function scrollToOutOfBounds(
  emblaApi: ResolvedSourceCarouselEmblaApi,
  viewportElement: HTMLElement,
  nextFocusedIndex: number,
  firstVisibleIndex: number,
  targetStartIndex: number
) {
  if (firstVisibleIndex !== targetStartIndex) {
    emblaApi.scrollTo(targetStartIndex, true);
    globalThis.requestAnimationFrame(() => {
      nudgeClippedFocusedSource(emblaApi, viewportElement, nextFocusedIndex);
    });
    return;
  }

  nudgeClippedFocusedSource(emblaApi, viewportElement, nextFocusedIndex);
}

function scrollInDirection(
  emblaApi: ResolvedSourceCarouselEmblaApi,
  viewportElement: HTMLElement,
  nextFocusedIndex: number,
  previousFocusedIndex: number
) {
  const isMovingRight = nextFocusedIndex > previousFocusedIndex;
  const didScroll = isMovingRight
    ? emblaApi.canScrollNext()
    : emblaApi.canScrollPrev();

  if (!didScroll) return;

  if (isMovingRight) {
    emblaApi.scrollNext();
  } else {
    emblaApi.scrollPrev();
  }

  globalThis.requestAnimationFrame(() => {
    nudgeClippedFocusedSource(emblaApi, viewportElement, nextFocusedIndex);
  });
}

function syncSourceThresholdFocusScroll(
  emblaApi: ResolvedSourceCarouselEmblaApi,
  viewportElement: HTMLElement,
  previousFocusedIndex: number | null,
  nextFocusedIndex: number,
  restoreFocus = false
) {
  const viewportMetrics = getSourceViewportSlideMetrics(
    emblaApi,
    viewportElement
  );

  if (!viewportMetrics) return;

  const {
    firstVisibleIndex,
    visibleCount,
    visibleIndexes,
    viewportRect,
    slideRects,
  } = viewportMetrics;
  const slideCount = slideRects.length;
  const rightTriggerPosition = Math.max(1, Math.ceil(visibleCount / 2));
  const leftTriggerPosition = Math.min(
    visibleCount,
    Math.floor(visibleCount / 2) + 1
  );
  const visiblePositionOneBased = nextFocusedIndex - firstVisibleIndex + 1;
  const isOutOfBounds =
    visiblePositionOneBased < 1 || visiblePositionOneBased > visibleCount;
  const focusedSlideRect = slideRects[nextFocusedIndex];
  const isClippedOnLeft =
    focusedSlideRect &&
    focusedSlideRect.left + SLIDE_MEASUREMENT_EPSILON_PX < viewportRect.left;
  const isClippedOnRight =
    focusedSlideRect &&
    focusedSlideRect.right - SLIDE_MEASUREMENT_EPSILON_PX > viewportRect.right;
  const targetStartIndex = getSourceTargetStartIndex(
    nextFocusedIndex,
    visibleCount,
    slideCount
  );
  const isWithinInitialWindow =
    firstVisibleIndex === 0 && nextFocusedIndex <= rightTriggerPosition;

  if (restoreFocus) {
    scrollToRestoreFocus(
      emblaApi,
      viewportElement,
      nextFocusedIndex,
      firstVisibleIndex,
      rightTriggerPosition,
      targetStartIndex
    );
    return;
  }

  const didNotChange =
    previousFocusedIndex == null || previousFocusedIndex === nextFocusedIndex;

  if (didNotChange) return;

  if (isWithinInitialWindow) {
    handleNudgeIfClipped(
      emblaApi,
      viewportElement,
      nextFocusedIndex,
      isClippedOnLeft,
      isClippedOnRight
    );
    return;
  }

  if (isOutOfBounds) {
    scrollToOutOfBounds(
      emblaApi,
      viewportElement,
      nextFocusedIndex,
      firstVisibleIndex,
      targetStartIndex
    );
    return;
  }

  const isMovingRight = nextFocusedIndex > previousFocusedIndex;
  const shouldScroll = isMovingRight
    ? visiblePositionOneBased > rightTriggerPosition
    : visiblePositionOneBased < leftTriggerPosition;

  if (shouldScroll) {
    scrollInDirection(
      emblaApi,
      viewportElement,
      nextFocusedIndex,
      previousFocusedIndex
    );
    return;
  }

  const visiblePosition = visibleIndexes.indexOf(nextFocusedIndex);

  if (visiblePosition !== -1 && (isClippedOnLeft || isClippedOnRight)) {
    nudgeClippedFocusedSource(emblaApi, viewportElement, nextFocusedIndex);
  }
}

export function DownloadGameModal({
  visible,
  onClose,
  game,
}: Readonly<DownloadGameModalProps>) {
  const sessionVersionRef = useRef(0);
  const previousVisibleRef = useRef(visible);
  const previousGameKeyRef = useRef(`${game.shop}:${game.objectId}`);
  const gameSessionKey = `${game.shop}:${game.objectId}`;
  const opened = !previousVisibleRef.current && visible;
  const gameChanged = previousGameKeyRef.current !== gameSessionKey;

  if (visible && (opened || gameChanged)) {
    sessionVersionRef.current += 1;
  }

  previousVisibleRef.current = visible;
  previousGameKeyRef.current = gameSessionKey;

  return (
    <DownloadGameModalSession
      key={`${gameSessionKey}:${sessionVersionRef.current}`}
      visible={visible}
      onClose={onClose}
      game={game}
    />
  );
}

function DownloadGameModalSession({
  visible,
  onClose,
  game,
}: Readonly<DownloadGameModalProps>) {
  const userPreferences = useUserPreferences();
  const virtualKeyboardTarget = useVirtualKeyboardStore(
    (state) => state.target
  );
  const isVirtualKeyboardOpen = virtualKeyboardTarget !== null;
  const [selectedOption, setSelectedOption] = useState<GameRepack | null>(null);
  const [pendingSelectedOption, setPendingSelectedOption] =
    useState<GameRepack | null>(null);
  const [activeStep, setActiveStep] = useState<DownloadGameStep>(
    DownloadGameStep.SourceList
  );
  const [pendingStep, setPendingStep] = useState<DownloadGameStep | null>(null);
  const [pendingStepHeight, setPendingStepHeight] = useState<number | null>(
    null
  );
  const [transitionPhase, setTransitionPhase] =
    useState<StepTransitionPhase>("idle");
  const [stepFrameHeight, setStepFrameHeight] = useState<number | "auto">(
    "auto"
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedSortOption, setSelectedSortOption] =
    useState<DownloadOptionsSortBy>("newest");
  const [downloadDirectorySuggestions, setDownloadDirectorySuggestions] =
    useState<DownloadDirectorySuggestion[]>([]);
  const [selectedDownloadPath, setSelectedDownloadPath] = useState("");
  const [automaticExtractionEnabled, setAutomaticExtractionEnabled] =
    useState(true);
  const [
    deleteArchiveFilesAfterExtraction,
    setDeleteArchiveFilesAfterExtraction,
  ] = useState(false);
  const [isPreparingOptions, setIsPreparingOptions] = useState(false);
  const stepFrameRef = useRef<HTMLDivElement | null>(null);
  const activeStepRef = useRef<HTMLDivElement | null>(null);
  const pendingStepMeasureRef = useRef<HTMLDivElement | null>(null);
  const resetStepFrameHeightTimeoutRef = useRef<number | null>(null);
  const downloadPathTouchedRef = useRef(false);
  const automaticExtractionTouchedRef = useRef(false);
  const deleteArchiveTouchedRef = useRef(false);
  const {
    downloadOptions,
    localDownloadSources,
    isCheckingSources,
    isLoading,
    emptyStateReason,
  } = useGameDownloadOptions(game, visible);

  const isntFirstStep = useMemo(() => {
    return activeStep !== DownloadGameStep.SourceList;
  }, [activeStep]);

  const requestStepChange = useCallback(
    (nextStep: DownloadGameStep) => {
      if (nextStep === activeStep || transitionPhase !== "idle") return;

      if (resetStepFrameHeightTimeoutRef.current !== null) {
        globalThis.window.clearTimeout(resetStepFrameHeightTimeoutRef.current);
        resetStepFrameHeightTimeoutRef.current = null;
      }

      const currentHeight =
        stepFrameRef.current?.getBoundingClientRect().height ??
        activeStepRef.current?.getBoundingClientRect().height ??
        0;

      setStepFrameHeight(currentHeight > 0 ? currentHeight : "auto");
      setPendingStepHeight(null);
      setPendingStep(nextStep);
      setTransitionPhase("exiting");
    },
    [activeStep, transitionPhase]
  );

  const handleNextStep = (option: GameRepack) => {
    if (isPreparingOptions) {
      setPendingSelectedOption(option);
      return;
    }

    setPendingSelectedOption(null);
    setSelectedOption(option);
    requestStepChange(DownloadGameStep.Options);
  };

  const handleOnBack = () => {
    if (isntFirstStep) requestStepChange(DownloadGameStep.SourceList);
  };

  useNavigationScreenActions(
    isntFirstStep && !isVirtualKeyboardOpen
      ? { press: { b: handleOnBack } }
      : {}
  );

  useEffect(() => {
    if (!visible || !IS_DESKTOP) {
      downloadPathTouchedRef.current = false;
      automaticExtractionTouchedRef.current = false;
      deleteArchiveTouchedRef.current = false;
      setDownloadDirectorySuggestions([]);
      setSelectedDownloadPath("");
      setAutomaticExtractionEnabled(true);
      setDeleteArchiveFilesAfterExtraction(false);
      setPendingSelectedOption(null);
      setIsPreparingOptions(false);
      if (resetStepFrameHeightTimeoutRef.current !== null) {
        globalThis.window.clearTimeout(resetStepFrameHeightTimeoutRef.current);
        resetStepFrameHeightTimeoutRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const buildDownloadDirectorySuggestions = async () => {
      setIsPreparingOptions(true);

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

      setIsPreparingOptions(false);
    };

    void buildDownloadDirectorySuggestions();

    return () => {
      cancelled = true;
    };
  }, [userPreferences, visible]);

  useEffect(() => {
    return () => {
      if (resetStepFrameHeightTimeoutRef.current !== null) {
        globalThis.window.clearTimeout(resetStepFrameHeightTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!visible || isPreparingOptions || !pendingSelectedOption) return;

    setSelectedOption(pendingSelectedOption);
    requestStepChange(DownloadGameStep.Options);
    setPendingSelectedOption(null);
  }, [isPreparingOptions, pendingSelectedOption, requestStepChange, visible]);

  useLayoutEffect(() => {
    if (pendingStep === null) return;

    const frame = requestAnimationFrame(() => {
      const nextHeight =
        pendingStepMeasureRef.current?.getBoundingClientRect().height ?? 0;

      if (nextHeight > 0) {
        setPendingStepHeight(nextHeight);
      }
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [pendingStep]);

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

  const handleToggleSource = useCallback((sourceId: string) => {
    setSelectedSources((previousSources) =>
      previousSources.includes(sourceId)
        ? previousSources.filter(
            (previousSource) => previousSource !== sourceId
          )
        : [...previousSources, sourceId]
    );
  }, []);

  const stepTransitionKey =
    activeStep === DownloadGameStep.SourceList ? "source-list" : "options";
  const activeStepContentKey =
    activeStep === DownloadGameStep.SourceList
      ? "source-list"
      : `options-${selectedOption?.id ?? "none"}`;
  const isOptionsScrollEnabled =
    activeStep === DownloadGameStep.Options && transitionPhase === "idle";
  const pendingStepTransitionKey =
    pendingStep === DownloadGameStep.SourceList ? "source-list" : "options";
  const renderSourceListStep = useCallback(
    () => (
      <DownloadGameSourceList
        onClose={onClose}
        onSelectOption={handleNextStep}
        downloadOptions={downloadOptions}
        localDownloadSources={localDownloadSources}
        isCheckingSources={isCheckingSources}
        isLoading={isLoading}
        emptyStateReason={emptyStateReason}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        selectedSources={selectedSources}
        onToggleSource={handleToggleSource}
        selectedSortOption={selectedSortOption}
        onSelectedSortOptionChange={setSelectedSortOption}
      />
    ),
    [
      downloadOptions,
      emptyStateReason,
      handleNextStep,
      handleToggleSource,
      isCheckingSources,
      isLoading,
      localDownloadSources,
      onClose,
      searchTerm,
      selectedSortOption,
      selectedSources,
    ]
  );
  const renderOptionsStep = useCallback(
    (option: GameRepack) => (
      <DownloadGameOptions
        key={option.id}
        game={game}
        option={option}
        visible={visible}
        onClose={onClose}
        downloadDirectorySuggestions={downloadDirectorySuggestions}
        selectedDownloadPath={selectedDownloadPath}
        automaticExtractionEnabled={automaticExtractionEnabled}
        deleteArchiveFilesAfterExtraction={deleteArchiveFilesAfterExtraction}
        onSelectDownloadPath={handleSelectDownloadPath}
        onAutomaticExtractionChange={handleAutomaticExtractionChange}
        onDeleteArchiveFilesAfterExtractionChange={
          handleDeleteArchiveFilesAfterExtractionChange
        }
      />
    ),
    [
      automaticExtractionEnabled,
      deleteArchiveFilesAfterExtraction,
      downloadDirectorySuggestions,
      game,
      handleAutomaticExtractionChange,
      handleDeleteArchiveFilesAfterExtractionChange,
      handleSelectDownloadPath,
      onClose,
      selectedDownloadPath,
      visible,
    ]
  );
  const renderStepContent = useCallback(
    (targetStep: DownloadGameStep, optionOverride?: GameRepack | null) => {
      if (targetStep === DownloadGameStep.SourceList) {
        return renderSourceListStep();
      }

      const option = optionOverride ?? selectedOption;

      return option ? renderOptionsStep(option) : null;
    },
    [renderOptionsStep, renderSourceListStep, selectedOption]
  );

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={game.title}
      description="Pick a repack from your download sources"
      coverImage={game.libraryHeroImageUrl ?? undefined}
      className="download-game-modal"
      closeOnB={!isntFirstStep}
      onBack={isntFirstStep ? handleOnBack : undefined}
      animateLayout
      layoutTransition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="download-game-modal__content">
        <motion.div
          ref={stepFrameRef}
          className="download-game-modal__step-frame"
          initial={false}
          animate={{ height: stepFrameHeight }}
          transition={{
            height: {
              duration: DOWNLOAD_GAME_STEP_HEIGHT_DURATION_SECONDS,
              ease: [0.22, 1, 0.36, 1],
            },
          }}
        >
          <motion.div
            key={activeStepContentKey}
            ref={activeStepRef}
            className={`download-game-modal__step download-game-modal__step--${stepTransitionKey}`}
            data-scroll-enabled={isOptionsScrollEnabled || undefined}
            initial={transitionPhase === "entering" ? { opacity: 0 } : false}
            animate={{
              opacity: transitionPhase === "exiting" ? 0 : 1,
            }}
            transition={{
              opacity: {
                duration: DOWNLOAD_GAME_STEP_FADE_DURATION_SECONDS,
                ease: [0.22, 1, 0.36, 1],
              },
            }}
            onAnimationComplete={() => {
              if (transitionPhase === "exiting" && pendingStep !== null) {
                const measuredPendingHeight =
                  pendingStepHeight ??
                  pendingStepMeasureRef.current?.getBoundingClientRect()
                    .height ??
                  0;

                setActiveStep(pendingStep);
                setPendingStep(null);
                setPendingStepHeight(null);
                if (measuredPendingHeight > 0) {
                  setStepFrameHeight(measuredPendingHeight);
                }
                setTransitionPhase("entering");
                return;
              }

              if (transitionPhase === "entering") {
                resetStepFrameHeightTimeoutRef.current =
                  globalThis.window.setTimeout(() => {
                    setTransitionPhase("idle");
                    setStepFrameHeight("auto");
                    resetStepFrameHeightTimeoutRef.current = null;
                  }, DOWNLOAD_GAME_STEP_HEIGHT_DURATION_SECONDS * 1000);
              }
            }}
          >
            {renderStepContent(activeStep)}
          </motion.div>

          {pendingStep != null && (
            <MeasurementContext.Provider value={true}>
              <div
                ref={pendingStepMeasureRef}
                className={`download-game-modal__step-measure download-game-modal__step download-game-modal__step--${pendingStepTransitionKey}`}
                aria-hidden="true"
              >
                {renderStepContent(pendingStep)}
              </div>
            </MeasurementContext.Provider>
          )}
        </motion.div>
      </div>
    </Modal>
  );
}

function DownloadGameSourceList({
  onClose,
  onSelectOption,
  downloadOptions,
  localDownloadSources,
  isCheckingSources,
  isLoading,
  emptyStateReason,
  searchTerm,
  onSearchTermChange,
  selectedSources,
  onToggleSource,
  selectedSortOption,
  onSelectedSortOptionChange,
}: Readonly<DownloadGameSourceListProps>) {
  const { t } = useTranslation("big_picture");
  const navigate = useNavigate();
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const [sourcesViewportRef, sourcesEmblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    duration: 10,
  });
  const sourcesViewportElementRef = useRef<HTMLDivElement | null>(null);
  const lastAlignedFocusIdRef = useRef<string | null>(null);
  const previousFocusedSourceIndexRef = useRef<number | null>(null);
  const [sourceTrackPaddingEndPx, setSourceTrackPaddingEndPx] = useState(0);

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
  const firstSourceFocusId = sourceItems[0]?.focusId;

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
  const isSourceListLoading = isCheckingSources || isLoading;
  const hasStructuralEmptyState =
    !isSourceListLoading && emptyStateReason !== null;
  const trimmedSearchTerm = searchTerm.trim();
  const searchQueryPreview = getSearchQueryPreview(trimmedSearchTerm);
  const hasSearchEmptyState =
    !isSourceListLoading &&
    !hasStructuralEmptyState &&
    sortedDownloadOptions.length === 0 &&
    trimmedSearchTerm.length > 0;
  const sourceTrackStyle = useMemo(
    () =>
      ({
        "--download-game-modal-source-track-padding-end": `${sourceTrackPaddingEndPx}px`,
      }) as CSSProperties,
    [sourceTrackPaddingEndPx]
  );
  const setCombinedSourcesViewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      sourcesViewportElementRef.current = node;
      sourcesViewportRef(node);
    },
    [sourcesViewportRef]
  );
  const measureSourceTrackPaddingEnd = useCallback(() => {
    if (
      !sourcesEmblaApi ||
      !sourcesViewportElementRef.current ||
      isSourceListLoading
    ) {
      setSourceTrackPaddingEndPx(0);
      return;
    }

    const slideNodes = sourcesEmblaApi.slideNodes();
    const lastSlideNode = slideNodes[slideNodes.length - 1];

    if (!lastSlideNode) {
      setSourceTrackPaddingEndPx(0);
      return;
    }

    const viewportWidth =
      sourcesViewportElementRef.current.getBoundingClientRect().width;
    const lastSlideWidth = lastSlideNode.getBoundingClientRect().width;
    const endPadding = getSourceTrackPadding(viewportWidth, lastSlideWidth);

    setSourceTrackPaddingEndPx((currentEnd) =>
      Math.abs(currentEnd - endPadding) <= SLIDE_MEASUREMENT_EPSILON_PX
        ? currentEnd
        : endPadding
    );
  }, [isSourceListLoading, sourcesEmblaApi]);
  const alignFocusedSource = useCallback(
    (focusedIndex: number, focusId: string, restoreFocus = false) => {
      if (
        !sourcesEmblaApi ||
        !sourcesViewportElementRef.current ||
        isSourceListLoading
      ) {
        return;
      }

      syncSourceThresholdFocusScroll(
        sourcesEmblaApi,
        sourcesViewportElementRef.current,
        restoreFocus ? null : previousFocusedSourceIndexRef.current,
        focusedIndex,
        restoreFocus
      );

      previousFocusedSourceIndexRef.current = focusedIndex;
      lastAlignedFocusIdRef.current = focusId;
    },
    [isSourceListLoading, sourcesEmblaApi]
  );
  const handleSourceFocused = useCallback(
    (focusedIndex: number) => {
      const focusedSource = sourceItems[focusedIndex];

      if (!focusedSource) return;

      alignFocusedSource(focusedIndex, focusedSource.focusId);
    },
    [alignFocusedSource, sourceItems]
  );

  useEffect(() => {
    const viewportElement = sourcesViewportElementRef.current;

    if (!viewportElement) return;

    const resizeObserver = new ResizeObserver(() => {
      measureSourceTrackPaddingEnd();
    });

    resizeObserver.observe(viewportElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [measureSourceTrackPaddingEnd]);

  useEffect(() => {
    const animationFrameId = globalThis.requestAnimationFrame(() => {
      measureSourceTrackPaddingEnd();
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
    };
  }, [measureSourceTrackPaddingEnd, sourceItems]);

  useEffect(() => {
    if (!sourcesEmblaApi || isSourceListLoading) return;

    const animationFrameId = globalThis.requestAnimationFrame(() => {
      sourcesEmblaApi.reInit();
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
    };
  }, [isSourceListLoading, sourceTrackPaddingEndPx, sourcesEmblaApi]);

  useEffect(() => {
    if (!currentFocusId || isSourceListLoading) return;

    const focusedIndex = sourceItems.findIndex(
      (sourceItem) => sourceItem.focusId === currentFocusId
    );

    if (focusedIndex === -1) return;
    if (lastAlignedFocusIdRef.current === currentFocusId) return;

    const animationFrameId = globalThis.requestAnimationFrame(() => {
      alignFocusedSource(focusedIndex, currentFocusId, true);
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
    };
  }, [
    alignFocusedSource,
    currentFocusId,
    isSourceListLoading,
    sourceItems,
    sourcesEmblaApi,
  ]);

  useEffect(() => {
    lastAlignedFocusIdRef.current = null;
    previousFocusedSourceIndexRef.current = null;
  }, [sourceItems]);

  let optionsTransitionKey: string;

  if (isSourceListLoading) {
    optionsTransitionKey = "loading";
  } else if (hasStructuralEmptyState) {
    optionsTransitionKey = `empty-${emptyStateReason}`;
  } else if (hasSearchEmptyState) {
    optionsTransitionKey = "search-empty";
  } else {
    optionsTransitionKey = `sorted-${selectedSortOption}-${selectedSources.toSorted((a, b) => a.localeCompare(b)).join("|") || "all"}`;
  }

  const handleOpenSettings = useCallback(() => {
    onClose();
    navigate(
      `${IS_DESKTOP ? "/big-picture" : ""}/settings?tab=downloads&section=sources`
    );
  }, [navigate, onClose]);

  const handleClearSearch = useCallback(() => {
    onSearchTermChange("");
  }, [onSearchTermChange]);

  return (
    <VerticalFocusGroup className="download-game-modal__source-list">
      {!hasStructuralEmptyState && (
        <>
          <Input
            placeholder="Search options"
            value={searchTerm}
            onChange={(e) => onSearchTermChange(e.target.value)}
            iconLeft={<MagnifyingGlassIcon size={24} />}
          />

          <HorizontalFocusGroup className="download-game-modal__source-list__toolbar">
            <div className="download-game-modal__source-list__sources-carousel">
              <div
                className="download-game-modal__source-list__sources-viewport"
                ref={setCombinedSourcesViewportRef}
              >
                <HorizontalFocusGroup
                  className="download-game-modal__source-list__sources"
                  regionId={DOWNLOAD_GAME_SOURCE_CAROUSEL_REGION_ID}
                  style={sourceTrackStyle}
                >
                  {isSourceListLoading &&
                    Array.from({ length: 5 }, (_, index) => (
                      <div
                        key={`source-anchor-skeleton-${index}`}
                        className="download-game-modal__source-list__source-slide"
                      >
                        <SourceAnchorSkeleton size="large" />
                      </div>
                    ))}

                  {!isSourceListLoading &&
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
                          onClick={() => onToggleSource(id)}
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
                onValueChange={onSelectedSortOptionChange}
                leadingIcon={<SortAscendingIcon size={22} />}
                ariaLabel="Sort options"
                className="download-game-modal__source-list__sort-options-select"
              />
            </HorizontalFocusGroup>
          </HorizontalFocusGroup>
        </>
      )}

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
            {isSourceListLoading &&
              Array.from({ length: 5 }, (_, index) => (
                <DownloadSourceOptionSkeleton
                  key={`download-source-option-skeleton-${index}`}
                />
              ))}

            {hasStructuralEmptyState && (
              <EmptyState
                className="download-game-modal__source-list-empty-state"
                icon={<MagnifyingGlassIcon size={32} weight="bold" />}
                title={t("No download options")}
                description={t(
                  "Open Settings to review your download sources and look for more options."
                )}
                actions={
                  <Button
                    focusId={DOWNLOAD_GAME_EMPTY_STATE_SETTINGS_BUTTON_ID}
                    stealFocusOnAppear
                    onClick={handleOpenSettings}
                  >
                    {t("Open Settings")}
                  </Button>
                }
              />
            )}

            {hasSearchEmptyState && (
              <EmptyState
                className="download-game-modal__source-list-empty-state"
                icon={<MagnifyingGlassIcon size={32} weight="bold" />}
                title={t('No results for "{{query}}"', {
                  query: searchQueryPreview,
                })}
                description={t(
                  "Try another search or clear it to browse all available download options."
                )}
                actions={
                  <Button onClick={handleClearSearch}>
                    {t("Clear search")}
                  </Button>
                }
              />
            )}

            {!isSourceListLoading &&
              !hasStructuralEmptyState &&
              !hasSearchEmptyState &&
              sortedDownloadOptions.map((option, index) => (
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
                  stealFocusOnAppear={index === 0}
                  focusNavigationOverrides={
                    index === 0 && firstSourceFocusId
                      ? {
                          up: {
                            type: "item",
                            itemId: firstSourceFocusId,
                          },
                        }
                      : undefined
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
  downloadDirectorySuggestions,
  selectedDownloadPath,
  automaticExtractionEnabled,
  deleteArchiveFilesAfterExtraction,
  onSelectDownloadPath,
  onAutomaticExtractionChange,
  onDeleteArchiveFilesAfterExtractionChange,
}: Readonly<DownloadGameOptionsProps>) {
  const { showErrorToast } = useBigPictureToast();
  const [selectedDownloader, setSelectedDownloader] = useState<string>();
  const [hasDownloaderTabsInteracted, setHasDownloaderTabsInteracted] =
    useState(false);
  const [hasActiveDownload, setHasActiveDownload] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { features } = useFeature();
  const userPreferences = useUserPreferences();
  const isOptionsInteractionLocked = isSubmitting;

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
      disabled: isOptionsInteractionLocked,
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
            <span className="download-game-modal__downloader-option-checkmark-wrap">
              <AnimatePresence initial={false}>
                {selectedDownloader === String(downloaderOption.downloader) && (
                  <motion.span
                    key="selected-checkmark"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{
                      type: "spring",
                      stiffness: 420,
                      damping: 34,
                      mass: 0.8,
                    }}
                    className="download-game-modal__downloader-option-checkmark-wrap"
                  >
                    <CheckCircle
                      size={16}
                      weight="fill"
                      aria-hidden="true"
                      className="download-game-modal__downloader-option-checkmark"
                    />
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </span>
        </span>
      ),
    })) satisfies Array<TabsItem<string>>;
  }, [
    availableDownloaderOptions,
    isOptionsInteractionLocked,
    selectedDownloader,
  ]);

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
      setSelectedDownloader(undefined);
      setHasDownloaderTabsInteracted(false);
      setIsSubmitting(false);
    }
  }, [visible]);

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

  const handleDownloaderTabsValueChange = useCallback(
    (nextValue: string) => {
      if (isOptionsInteractionLocked) return;

      setHasDownloaderTabsInteracted(true);
      setSelectedDownloader(nextValue);
    },
    [isOptionsInteractionLocked]
  );

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
              onValueChange={handleDownloaderTabsValueChange}
              itemsFocusable={false}
              animateSegmentedIndicator={hasDownloaderTabsInteracted}
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

          <GridFocusGroup
            className="download-game-modal__directory-disks"
            style={{
              display: "grid",
              width: "100%",
              alignItems: "stretch",
              gap: "calc(var(--spacing-unit) * 2)",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            }}
          >
            {downloadDirectorySuggestions.map((directory, index) => {
              const shouldSpanFullWidth =
                downloadDirectorySuggestions.length % 2 === 1 &&
                index === downloadDirectorySuggestions.length - 1;

              return (
                <UserDiskItem
                  key={directory.path}
                  title={directory.title}
                  path={directory.path}
                  freeBytes={directory.freeBytes}
                  totalBytes={directory.totalBytes}
                  isSelected={selectedDownloadPath === directory.path}
                  showSelectedIndicator
                  stealFocusOnAppear={index === 0}
                  onClick={
                    isOptionsInteractionLocked
                      ? undefined
                      : () => onSelectDownloadPath(directory.path)
                  }
                  focusNavigationState={
                    isOptionsInteractionLocked ? "disabled" : undefined
                  }
                  className={
                    shouldSpanFullWidth
                      ? "download-game-modal__directory-disk download-game-modal__directory-disk--full-width"
                      : "download-game-modal__directory-disk"
                  }
                />
              );
            })}
          </GridFocusGroup>
        </div>

        <div className="download-game-modal__download-options">
          <Checkbox
            block
            focusId={DOWNLOAD_GAME_AUTOMATIC_EXTRACT_CHECKBOX_ID}
            label="Automatically extract downloaded files"
            checked={automaticExtractionEnabled}
            disabled={isOptionsInteractionLocked}
            onChange={onAutomaticExtractionChange}
          />

          <Checkbox
            block
            focusId={DOWNLOAD_GAME_DELETE_ARCHIVE_CHECKBOX_ID}
            label="Always delete archive files after extraction"
            checked={deleteArchiveFilesAfterExtraction}
            disabled={isOptionsInteractionLocked}
            onChange={onDeleteArchiveFilesAfterExtractionChange}
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
