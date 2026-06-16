import { StarIcon } from "@phosphor-icons/react";
import {
  formatNumber,
  getClassicsLaunchErrorCode,
  getRegionsFromSkus,
  getSkuRegionFlag,
  type SkuRegion,
} from "@renderer/helpers";
import type { GameShop, ShopAssets } from "@types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  buildLibraryToastOptions,
  getItemFocusTarget,
  resolveImageSource,
} from "../../helpers";
import {
  Typography,
  VerticalFocusGroup,
  Divider,
  FocusItem,
} from "../../components";
import {
  ConfirmationModal,
  DiscSelectionModal,
  DownloadGameModal,
} from "../../components/modals";
import {
  AchievementsBox,
  ControllerSupportBox,
  GameReviews,
  Hero,
  HowLongToBeatBox,
  PlaytimeBar,
  ProtonDBSection,
  RequirementsToPlay,
  ScreenshotCarousel,
  SupportedLanguages,
} from "../../components/pages/game";
import {
  useBigPictureToast,
  useGameDetails,
  useHeaderTitle,
  useNavigationScreenActions,
} from "../../hooks";
import {
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
  BIG_PICTURE_SIDEBAR_REGION_ID,
} from "../../layout";
import {
  GAME_COMMENTS_ACTION_ROWS_REGION_ID,
  GAME_DESCRIPTION_BOTTOM_ENTRY_ID,
  GAME_DESCRIPTION_BODY_ID,
  GAME_DESCRIPTION_REGION_ID,
  GAME_HERO_ACTIONS_REGION_ID,
  GAME_MEDIA_CAROUSEL_REGION_ID,
  GAME_PAGE_REGION_ID,
  GAME_SIDEBAR_ACHIEVEMENTS_ID,
  GAME_SIDEBAR_CONTROLLER_SUPPORT_ID,
  GAME_SIDEBAR_HLTB_ID,
  GAME_SIDEBAR_LANGUAGES_ID,
  GAME_SIDEBAR_METADATA_ID,
  GAME_SIDEBAR_PROTONDB_ID,
  GAME_SIDEBAR_REGION_ID,
  GAME_SIDEBAR_REQUIREMENTS_ID,
  GAME_SIDEBAR_STATS_ID,
} from "../../components/pages/game/navigation";
import { NavigationService, type FocusOverrideTarget } from "../../services";
import { useNavigationStore } from "../../stores";
import "./game.scss";

const DESCRIPTION_HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
const DESCRIPTION_MEDIA_SELECTOR = "img, video";
const DESCRIPTION_MEDIA_SOURCE_SELECTOR = "img, video, source, track";
const DESCRIPTION_RENDERABLE_SELECTOR = [
  DESCRIPTION_HEADING_SELECTOR,
  DESCRIPTION_MEDIA_SELECTOR,
  "p",
  "ul",
  "ol",
  "blockquote",
  "table",
  "pre",
  "hr",
].join(", ");
const DESCRIPTION_DISALLOWED_SELECTORS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
].join(", ");
const DESCRIPTION_SCROLL_STEP = 180;
const DESCRIPTION_SCROLL_EDGE_TOLERANCE = 4;
const DESCRIPTION_FOCUS_ENTRY_MARGIN = 32;
const DESCRIPTION_SCROLL_ANIMATION_DURATION = 220;
const DESCRIPTION_RETURN_MIN_VISIBLE_RATIO = 0.5;

const REGION_LABELS: Record<SkuRegion, string> = {
  US: "United States",
  EU: "Europe",
  JP: "Japan",
  KR: "Korea",
  ASIA: "Asia",
};

