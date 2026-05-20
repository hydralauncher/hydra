import { formatNumber } from "@renderer/helpers";
import type { GameShop } from "@types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getItemFocusTarget } from "../../helpers";
import { Typography, VerticalFocusGroup, Divider, FocusItem } from "../../components";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../layout";
import { DownloadGameModal } from "../../components/modals";
import {
  AchievementsBox,
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
  GAME_COMMENTS_ACTION_ROWS_REGION_ID,
  GAME_DESCRIPTION_REGION_ID,
  GAME_HERO_ACTIONS_REGION_ID,
  GAME_MEDIA_CAROUSEL_REGION_ID,
  GAME_PAGE_REGION_ID,
  GAME_SIDEBAR_ACHIEVEMENTS_ID,
  GAME_SIDEBAR_HLTB_ID,
  GAME_SIDEBAR_LANGUAGES_ID,
  GAME_SIDEBAR_METADATA_ID,
  GAME_SIDEBAR_PROTONDB_ID,
  GAME_SIDEBAR_REGION_ID,
  GAME_SIDEBAR_REQUIREMENTS_ID,
  GAME_SIDEBAR_STATS_ID,
  getGameDescriptionBlockItemId,
} from "../../components/pages/game/navigation";
import { useGameDetails, useHeaderTitle } from "../../hooks";
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

  for (const element of document.querySelectorAll(DESCRIPTION_DISALLOWED_SELECTORS)) {
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

  return sections.map((sectionHtml, index) => ({
    id: getGameDescriptionBlockItemId(index),
    html: sectionHtml,
  }));
}

export default function Game() {
  const { shop, objectId } = useParams<{ shop: GameShop; objectId: string }>();
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false);
  const [hasNavigableComments, setHasNavigableComments] = useState(false);
  const [activeMediaItemId, setActiveMediaItemId] = useState<string | null>(
    null
  );
  const pageRef = useRef<HTMLDivElement | null>(null);
  const descriptionContainerRef = useRef<HTMLDivElement | null>(null);
  const {
    shopDetails,
    game,
    stats,
    isGameRunning,
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
  const descriptionBlocks = useMemo(() => {
    const document = preprocessSteamDescriptionDocument(
      shopDetails?.detailed_description ?? ""
    );

    return buildDescriptionSections(document);
  }, [shopDetails?.detailed_description]);
  const hasMedia =
    (shopDetails?.movies?.length ?? 0) > 0 ||
    (shopDetails?.screenshots?.length ?? 0) > 0;
  const descriptionEntryTarget = useMemo(() => {
    if (descriptionBlocks.length === 0) {
      return undefined;
    }

    return {
      type: "region" as const,
      regionId: GAME_DESCRIPTION_REGION_ID,
      entryDirection: "down" as const,
      preferRememberedFocus: false,
    };
  }, [descriptionBlocks.length]);
  const mediaCarouselEntryTarget = useMemo(() => {
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

    return descriptionEntryTarget;
  }, [activeMediaItemId, descriptionEntryTarget, hasMedia]);
  const sidebarEntryTarget = useMemo(
    () => ({
      type: "region" as const,
      regionId: GAME_SIDEBAR_REGION_ID,
      entryDirection: "right" as const,
      preferRememberedFocus: true,
    }),
    []
  );
  const sidebarStatsEntryTarget = useMemo(
    () => getItemFocusTarget(GAME_SIDEBAR_STATS_ID),
    []
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
  const heroActionsLeftNavigationTarget = useMemo(
    () => ({
      type: "region" as const,
      regionId: GAME_HERO_ACTIONS_REGION_ID,
      entryDirection: "left" as const,
      preferRememberedFocus: true,
    }),
    []
  );
  const sidebarDescriptionLeftNavigationTarget = useMemo(() => {
    if (descriptionBlocks.length > 0) {
      return {
        type: "region" as const,
        regionId: GAME_DESCRIPTION_REGION_ID,
        entryDirection: "left" as const,
        preferRememberedFocus: true,
      };
    }

    return heroActionsLeftNavigationTarget;
  }, [descriptionBlocks.length, heroActionsLeftNavigationTarget]);
  const sidebarCarouselLeftNavigationTarget = useMemo(() => {
    if (hasMedia) {
      return mediaCarouselEntryTarget ?? heroActionsLeftNavigationTarget;
    }

    return sidebarDescriptionLeftNavigationTarget;
  }, [
    hasMedia,
    heroActionsLeftNavigationTarget,
    mediaCarouselEntryTarget,
    sidebarDescriptionLeftNavigationTarget,
  ]);
  const sidebarDescriptionNavigationOverrides = useMemo(
    () => ({
      left: sidebarDescriptionLeftNavigationTarget,
      right: { type: "block" as const },
    }),
    [sidebarDescriptionLeftNavigationTarget]
  );
  const sidebarCarouselNavigationOverrides = useMemo(
    () => ({
      left: sidebarCarouselLeftNavigationTarget,
      right: { type: "block" as const },
    }),
    [sidebarCarouselLeftNavigationTarget]
  );
  const commentsTopNavigationTarget = useMemo(() => {
    if (descriptionBlocks.length > 0) {
      return getItemFocusTarget(
        getGameDescriptionBlockItemId(descriptionBlocks.length - 1)
      );
    }

    if (hasMedia) {
      return mediaCarouselEntryTarget ?? heroActionsLeftNavigationTarget;
    }

    return heroActionsLeftNavigationTarget;
  }, [
    descriptionBlocks.length,
    hasMedia,
    heroActionsLeftNavigationTarget,
    mediaCarouselEntryTarget,
  ]);
  const sidebarStatsNavigationOverrides = useMemo(
    () => ({
      ...sidebarCarouselNavigationOverrides,
      up: { type: "block" as const },
    }),
    [sidebarCarouselNavigationOverrides]
  );
  const sidebarLanguagesNavigationOverrides = useMemo(
    () => ({
      ...sidebarDescriptionNavigationOverrides,
      down: { type: "block" as const },
    }),
    [sidebarDescriptionNavigationOverrides]
  );

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
        resolvedGameTitle
      );
      await updateGame();
      globalThis.window.dispatchEvent(new Event("library-update"));
    } finally {
      setIsAddingToLibrary(false);
    }
  }, [
    canAddToLibrary,
    game,
    isAddingToLibrary,
    objectId,
    resolvedGameTitle,
    shop,
    shopDetails,
    updateGame,
  ]);

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
          onPlay={openGame}
          onDownload={handleOpenDownloadModal}
          onAddToLibrary={handleAddToLibrary}
          onOpenDownloadOptions={handleOpenDownloadModal}
          onClose={closeGame}
          isAddingToLibrary={isAddingToLibrary}
          canAddToLibrary={canAddToLibrary}
          mediaCarouselEntryTarget={mediaCarouselEntryTarget}
          sidebarEntryTarget={sidebarEntryTarget}
        />

        <section className="game-page__content">
          <PlaytimeBar game={game} />

          <div className="game-page__main-layout">
            <div className="game-page__main-column">
              <ScreenshotCarousel
                videos={shopDetails.movies ?? []}
                screenshots={shopDetails.screenshots ?? []}
                onActiveItemChange={setActiveMediaItemId}
                descriptionEntryTarget={descriptionEntryTarget}
                sidebarEntryTarget={sidebarStatsEntryTarget}
              />

              {descriptionBlocks.length > 0 && (
                <VerticalFocusGroup
                  regionId={GAME_DESCRIPTION_REGION_ID}
                  className="game-page__detailed-description"
                  asChild
                >
                  <div ref={descriptionContainerRef}>
                    {descriptionBlocks.map((block, index) => (
                      <FocusItem
                        key={block.id}
                        id={block.id}
                        navigationOverrides={{
                          left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home),
                          right: sidebarEntryTarget,
                          up:
                            index === 0
                              ? {
                                  type: "region",
                                  regionId: GAME_MEDIA_CAROUSEL_REGION_ID,
                                  entryDirection: "up",
                                  preferRememberedFocus: true,
                                }
                              : undefined,
                          down:
                            index === descriptionBlocks.length - 1
                              ? commentsEntryTarget ?? { type: "block" }
                              : undefined,
                        }}
                        asChild
                      >
                        <div className="game-page__detailed-description-block">
                          <div
                            className="game-page__detailed-description-block-content"
                            dangerouslySetInnerHTML={{
                              __html: block.html,
                            }}
                          />
                        </div>
                      </FocusItem>
                    ))}
                  </div>
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
                    aria-label="Stats"
                  >
                    <div className="game-page__stats-title">
                      <Typography>Stats</Typography>
                    </div>

                    <div className="game-page__stats-row">
                      <Typography className="game-page__stats-label">
                        Rating
                      </Typography>
                      <Typography className="game-page__stats-value">
                        {formatNumber(stats?.averageScore ?? 0)}
                      </Typography>
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

                <HowLongToBeatBox
                  howLongToBeat={howLongToBeat ?? []}
                  focusId={GAME_SIDEBAR_HLTB_ID}
                  focusNavigationOrder={1}
                  focusNavigationOverrides={sidebarCarouselNavigationOverrides}
                />

                <ProtonDBSection
                  protonDBData={protonDBData}
                  focusId={GAME_SIDEBAR_PROTONDB_ID}
                  focusNavigationOrder={2}
                  focusNavigationOverrides={sidebarCarouselNavigationOverrides}
                />

                <AchievementsBox
                  achievements={achievements ?? []}
                  focusId={GAME_SIDEBAR_ACHIEVEMENTS_ID}
                  focusNavigationOrder={3}
                  focusNavigationOverrides={sidebarDescriptionNavigationOverrides}
                />

                <FocusItem
                  id={GAME_SIDEBAR_METADATA_ID}
                  navigationOrder={4}
                  navigationOverrides={sidebarDescriptionNavigationOverrides}
                  asChild
                >
                  <section
                    className="game-page__sidebar-section game-page__metadata"
                    aria-label="Game info"
                  >
                    {shopDetails.developers[0] && (
                      <div className="game-page__metadata-row">
                        <Typography className="game-page__metadata-label">
                          Developed by
                        </Typography>
                        <Typography className="game-page__metadata-value">
                          {shopDetails.developers[0]}
                        </Typography>
                      </div>
                    )}

                    {shopDetails.publishers[0] && (
                      <div className="game-page__metadata-row">
                        <Typography className="game-page__metadata-label">
                          Published by
                        </Typography>
                        <Typography className="game-page__metadata-value">
                          {shopDetails.publishers[0]}
                        </Typography>
                      </div>
                    )}

                    <div className="game-page__metadata-row">
                      <Typography className="game-page__metadata-label">
                        Release Date
                      </Typography>
                      <Typography className="game-page__metadata-value">
                        {shopDetails.release_date.date}
                      </Typography>
                    </div>
                  </section>
                </FocusItem>

                <RequirementsToPlay
                  shopDetails={shopDetails}
                  focusId={GAME_SIDEBAR_REQUIREMENTS_ID}
                  focusNavigationOrder={5}
                  focusNavigationOverrides={sidebarDescriptionNavigationOverrides}
                />

                <SupportedLanguages
                  shopDetails={shopDetails}
                  focusId={GAME_SIDEBAR_LANGUAGES_ID}
                  focusNavigationOrder={6}
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
            libraryHeroImageUrl:
              shopDetails.assets?.libraryHeroImageUrl ?? null,
          }}
        />
      </div>
    </VerticalFocusGroup>
  );
}