function easeOutCubic(progress: number) {
  return 1 - Math.pow(1 - progress, 3);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDescriptionUrl(url: string) {
  return url.startsWith("http://") ? url.replace("http://", "https://") : url;
}

function isUnsafeDescriptionUrl(url: string) {
  return /^(javascript|data):/i.test(url.trim());
}

function preprocessSteamDescriptionDocument(html: string) {
  if (!html) {
    return null;
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");

  for (const element of document.querySelectorAll(
    DESCRIPTION_DISALLOWED_SELECTORS
  )) {
    element.remove();
  }

  for (const element of document.querySelectorAll("code, pre")) {
    const textNode = document.createTextNode(element.textContent || "");
    element.replaceWith(textNode);
  }

  for (const element of document.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (name.startsWith("on") || name === "style") {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === "href" || name === "src") {
        if (!value || isUnsafeDescriptionUrl(value)) {
          element.removeAttribute(attribute.name);
          continue;
        }

        element.setAttribute(attribute.name, normalizeDescriptionUrl(value));
      }
    }
  }

  const images = Array.from(document.querySelectorAll("img"));
  images.forEach((image) => {
    image.loading = "lazy";
    image.removeAttribute("width");
    image.removeAttribute("height");
    image.removeAttribute("style");
    image.style.maxWidth = "100%";
    image.style.width = "100%";
    image.style.height = "auto";
    image.style.boxSizing = "border-box";
  });

  const videos = Array.from(document.querySelectorAll("video"));
  videos.forEach((video) => {
    video.removeAttribute("width");
    video.removeAttribute("height");
    video.removeAttribute("style");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.style.maxWidth = "100%";
    video.style.width = "100%";
    video.style.height = "auto";
    video.style.boxSizing = "border-box";
  });

  return document;
}

function hasRenderableDescriptionContent(element: Element) {
  const hasText = Boolean(element.textContent?.trim());
  const hasRenderableDescendants =
    element.matches(DESCRIPTION_RENDERABLE_SELECTOR) ||
    Boolean(element.querySelector(DESCRIPTION_RENDERABLE_SELECTOR));

  return hasText || hasRenderableDescendants;
}

function isDescriptionHeadingElement(element: Element) {
  return element.matches(DESCRIPTION_HEADING_SELECTOR);
}

function isDescriptionMediaElement(element: Element) {
  if (element.matches(DESCRIPTION_MEDIA_SELECTOR)) {
    return true;
  }

  const hasMediaDescendant = Boolean(
    element.querySelector(DESCRIPTION_MEDIA_SELECTOR)
  );

  if (!hasMediaDescendant) {
    return false;
  }

  const mediaLessClone = element.cloneNode(true) as Element;
  mediaLessClone
    .querySelectorAll(DESCRIPTION_MEDIA_SOURCE_SELECTOR)
    .forEach((mediaElement) => mediaElement.remove());

  const hasNestedHeading = Boolean(
    element.querySelector(DESCRIPTION_HEADING_SELECTOR)
  );
  const hasNestedTextBlocks = Boolean(
    element.querySelector("p, ul, ol, blockquote, table, pre")
  );
  const hasMeaningfulText = Boolean(mediaLessClone.textContent?.trim());

  return !hasNestedHeading && !hasNestedTextBlocks && !hasMeaningfulText;
}

function isDescriptionStructuralElement(element: Element) {
  return element.matches("hr");
}

function buildDescriptionSections(document: Document | null) {
  if (!document) {
    return [];
  }

  const elements = Array.from(document.body.children).filter(
    hasRenderableDescriptionContent
  );
  const sections: string[] = [];
  let currentSectionHtml: string[] = [];

  const flushCurrentSection = () => {
    if (currentSectionHtml.length === 0) {
      return;
    }

    sections.push(currentSectionHtml.join(""));
    currentSectionHtml = [];
  };

  for (const element of elements) {
    if (isDescriptionStructuralElement(element)) {
      if (currentSectionHtml.length > 0) {
        currentSectionHtml.push(element.outerHTML);
      }

      continue;
    }

    if (isDescriptionMediaElement(element)) {
      flushCurrentSection();
      sections.push(element.outerHTML);
      continue;
    }

    if (isDescriptionHeadingElement(element)) {
      flushCurrentSection();
      currentSectionHtml.push(element.outerHTML);
      continue;
    }

    currentSectionHtml.push(element.outerHTML);
  }

  flushCurrentSection();

  return sections;
}

export default function Game() {
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const { shop, objectId } = useParams<{ shop: GameShop; objectId: string }>();
  const navigate = useNavigate();
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [isDiscSelectionModalOpen, setIsDiscSelectionModalOpen] =
    useState(false);
  const [pendingClassicsLaunch, setPendingClassicsLaunch] = useState<{
    discPath?: string;
  } | null>(null);
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false);
  const [hasNavigableComments, setHasNavigableComments] = useState(false);
  const [activeMediaItemId, setActiveMediaItemId] = useState<string | null>(
    null
  );
  const navigation = NavigationService.getInstance();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const descriptionContainerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusIdRef = useRef<string | null>(null);
  const lastMainContentFocusIdRef = useRef<string | null>(null);
  const descriptionScrollAnimationFrameRef = useRef<number | null>(null);
  const preserveDescriptionScrollOnNextBodyFocusRef = useRef(false);
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const navigationNodes = useNavigationStore((state) => state.nodes);
  const navigationRegions = useNavigationStore((state) => state.regions);
  const navigationNodesById = useMemo(
    () => new Map(navigationNodes.map((node) => [node.id, node])),
    [navigationNodes]
  );
  const navigationRegionsById = useMemo(
    () => new Map(navigationRegions.map((region) => [region.id, region])),
    [navigationRegions]
  );
  const isRegionWithinTree = useCallback(
    (regionId: string | null, targetRegionId: string) => {
      let currentRegionId = regionId;

      while (currentRegionId) {
        if (currentRegionId === targetRegionId) {
          return true;
        }

        currentRegionId =
          navigationRegionsById.get(currentRegionId)?.parentRegionId ?? null;
      }

      return false;
    },
    [navigationRegionsById]
  );
  const isMainContentFocusId = useCallback(
    (focusId: string | null) => {
      if (!focusId) {
        return false;
      }

      const regionId = navigationNodesById.get(focusId)?.regionId ?? null;

      if (!isRegionWithinTree(regionId, GAME_PAGE_REGION_ID)) {
        return false;
      }

      return (
        !isRegionWithinTree(regionId, GAME_SIDEBAR_REGION_ID) &&
        !isRegionWithinTree(regionId, BIG_PICTURE_SIDEBAR_REGION_ID)
      );
    },
    [isRegionWithinTree, navigationNodesById]
  );
  const {
    shopDetails,
    game,
    stats,
    isGameRunning,
    runningSessionDurationInMillis,
    isLoading,
    howLongToBeat,
    protonDBData,
    achievements,
    openGame,
    closeGame,
    toggleFavorite,
    updateGame,
  } = useGameDetails(objectId!, shop!);
  const canAddToLibrary = shop !== "custom";
  const resolvedGameTitle =
    shopDetails?.assets?.title ?? game?.title ?? "Download Game";
  const gameToastSource = useMemo<ShopAssets>(
    () => ({
      objectId: objectId ?? "",
      shop: shop ?? "steam",
      title: resolvedGameTitle,
      iconUrl: shopDetails?.assets?.iconUrl ?? game?.iconUrl ?? null,
      libraryHeroImageUrl:
        shopDetails?.assets?.libraryHeroImageUrl ??
        game?.libraryHeroImageUrl ??
        null,
      libraryImageUrl:
        shopDetails?.assets?.libraryImageUrl ?? game?.libraryImageUrl ?? null,
      logoImageUrl:
        shopDetails?.assets?.logoImageUrl ?? game?.logoImageUrl ?? null,
      logoPosition:
        shopDetails?.assets?.logoPosition ?? game?.logoPosition ?? null,
      coverImageUrl:
        shopDetails?.assets?.coverImageUrl ?? game?.coverImageUrl ?? null,
      downloadSources: shopDetails?.assets?.downloadSources ?? [],
    }),
    [game, objectId, resolvedGameTitle, shop, shopDetails?.assets]
  );
  const shouldShowProtonSection =
    Boolean(protonDBData) &&
    (import.meta.env.DEV || globalThis.window.electron?.platform === "linux");
  const descriptionBlocks = useMemo(() => {
    const document = preprocessSteamDescriptionDocument(
      shopDetails?.detailed_description ?? ""
    );

    return buildDescriptionSections(document);
  }, [shopDetails?.detailed_description]);
  const hasDescription = descriptionBlocks.length > 0;
  const hasMedia =
    (shopDetails?.movies?.length ?? 0) > 0 ||
    (shopDetails?.screenshots?.length ?? 0) > 0;
  const isLaunchboxGame = shop === "launchbox";
  const developer = shopDetails?.developers?.[0] ?? "";
  const publisher = shopDetails?.publishers?.[0] ?? "";
  const releaseDate = shopDetails?.release_date?.date ?? "";
  const launchboxGenres = useMemo(() => {
    return ((shopDetails?.genres ?? []) as unknown[])
      .map((genre) => {
        if (typeof genre === "string") return genre;
        if (genre && typeof genre === "object" && "name" in genre) {
          const { name } = genre as { name?: unknown };
          return typeof name === "string" ? name : "";
        }

        return "";
      })
      .filter((genre) => genre.trim().length > 0);
  }, [shopDetails?.genres]);
  const launchboxRegions = useMemo(
    () =>
      shopDetails?.skus && shopDetails.skus.length > 0
        ? getRegionsFromSkus(shopDetails.skus)
        : [],
    [shopDetails?.skus]
  );
  const descriptionEntryTarget = useMemo(
    () =>
      hasDescription ? getItemFocusTarget(GAME_DESCRIPTION_BODY_ID) : undefined,
    [hasDescription]
  );
  const descriptionBottomEntryTarget = useMemo(
    () =>
      hasDescription
        ? getItemFocusTarget(GAME_DESCRIPTION_BOTTOM_ENTRY_ID)
        : undefined,
    [hasDescription]
  );
  const commentsEntryTarget = useMemo(() => {
    if (!hasNavigableComments) {
      return undefined;
    }

    return {
      type: "region" as const,
      regionId: GAME_COMMENTS_ACTION_ROWS_REGION_ID,
      entryDirection: "down" as const,
      preferRememberedFocus: true,
    };
  }, [hasNavigableComments]);
  const bodyUpNavigationTarget = useMemo<FocusOverrideTarget>(() => {
    if (activeMediaItemId) {
      return getItemFocusTarget(activeMediaItemId);
    }

    if (hasMedia) {
      return {
        type: "region",
        regionId: GAME_MEDIA_CAROUSEL_REGION_ID,
        entryDirection: "up",
        preferRememberedFocus: true,
      };
    }

    return {
      type: "region",
      regionId: GAME_HERO_ACTIONS_REGION_ID,
      entryDirection: "up",
      preferRememberedFocus: true,
    };
  }, [activeMediaItemId, hasMedia]);
  const sidebarStatsEntryTarget = useMemo(
    () => getItemFocusTarget(GAME_SIDEBAR_STATS_ID),
    []
  );
  const bodyRightNavigationTarget = useMemo<FocusOverrideTarget>(
    () => sidebarStatsEntryTarget,
    [sidebarStatsEntryTarget]
  );
  const contentBelowHeroTarget = useMemo(() => {
    if (activeMediaItemId) {
      return getItemFocusTarget(activeMediaItemId);
    }

    if (hasMedia) {
      return {
        type: "region" as const,
        regionId: GAME_MEDIA_CAROUSEL_REGION_ID,
        entryDirection: "down" as const,
        preferRememberedFocus: true,
      };
    }

    return descriptionEntryTarget ?? commentsEntryTarget;
  }, [
    activeMediaItemId,
    commentsEntryTarget,
    descriptionEntryTarget,
    hasMedia,
  ]);
  const sidebarEntryTarget = useMemo(
    () => sidebarStatsEntryTarget,
    [sidebarStatsEntryTarget]
  );
  const heroActionsLeftNavigationTarget = useMemo(
    () => ({
      type: "region" as const,
      regionId: GAME_HERO_ACTIONS_REGION_ID,
      entryDirection: "left" as const,
      preferRememberedFocus: true,
    }),
    []
  );
  const commentsTopNavigationTarget = useMemo(() => {
    if (descriptionBottomEntryTarget) {
      return descriptionBottomEntryTarget;
    }

    if (hasMedia) {
      return contentBelowHeroTarget ?? heroActionsLeftNavigationTarget;
    }

    return heroActionsLeftNavigationTarget;
  }, [
    contentBelowHeroTarget,
    descriptionBottomEntryTarget,
    hasMedia,
    heroActionsLeftNavigationTarget,
  ]);
  useHeaderTitle(shopDetails?.assets?.title ?? game?.title);

  useHeaderTitle(shopDetails?.assets?.title ?? game?.title);

  const handleOpenDownloadModal = useCallback(() => {
    setIsDownloadModalOpen(true);
  }, []);

  const handleCloseDownloadModal = useCallback(() => {
    setIsDownloadModalOpen(false);
  }, []);

  const handleAddToLibrary = useCallback(async () => {
    if (
      !shop ||
      !objectId ||
      !canAddToLibrary ||
      game ||
      isAddingToLibrary ||
      !shopDetails
    ) {
      return;
    }

    setIsAddingToLibrary(true);

    try {
      await globalThis.window.electron.addGameToLibrary(
        shop,
        objectId,
        resolvedGameTitle,
        shopDetails.platform ?? null
      );
      await updateGame();
      globalThis.window.dispatchEvent(new Event("library-update"));

      const { title, ...toastOptions } = await buildLibraryToastOptions(
        gameToastSource,
        "added"
      );
      showSuccessToast(title, toastOptions);
    } finally {
      setIsAddingToLibrary(false);
    }
  }, [
    canAddToLibrary,
    game,
    gameToastSource,
    isAddingToLibrary,
    objectId,
    resolvedGameTitle,
    shop,
    showSuccessToast,
    shopDetails,
    updateGame,
  ]);

  const launchClassicsWithErrorHandling = useCallback(
    async (discPath?: string, force?: boolean) => {
      if (!game) return;

      try {
        await openGame(discPath, force);
        await updateGame();
        globalThis.window.dispatchEvent(new Event("library-update"));
      } catch (error) {
        const code = getClassicsLaunchErrorCode(error);

        if (code === "EMULATOR_NOT_CONFIGURED") {
          showErrorToast("Emulator not configured", {
            message:
              "Configure the emulator for this platform before launching.",
            fallbackVisual: "settings",
            action: {
              label: "Open Settings",
              onClick: () => navigate("/settings"),
            },
          });
          navigate("/settings");
          return;
        }

        if (code === "PLATFORM_UNKNOWN") {
          showErrorToast("Platform not supported", {
            message: "Hydra could not identify an emulator for this platform.",
          });
          return;
        }

        if (code === "NO_DISC") {
          showErrorToast("No disc found", {
            message:
              "Add or rescan discs for this Classics game before launching.",
          });
          return;
        }

        if (code === "EMULATOR_ALREADY_RUNNING") {
          setPendingClassicsLaunch({ discPath });
          return;
        }

        showErrorToast("Launch failed", {
          message: "Hydra could not launch this Classics game.",
        });
      }
    },
    [game, navigate, openGame, showErrorToast, updateGame]
  );

  const handlePlayGame = useCallback(async () => {
    if (!game) return;

    if (game.shop !== "launchbox") {
      await openGame();
      return;
    }

    const discs = game.discs ?? [];

    if (discs.length <= 1) {
      await launchClassicsWithErrorHandling();
      return;
    }

    if (game.dontAskDiscSelection && game.selectedDiscPath) {
      await launchClassicsWithErrorHandling(game.selectedDiscPath);
      return;
    }

    setIsDiscSelectionModalOpen(true);
  }, [game, launchClassicsWithErrorHandling, openGame]);

  const handleDiscSelectionConfirm = useCallback(
    async (discPath: string, dontAskAgain: boolean) => {
      if (!game) return;

      setIsDiscSelectionModalOpen(false);

      try {
        await globalThis.window.electron.updateClassicsDisc(
          game.shop,
          game.objectId,
          {
            selectedDiscPath: discPath,
            dontAskDiscSelection: dontAskAgain,
          }
        );
        await updateGame();
        globalThis.window.dispatchEvent(new Event("library-update"));
      } catch {
        // Updating the preference is non-fatal; the selected disc can still launch.
      }

      await launchClassicsWithErrorHandling(discPath);
    },
    [game, launchClassicsWithErrorHandling, updateGame]
  );

  const focusNavigationTarget = useCallback(
    (target?: FocusOverrideTarget) => {
      if (!target || target.type === "block") {
        return false;
      }

      if (target.type === "item") {
        return navigation.setFocus(target.itemId) !== null;
      }

      return (
        navigation.setFocusRegion(
          target.regionId,
          target.entryDirection ?? "right",
          {
            preferRememberedFocus: target.preferRememberedFocus,
          }
        ) !== null
      );
    },
    [navigation]
  );

  const getDescriptionScrollBounds = useCallback(() => {
    const descriptionContainer = descriptionContainerRef.current;
    const pageElement = pageRef.current;

    if (!descriptionContainer || !pageElement) {
      return null;
    }

    const pageRect = pageElement.getBoundingClientRect();
    const descriptionRect = descriptionContainer.getBoundingClientRect();
    const descriptionTop =
      pageElement.scrollTop + (descriptionRect.top - pageRect.top);
    const descriptionBottom = descriptionTop + descriptionRect.height;

    return {
      pageElement,
      descriptionTop,
      descriptionBottom,
      pageClientHeight: pageElement.clientHeight,
      maxScrollTop: Math.max(
        0,
        pageElement.scrollHeight - pageElement.clientHeight
      ),
      viewportTop: pageElement.scrollTop,
      viewportBottom: pageElement.scrollTop + pageElement.clientHeight,
    };
  }, []);

  const isDescriptionVisibleEnoughForReturn = useCallback(() => {
    const bounds = getDescriptionScrollBounds();

    if (!bounds) {
      return false;
    }

    const descriptionHeight = bounds.descriptionBottom - bounds.descriptionTop;

    if (descriptionHeight <= 0) {
      return false;
    }

    const visibleHeight = Math.max(
      0,
      Math.min(bounds.descriptionBottom, bounds.viewportBottom) -
        Math.max(bounds.descriptionTop, bounds.viewportTop)
    );

    return (
      visibleHeight / descriptionHeight >= DESCRIPTION_RETURN_MIN_VISIBLE_RATIO
    );
  }, [getDescriptionScrollBounds]);

  const sidebarMainContentReturnTarget = (() => {
    const lastMainContentFocusId = lastMainContentFocusIdRef.current;

    if (
      lastMainContentFocusId &&
      isMainContentFocusId(lastMainContentFocusId) &&
      lastMainContentFocusId !== GAME_DESCRIPTION_BODY_ID
    ) {
      return getItemFocusTarget(lastMainContentFocusId);
    }

    if (
      lastMainContentFocusId === GAME_DESCRIPTION_BODY_ID &&
      isMainContentFocusId(lastMainContentFocusId) &&
      isDescriptionVisibleEnoughForReturn()
    ) {
      return getItemFocusTarget(lastMainContentFocusId);
    }

    if (activeMediaItemId) {
      return getItemFocusTarget(activeMediaItemId);
    }

    if (hasMedia) {
      return {
        type: "region" as const,
        regionId: GAME_MEDIA_CAROUSEL_REGION_ID,
        entryDirection: "left" as const,
        preferRememberedFocus: true,
      };
    }

    return heroActionsLeftNavigationTarget;
  })();

  const sidebarCarouselLeftNavigationTarget = useMemo(
    () => sidebarMainContentReturnTarget,
    [sidebarMainContentReturnTarget]
  );

  const sidebarCarouselNavigationOverrides = useMemo(
    () => ({
      left: sidebarCarouselLeftNavigationTarget,
      right: { type: "block" as const },
    }),
    [sidebarCarouselLeftNavigationTarget]
  );

  const sidebarStatsNavigationOverrides = useMemo(
    () => ({
      ...sidebarCarouselNavigationOverrides,
      up: { type: "block" as const },
    }),
    [sidebarCarouselNavigationOverrides]
  );

  const sidebarLanguagesNavigationOverrides = useMemo(
    () => ({
      ...sidebarCarouselNavigationOverrides,
      down: { type: "block" as const },
    }),
    [sidebarCarouselNavigationOverrides]
  );

  const scrollPageBy = useCallback((delta: number) => {
    const pageElement = pageRef.current;

    if (!pageElement) {
      return false;
    }

    const nextScrollTop = Math.max(
      0,
      Math.min(
        pageElement.scrollTop + delta,
        pageElement.scrollHeight - pageElement.clientHeight
      )
    );

    if (nextScrollTop === pageElement.scrollTop) {
      return false;
    }

    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      pageElement.scrollTop = nextScrollTop;
      return true;
    }

    if (descriptionScrollAnimationFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(
        descriptionScrollAnimationFrameRef.current
      );
      descriptionScrollAnimationFrameRef.current = null;
    }

    const startScrollTop = pageElement.scrollTop;
    const distance = nextScrollTop - startScrollTop;
    const startTime = globalThis.performance.now();

    const animate = (now: number) => {
      const progress = clamp(
        (now - startTime) / DESCRIPTION_SCROLL_ANIMATION_DURATION,
        0,
        1
      );
      const easedProgress = easeOutCubic(progress);

      pageElement.scrollTop = startScrollTop + distance * easedProgress;

      if (progress < 1) {
        descriptionScrollAnimationFrameRef.current =
          globalThis.requestAnimationFrame(animate);
        return;
      }

      pageElement.scrollTop = nextScrollTop;
      descriptionScrollAnimationFrameRef.current = null;
    };

    descriptionScrollAnimationFrameRef.current =
      globalThis.requestAnimationFrame(animate);
    return true;
  }, []);

  useNavigationScreenActions(
    currentFocusId === GAME_DESCRIPTION_BODY_ID
      ? {
          direction: {
            up: () => {
              const bounds = getDescriptionScrollBounds();

              if (
                bounds &&
                bounds.viewportTop >
                  bounds.descriptionTop + DESCRIPTION_SCROLL_EDGE_TOLERANCE
              ) {
                scrollPageBy(-DESCRIPTION_SCROLL_STEP);
                return;
              }

              focusNavigationTarget(bodyUpNavigationTarget);
            },
            down: () => {
              const bounds = getDescriptionScrollBounds();

              if (
                bounds &&
                bounds.viewportBottom <
                  bounds.descriptionBottom - DESCRIPTION_SCROLL_EDGE_TOLERANCE
              ) {
                scrollPageBy(DESCRIPTION_SCROLL_STEP);
                return;
              }

              focusNavigationTarget(commentsEntryTarget);
            },
            left: () => {
              navigation.setFocus(BIG_PICTURE_SIDEBAR_ITEM_IDS.home);
            },
            right: () => {
              focusNavigationTarget(bodyRightNavigationTarget);
            },
          },
        }
      : {}
  );

  useEffect(() => {
    if (currentFocusId !== GAME_DESCRIPTION_BOTTOM_ENTRY_ID) {
      return;
    }

    const bounds = getDescriptionScrollBounds();

    if (!bounds) {
      return;
    }

    const nextScrollTop = Math.min(
      Math.max(
        0,
        bounds.descriptionBottom -
          bounds.pageClientHeight +
          DESCRIPTION_FOCUS_ENTRY_MARGIN
      ),
      bounds.maxScrollTop
    );

    preserveDescriptionScrollOnNextBodyFocusRef.current = true;
    bounds.pageElement.scrollTop = nextScrollTop;

    const frameId = globalThis.requestAnimationFrame(() => {
      navigation.setFocus(GAME_DESCRIPTION_BODY_ID);
    });

    return () => {
      globalThis.cancelAnimationFrame(frameId);
    };
  }, [currentFocusId, getDescriptionScrollBounds, navigation]);

  useEffect(() => {
    if (currentFocusId !== GAME_DESCRIPTION_BODY_ID) {
      if (currentFocusId) {
        previousFocusIdRef.current = currentFocusId;
      }
      return;
    }

    const bounds = getDescriptionScrollBounds();

    if (!bounds) {
      previousFocusIdRef.current = currentFocusId;
      return;
    }

    if (preserveDescriptionScrollOnNextBodyFocusRef.current) {
      preserveDescriptionScrollOnNextBodyFocusRef.current = false;
      previousFocusIdRef.current = currentFocusId;
      return;
    }

    const previousFocusId = previousFocusIdRef.current;
    const previousRegionId = previousFocusId
      ? (navigationNodesById.get(previousFocusId)?.regionId ?? null)
      : null;
    const enteredFromComments = isRegionWithinTree(
      previousRegionId,
      GAME_COMMENTS_ACTION_ROWS_REGION_ID
    );
    const enteredFromSidebar = isRegionWithinTree(
      previousRegionId,
      GAME_SIDEBAR_REGION_ID
    );
    const enteredFromGlobalSidebar = isRegionWithinTree(
      previousRegionId,
      BIG_PICTURE_SIDEBAR_REGION_ID
    );
    if (enteredFromSidebar || enteredFromGlobalSidebar) {
      previousFocusIdRef.current = currentFocusId;
      return;
    }

    const targetScrollTop = enteredFromComments
      ? bounds.descriptionBottom -
        bounds.pageClientHeight +
        DESCRIPTION_FOCUS_ENTRY_MARGIN
      : bounds.descriptionTop - DESCRIPTION_FOCUS_ENTRY_MARGIN;
    const nextScrollTop = Math.min(
      Math.max(0, targetScrollTop),
      bounds.maxScrollTop
    );

    const frameId = globalThis.requestAnimationFrame(() => {
      scrollPageBy(nextScrollTop - bounds.pageElement.scrollTop);
    });

    previousFocusIdRef.current = currentFocusId;

    return () => {
      globalThis.cancelAnimationFrame(frameId);
    };
  }, [
    currentFocusId,
    getDescriptionScrollBounds,
    isRegionWithinTree,
    navigationNodesById,
    scrollPageBy,
  ]);

  useEffect(() => {
    if (currentFocusId === GAME_DESCRIPTION_BODY_ID) {
      return;
    }

    if (descriptionScrollAnimationFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(
        descriptionScrollAnimationFrameRef.current
      );
      descriptionScrollAnimationFrameRef.current = null;
    }

    if (currentFocusId) {
      previousFocusIdRef.current = currentFocusId;
    }
  }, [currentFocusId]);

  useEffect(() => {
    if (!isMainContentFocusId(currentFocusId)) {
      return;
    }

    lastMainContentFocusIdRef.current = currentFocusId;
  }, [currentFocusId, isMainContentFocusId]);

  useEffect(
    () => () => {
      if (descriptionScrollAnimationFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(
          descriptionScrollAnimationFrameRef.current
        );
      }
    },
    []
  );

  useEffect(() => {
    const descriptionContainer = descriptionContainerRef.current;
    const pageElement = pageRef.current;

    if (!descriptionContainer || !pageElement) {
      return;
    }

    const videos = Array.from(descriptionContainer.querySelectorAll("video"));

    if (videos.length === 0) {
      return;
    }

    videos.forEach((video) => {
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!(entry.target instanceof HTMLVideoElement)) {
            return;
          }

          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            entry.target.play().catch(() => {});
          } else {
            entry.target.pause();
          }
        });
      },
      {
        root: pageElement,
        threshold: [0, 0.5, 0.75],
      }
    );

    videos.forEach((video) => observer.observe(video));

    return () => {
      observer.disconnect();
      videos.forEach((video) => video.pause());
    };
  }, [descriptionBlocks]);

  if (isLoading || !shopDetails) {
    return (
      <VerticalFocusGroup regionId={GAME_PAGE_REGION_ID} asChild>
        <div className="game-page">
          <p style={{ color: "white" }}>Loading...</p>
        </div>
      </VerticalFocusGroup>
    );
  }

  return (
    <VerticalFocusGroup regionId={GAME_PAGE_REGION_ID} asChild>
      <div ref={pageRef} className="game-page">
        <Hero
          shopDetails={shopDetails}
          game={game}
          isGameRunning={isGameRunning}
          isFavorite={game?.favorite ?? false}
          toggleFavorite={toggleFavorite}
          onPlay={handlePlayGame}
          onDownload={handleOpenDownloadModal}
          onAddToLibrary={handleAddToLibrary}
          onOpenDownloadOptions={handleOpenDownloadModal}
          onClose={closeGame}
          isAddingToLibrary={isAddingToLibrary}
          canAddToLibrary={canAddToLibrary}
          downNavigationTarget={contentBelowHeroTarget}
          sidebarEntryTarget={sidebarEntryTarget}
        />

        <section className="game-page__content">
          <PlaytimeBar
            game={game}
            isGameRunning={isGameRunning}
            runningSessionDurationInMillis={runningSessionDurationInMillis}
          />

          <div className="game-page__main-layout">
            <div className="game-page__main-column">
              <ScreenshotCarousel
                videos={shopDetails.movies ?? []}
                screenshots={shopDetails.screenshots ?? []}
                onActiveItemChange={setActiveMediaItemId}
                nextContentEntryTarget={
                  descriptionEntryTarget ?? commentsEntryTarget
                }
                sidebarEntryTarget={sidebarStatsEntryTarget}
              />

              {hasDescription && (
                <VerticalFocusGroup
                  regionId={GAME_DESCRIPTION_REGION_ID}
                  className="game-page__detailed-description-region"
                >
                  <FocusItem
                    id={GAME_DESCRIPTION_BODY_ID}
                    navigationOverrides={{
                      left: getItemFocusTarget(
                        BIG_PICTURE_SIDEBAR_ITEM_IDS.home
                      ),
                      right: bodyRightNavigationTarget,
                      up: { type: "block" },
                      down: { type: "block" },
                    }}
                    asChild
                  >
                    <div
                      ref={descriptionContainerRef}
                      className="game-page__detailed-description"
                      data-suppress-navigation-autoscroll="true"
                    >
                      {descriptionBlocks.map((block, index) => (
                        <div
                          key={`description-block-${index}`}
                          className="game-page__detailed-description-block"
                        >
                          <div
                            className="game-page__detailed-description-block-content"
                            dangerouslySetInnerHTML={{
                              __html: block,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </FocusItem>

                  <FocusItem
                    id={GAME_DESCRIPTION_BOTTOM_ENTRY_ID}
                    navigationOverrides={{
                      left: getItemFocusTarget(
                        BIG_PICTURE_SIDEBAR_ITEM_IDS.home
                      ),
                      right: bodyRightNavigationTarget,
                      up: { type: "block" },
                      down: { type: "block" },
                    }}
                    asChild
                  >
                    <div
                      className="game-page__detailed-description-bottom-entry"
                      data-suppress-navigation-autoscroll="true"
                      aria-hidden="true"
                    />
                  </FocusItem>
                </VerticalFocusGroup>
              )}

              <Divider />

              <GameReviews
                shop={shop!}
                objectId={objectId!}
                topNavigationTarget={commentsTopNavigationTarget}
                onHasNavigableActionsChange={setHasNavigableComments}
              />
            </div>

            <VerticalFocusGroup regionId={GAME_SIDEBAR_REGION_ID} asChild>
              <div className="game-page__sidebar">
                <FocusItem
                  id={GAME_SIDEBAR_STATS_ID}
                  navigationOrder={0}
                  navigationOverrides={sidebarStatsNavigationOverrides}
                  asChild
                >
                  <section
                    className="game-page__sidebar-section game-page__stats"
                    aria-label="Game stats"
                  >
                    <div className="game-page__stats-title">
                      <Typography>Game Stats</Typography>
                    </div>

                    <div className="game-page__stats-row">
                      <Typography className="game-page__stats-label">
                        Rating
                      </Typography>
                      <div className="game-page__stats-rating-value">
                        <StarIcon
                          size={16}
                          weight="fill"
                          aria-hidden="true"
                          className="game-page__stats-rating-icon"
                        />
                        <Typography className="game-page__stats-value">
                          {formatNumber(stats?.averageScore ?? 0)}
                        </Typography>
                      </div>
                    </div>

                    <div className="game-page__stats-row">
                      <Typography className="game-page__stats-label">
                        Downloads
                      </Typography>
                      <Typography className="game-page__stats-value">
                        {formatNumber(stats?.downloadCount ?? 0)}
                      </Typography>
                    </div>

                    <div className="game-page__stats-row">
                      <Typography className="game-page__stats-label">
                        Playing now
                      </Typography>
                      <Typography className="game-page__stats-value">
                        {formatNumber(stats?.playerCount ?? 0)}
                      </Typography>
                    </div>
                  </section>
                </FocusItem>

                {!isLaunchboxGame && (
                  <HowLongToBeatBox
                    howLongToBeat={howLongToBeat ?? []}
                    focusId={GAME_SIDEBAR_HLTB_ID}
                    focusNavigationOrder={1}
                    focusNavigationOverrides={
                      sidebarCarouselNavigationOverrides
                    }
                  />
                )}

                {shouldShowProtonSection && (
                  <ProtonDBSection
                    protonDBData={protonDBData}
                    focusId={GAME_SIDEBAR_PROTONDB_ID}
                    focusNavigationOrder={2}
                    focusNavigationOverrides={
                      sidebarCarouselNavigationOverrides
                    }
                  />
                )}

                <ControllerSupportBox
                  shop={shop}
                  shopDetails={shopDetails}
                  focusId={GAME_SIDEBAR_CONTROLLER_SUPPORT_ID}
                  focusNavigationOrder={3}
                  focusNavigationOverrides={sidebarCarouselNavigationOverrides}
                />

                {!isLaunchboxGame && (
                  <AchievementsBox
                    achievements={achievements ?? []}
                    focusId={GAME_SIDEBAR_ACHIEVEMENTS_ID}
                    focusNavigationOrder={4}
                    focusNavigationOverrides={
                      sidebarCarouselNavigationOverrides
                    }
                  />
                )}

                <FocusItem
                  id={GAME_SIDEBAR_METADATA_ID}
                  navigationOrder={5}
                  navigationOverrides={sidebarCarouselNavigationOverrides}
                  asChild
                >
                  <section
                    className="game-page__sidebar-section game-page__metadata"
                    aria-label="Game info"
                  >
                    {isLaunchboxGame && shopDetails.platform ? (
                      <div className="game-page__metadata-row">
                        <Typography className="game-page__metadata-label">
                          Platform
                        </Typography>
                        <Typography className="game-page__metadata-value">
                          {shopDetails.platform}
                        </Typography>
                      </div>
                    ) : null}

                    {isLaunchboxGame && launchboxGenres.length > 0 ? (
                      <div className="game-page__metadata-row">
                        <Typography className="game-page__metadata-label">
                          Genres
                        </Typography>
                        <Typography className="game-page__metadata-value">
                          {launchboxGenres.join(", ")}
                        </Typography>
                      </div>
                    ) : null}

                    {isLaunchboxGame && launchboxRegions.length > 0 ? (
                      <div className="game-page__metadata-row">
                        <Typography className="game-page__metadata-label">
                          Regions
                        </Typography>
                        <div className="game-page__metadata-flags">
                          {launchboxRegions.map((region) => (
                            <img
                              key={region}
                              src={getSkuRegionFlag(region)}
                              alt={REGION_LABELS[region]}
                              title={REGION_LABELS[region]}
                              className="game-page__metadata-flag"
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {developer && (
                      <div className="game-page__metadata-row">
                        <Typography className="game-page__metadata-label">
                          Developed by
                        </Typography>
                        <Typography className="game-page__metadata-value">
                          {developer}
                        </Typography>
                      </div>
                    )}

                    {publisher && (
                      <div className="game-page__metadata-row">
                        <Typography className="game-page__metadata-label">
                          Published by
                        </Typography>
                        <Typography className="game-page__metadata-value">
                          {publisher}
                        </Typography>
                      </div>
                    )}

                    {releaseDate && (
                      <div className="game-page__metadata-row">
                        <Typography className="game-page__metadata-label">
                          Release Date
                        </Typography>
                        <Typography className="game-page__metadata-value">
                          {releaseDate}
                        </Typography>
                      </div>
                    )}
                  </section>
                </FocusItem>

                {!isLaunchboxGame ? (
                  <RequirementsToPlay
                    shopDetails={shopDetails}
                    focusId={GAME_SIDEBAR_REQUIREMENTS_ID}
                    focusNavigationOrder={6}
                    focusNavigationOverrides={
                      sidebarCarouselNavigationOverrides
                    }
                  />
                ) : null}

                <SupportedLanguages
                  shopDetails={shopDetails}
                  focusId={GAME_SIDEBAR_LANGUAGES_ID}
                  focusNavigationOrder={7}
                  focusNavigationOverrides={sidebarLanguagesNavigationOverrides}
                />
              </div>
            </VerticalFocusGroup>
          </div>
        </section>

        <DownloadGameModal
          visible={isDownloadModalOpen}
          onClose={handleCloseDownloadModal}
          game={{
            objectId: objectId!,
            shop: shop!,
            title: shopDetails.assets?.title ?? game?.title ?? "Download Game",
            iconUrl: shopDetails.assets?.iconUrl ?? game?.iconUrl ?? null,
            libraryHeroImageUrl:
              shopDetails.assets?.libraryHeroImageUrl ??
              game?.libraryHeroImageUrl ??
              null,
            libraryImageUrl:
              shopDetails.assets?.libraryImageUrl ??
              game?.libraryImageUrl ??
              null,
            coverImageUrl:
              shopDetails.assets?.coverImageUrl ?? game?.coverImageUrl ?? null,
          }}
        />

        {game?.shop === "launchbox" ? (
          <DiscSelectionModal
            visible={isDiscSelectionModalOpen}
            coverImage={
              resolveImageSource(game?.customHeroImageUrl) ||
              resolveImageSource(shopDetails.assets?.libraryHeroImageUrl) ||
              resolveImageSource(game?.libraryHeroImageUrl) ||
              resolveImageSource(shopDetails.assets?.libraryImageUrl) ||
              resolveImageSource(game?.libraryImageUrl) ||
              resolveImageSource(game?.customIconUrl) ||
              resolveImageSource(game?.iconUrl) ||
              undefined
            }
            discs={game.discs ?? []}
            defaultDiscPath={game.selectedDiscPath ?? null}
            defaultDontAsk={Boolean(game.dontAskDiscSelection)}
            onClose={() => setIsDiscSelectionModalOpen(false)}
            onConfirm={handleDiscSelectionConfirm}
          />
        ) : null}

        <ConfirmationModal
          visible={pendingClassicsLaunch !== null}
          title="RPCS3 is already running"
          description="Close the current RPCS3 session before launching this game, or force Hydra to start it again."
          confirmLabel="Launch Anyway"
          onClose={() => setPendingClassicsLaunch(null)}
          onConfirm={async () => {
            const pending = pendingClassicsLaunch;
            setPendingClassicsLaunch(null);

            if (pending) {
              await launchClassicsWithErrorHandling(pending.discPath, true);
            }
          }}
        />
      </div>
    </VerticalFocusGroup>
  );
}
