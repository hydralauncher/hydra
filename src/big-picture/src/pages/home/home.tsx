import type { LibraryGame, ShopAssets } from "@types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEventHandler } from "react";
import { useNavigate } from "react-router-dom";
import { logger } from "@renderer/logger";

import { HomePageHero } from "./hero";
import { useFeaturedGame } from "./hero/use-featured-game";
import { type HomeChallengeGame } from "./home-data";
import { useHotGames } from "./use-hot-games";
import { useHomeChallengeGridNavigation } from "./use-home-challenge-grid-navigation";
import { useHardPlatinums } from "./use-hard-platinums";
import { useWeeklyGames } from "./use-weekly-games";
import {
  getHomeChallengeGameItemId,
  getHomeTrendingGameItemId,
  getHomeWeeklyGameItemId,
  HOME_HARD_PLATINUMS_GRID_REGION_ID,
  HOME_HERO_ACTIONS_REGION_ID,
  HOME_PAGE_REGION_ID,
  HOME_TRENDING_GAMES_CAROUSEL_REGION_ID,
  HOME_WEEKLY_GAMES_CAROUSEL_REGION_ID,
} from "./navigation";
import {
  buildLibraryToastOptions,
  getBigPictureGameAchievementsPath,
  getBigPictureGameDetailsPath,
  getGameLandscapeImageSource,
  getItemFocusTarget,
} from "../../helpers";
import {
  BIG_PICTURE_HEADER_REGION_ID,
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
} from "../../layout";
import {
  ChallengeGameCard,
  ContextMenu,
  FocusCarousel,
  FocusItem,
  GridFocusGroup,
  VerticalFocusGroup,
} from "../../components";
import { ConfirmationModal, DownloadGameModal } from "../../components/modals";
import {
  buildCatalogGameContextMenuItems,
  buildLibraryGameContextMenuItems,
  useLibraryFavorite,
  useLibraryLaunchGame,
} from "../../components/pages/library";
import { IS_DESKTOP } from "../../constants";
import {
  useBigPictureToast,
  useGameCollections,
  useLibrary,
  useNavigation,
} from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";

import "./page.scss";

const HOME_SECTION_ORDER = ["hero", "weekly", "trending", "challenge"] as const;

type HomeSectionId = (typeof HOME_SECTION_ORDER)[number];
type DownloadModalGame = Pick<
  ShopAssets,
  "objectId" | "shop" | "title" | "libraryHeroImageUrl"
>;

const DEFAULT_MENU_POSITION = { x: 0, y: 0 };

interface HomeCatalogMenuState {
  catalogGame: ShopAssets | null;
  visible: boolean;
  position: { x: number; y: number };
  restoreFocusId: string | null;
}

interface PendingHomeAction {
  type: "remove-files" | "remove-from-library";
  game: LibraryGame;
  restoreFocusId: string | null;
}

export default function Home() {
  const navigate = useNavigate();
  const { setFocus } = useNavigation();
  const { showSuccessToast } = useBigPictureToast();
  const { library, updateLibrary } = useLibrary();
  const { loadCollections } = useGameCollections();

  const refreshLibraryData = useCallback(async () => {
    await Promise.all([updateLibrary(), loadCollections()]);
    globalThis.window.dispatchEvent(new Event("library-update"));
  }, [loadCollections, updateLibrary]);

  const { favoriteLoadingGameId, toggleFavorite } =
    useLibraryFavorite(updateLibrary);

  const [downloadModalGame, setDownloadModalGame] =
    useState<DownloadModalGame | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingHomeAction | null>(
    null
  );
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [menuState, setMenuState] = useState<HomeCatalogMenuState>({
    catalogGame: null,
    visible: false,
    position: DEFAULT_MENU_POSITION,
    restoreFocusId: null,
  });
  const downloadModalRestoreFocusIdRef = useRef<string | null>(null);

  const handleCloseDownloadModal = useCallback(() => {
    const restoreFocusId = downloadModalRestoreFocusIdRef.current;

    downloadModalRestoreFocusIdRef.current = null;
    setDownloadModalGame(null);

    if (!restoreFocusId) return;

    globalThis.window.requestAnimationFrame(() => {
      setFocus(restoreFocusId);
    });
  }, [setFocus]);

  const handleRequestRemoveFilesFromMenu = useCallback(
    (game: LibraryGame) => {
      setPendingAction({
        type: "remove-files",
        game,
        restoreFocusId: menuState.restoreFocusId,
      });
    },
    [menuState.restoreFocusId]
  );

  const handleRequestRemoveFromLibraryFromMenu = useCallback(
    (game: LibraryGame) => {
      setPendingAction({
        type: "remove-from-library",
        game,
        restoreFocusId: menuState.restoreFocusId,
      });
    },
    [menuState.restoreFocusId]
  );

  const handleClosePendingAction = useCallback(() => {
    const restoreFocusId = pendingAction?.restoreFocusId ?? null;

    setPendingAction(null);
    setIsSubmittingAction(false);

    if (!restoreFocusId) return;

    globalThis.window.requestAnimationFrame(() => {
      setFocus(restoreFocusId);
    });
  }, [pendingAction?.restoreFocusId, setFocus]);

  const handleConfirmPendingAction = useCallback(async () => {
    const currentAction = pendingAction;

    if (!currentAction || !IS_DESKTOP) return;

    setIsSubmittingAction(true);

    try {
      const { game } = currentAction;

      if (
        game.download?.status === "active" ||
        game.download?.status === "extracting" ||
        game.download?.extracting
      ) {
        await globalThis.window.electron.cancelGameDownload(
          game.shop,
          game.objectId
        );
      } else if (
        currentAction.type === "remove-files" &&
        game.download?.status === "seeding"
      ) {
        await globalThis.window.electron.pauseGameSeed(
          game.shop,
          game.objectId
        );
      }

      if (currentAction.type === "remove-files") {
        await globalThis.window.electron.deleteGameFolder(
          game.shop,
          game.objectId
        );
      } else {
        await globalThis.window.electron.removeGameFromLibrary(
          game.shop,
          game.objectId
        );
      }

      await refreshLibraryData();

      if (currentAction.type === "remove-from-library") {
        const { title, ...toastOptions } = await buildLibraryToastOptions(
          game,
          "removed"
        );
        showSuccessToast(title, toastOptions);
      }

      setPendingAction(null);
      setIsSubmittingAction(false);

      const restoreFocusId = currentAction.restoreFocusId;

      if (!restoreFocusId) return;

      globalThis.window.requestAnimationFrame(() => {
        setFocus(restoreFocusId);
      });
    } catch (error) {
      logger.error("Failed to execute home library action", error);
      setIsSubmittingAction(false);
    }
  }, [pendingAction, refreshLibraryData, setFocus, showSuccessToast]);

  const [addingCatalogKey, setAddingCatalogKey] = useState<string | null>(null);

  const openDownloadModalFromContextMenu = useCallback(
    (game: DownloadModalGame) => {
      const restoreFocusId = menuState.restoreFocusId;
      downloadModalRestoreFocusIdRef.current = restoreFocusId;

      globalThis.window.requestAnimationFrame(() => {
        setDownloadModalGame(game);
      });
    },
    [menuState.restoreFocusId]
  );

  const handleLaunchFromMenu = useLibraryLaunchGame(
    useCallback(
      (game: LibraryGame) => {
        openDownloadModalFromContextMenu(game);
      },
      [openDownloadModalFromContextMenu]
    )
  );

  const closeCatalogMenu = useCallback(() => {
    setMenuState((current) => ({
      ...current,
      visible: false,
    }));
  }, []);

  const openCatalogMenu = useCallback(
    (
      catalogGame: ShopAssets,
      position: { x: number; y: number },
      restoreFocusId: string
    ) => {
      setMenuState({
        catalogGame,
        visible: true,
        position,
        restoreFocusId,
      });
    },
    []
  );

  const handleAddCatalogGameToLibrary = useCallback(async () => {
    const target = menuState.catalogGame;

    if (!target || !IS_DESKTOP || target.shop === "custom") return;

    const key = `${target.shop}:${target.objectId}`;
    setAddingCatalogKey(key);

    try {
      await globalThis.window.electron.addGameToLibrary(
        target.shop,
        target.objectId,
        target.title
      );
      await refreshLibraryData();

      const { title, ...toastOptions } = await buildLibraryToastOptions(
        target,
        "added"
      );
      showSuccessToast(title, toastOptions);
    } finally {
      setAddingCatalogKey(null);
    }
  }, [menuState.catalogGame, refreshLibraryData, showSuccessToast]);

  const handleOpenCatalogDownloadOptions = useCallback(() => {
    const target = menuState.catalogGame;

    if (!target) return;

    openDownloadModalFromContextMenu(target);
  }, [menuState.catalogGame, openDownloadModalFromContextMenu]);

  const handleCatalogViewAchievementsFromMenu = useCallback(() => {
    const target = menuState.catalogGame;

    if (!target) return;

    navigate(getBigPictureGameAchievementsPath(target));
  }, [menuState.catalogGame, navigate]);

  const handleCatalogShareFromMenu = useCallback(async () => {
    const target = menuState.catalogGame;

    if (!target) return;

    const electron = globalThis.window.electron as {
      openExternal?: (src: string) => Promise<void>;
    };

    if (
      target.shop === "steam" &&
      typeof electron.openExternal === "function"
    ) {
      await electron.openExternal(
        `https://store.steampowered.com/app/${target.objectId}/`
      );

      return;
    }

    logger.log("Big Picture catalog context menu share", {
      objectId: target.objectId,
      shop: target.shop,
    });
  }, [menuState.catalogGame]);

  const libraryGameForOpenMenu = useMemo(() => {
    const target = menuState.catalogGame;

    if (!target) return undefined;

    return library.find(
      (entry) =>
        entry.shop === target.shop && entry.objectId === target.objectId
    );
  }, [library, menuState.catalogGame]);

  const menuItems = useMemo(() => {
    if (!menuState.visible || !menuState.catalogGame) return [];

    const target = menuState.catalogGame;

    if (libraryGameForOpenMenu) {
      const game = libraryGameForOpenMenu;

      return buildLibraryGameContextMenuItems(
        game,
        {
          onLaunchOrDownload: handleLaunchFromMenu,
          onToggleFavorite: toggleFavorite,
          onViewAchievements: handleCatalogViewAchievementsFromMenu,
          onUninstall: handleRequestRemoveFilesFromMenu,
          onRemoveFromLibrary: handleRequestRemoveFromLibraryFromMenu,
        },
        favoriteLoadingGameId === game.id
      );
    }

    const catalogKey = `${target.shop}:${target.objectId}`;
    const canAddToLibrary = IS_DESKTOP && target.shop !== "custom";

    return buildCatalogGameContextMenuItems(target, {
      canAddToLibrary,
      isAddingToLibrary: addingCatalogKey === catalogKey,
      onOpenDownloadOptions: handleOpenCatalogDownloadOptions,
      onAddToLibrary: handleAddCatalogGameToLibrary,
      onShare: handleCatalogShareFromMenu,
      onViewAchievements: handleCatalogViewAchievementsFromMenu,
    });
  }, [
    addingCatalogKey,
    favoriteLoadingGameId,
    handleAddCatalogGameToLibrary,
    handleOpenCatalogDownloadOptions,
    handleCatalogShareFromMenu,
    handleCatalogViewAchievementsFromMenu,
    handleLaunchFromMenu,
    handleRequestRemoveFilesFromMenu,
    handleRequestRemoveFromLibraryFromMenu,
    libraryGameForOpenMenu,
    menuState.catalogGame,
    menuState.visible,
    toggleFavorite,
  ]);

  const { featuredGame } = useFeaturedGame();
  const hardPlatinums = useHardPlatinums();
  const hotGames = useHotGames();
  const weeklyGames = useWeeklyGames();

  useEffect(() => {
    void updateLibrary();
  }, [updateLibrary]);

  const hasHero = featuredGame != null;
  const hasWeekly = weeklyGames.length > 0;
  const hasTrending = hotGames.length > 0;
  const hasChallenge = hardPlatinums.length > 0;

  const homeSectionRegionIdById: Record<
    Exclude<HomeSectionId, "hero">,
    string
  > = {
    weekly: HOME_WEEKLY_GAMES_CAROUSEL_REGION_ID,
    trending: HOME_TRENDING_GAMES_CAROUSEL_REGION_ID,
    challenge: HOME_HARD_PLATINUMS_GRID_REGION_ID,
  };

  const availableSections = HOME_SECTION_ORDER.filter((sectionId) => {
    switch (sectionId) {
      case "hero":
        return hasHero;
      case "weekly":
        return hasWeekly;
      case "trending":
        return hasTrending;
      case "challenge":
        return hasChallenge;
    }
  });

  const getRegionTarget = (
    sectionId: Exclude<HomeSectionId, "hero"> | undefined,
    entryDirection: "right" | "down" = "right"
  ): FocusOverrideTarget | undefined => {
    if (!sectionId) return undefined;

    return {
      type: "region",
      regionId: homeSectionRegionIdById[sectionId],
      entryDirection,
    };
  };

  const getFirstContentRegionBelowHero = () => {
    const nextSectionId = availableSections.find((sectionId) => {
      return sectionId !== "hero";
    });

    return getRegionTarget(nextSectionId);
  };

  const getNextRegionBelow = (sectionId: Exclude<HomeSectionId, "hero">) => {
    const currentIndex = availableSections.indexOf(sectionId);

    if (currentIndex === -1) return undefined;

    const nextSectionId = availableSections[currentIndex + 1];

    if (!nextSectionId || nextSectionId === "hero") return undefined;

    return getRegionTarget(nextSectionId);
  };

  const getPreviousRegionAbove = (
    sectionId: Exclude<HomeSectionId, "hero">
  ): { type: "region"; regionId: string; entryDirection: "right" } => {
    const currentIndex = availableSections.indexOf(sectionId);
    const previousSectionId =
      currentIndex > 0 ? availableSections[currentIndex - 1] : "hero";

    if (previousSectionId === "hero") {
      return {
        type: "region",
        regionId: HOME_HERO_ACTIONS_REGION_ID,
        entryDirection: "right",
      };
    }

    return getRegionTarget(previousSectionId) as {
      type: "region";
      regionId: string;
      entryDirection: "right";
    };
  };

  const heroDownNavigationTarget = getFirstContentRegionBelowHero();
  const heroUpNavigationTarget: FocusOverrideTarget = {
    type: "region",
    regionId: BIG_PICTURE_HEADER_REGION_ID,
    entryDirection: "down",
  };

  const getWeeklyGameNavigationOverrides = (
    _game: (typeof weeklyGames)[number],
    index: number,
    games: typeof weeklyGames
  ): FocusOverrides => ({
    ...(index === 0
      ? {
          left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home),
        }
      : {}),
    ...(index === games.length - 1
      ? {
          right: {
            type: "block",
          },
        }
      : {}),
    up: {
      type: "region",
      regionId: HOME_HERO_ACTIONS_REGION_ID,
      entryDirection: "right",
    },
    ...(getNextRegionBelow("weekly")
      ? {
          down: getNextRegionBelow("weekly"),
        }
      : {}),
  });

  const getHotGameNavigationOverrides = (
    _game: (typeof hotGames)[number],
    index: number,
    games: typeof hotGames
  ): FocusOverrides => ({
    ...(index === 0
      ? {
          left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home),
        }
      : {}),
    ...(index === games.length - 1
      ? {
          right: {
            type: "block",
          },
        }
      : {}),
    up: {
      ...getPreviousRegionAbove("trending"),
    },
    ...(getNextRegionBelow("trending")
      ? {
          down: getNextRegionBelow("trending"),
        }
      : {}),
  });

  const challengeGridUpRegionId = getPreviousRegionAbove("challenge").regionId;
  const challengeNavigationOverridesByItemId = useHomeChallengeGridNavigation(
    hardPlatinums,
    challengeGridUpRegionId
  );

  return (
    <VerticalFocusGroup regionId={HOME_PAGE_REGION_ID} asChild>
      <section className="home-page">
        <HomePageHero
          featuredGame={featuredGame}
          downNavigationTarget={heroDownNavigationTarget}
          upNavigationTarget={heroUpNavigationTarget}
        />
        <FocusCarousel
          title="Popular on Hydra"
          cardVariant="vertical"
          games={weeklyGames}
          regionId={HOME_WEEKLY_GAMES_CAROUSEL_REGION_ID}
          getItemId={getHomeWeeklyGameItemId}
          getItemNavigationOverrides={getWeeklyGameNavigationOverrides}
          onCarouselItemOpenContextMenu={openCatalogMenu}
          onItemActivate={(game) => {
            navigate(getBigPictureGameDetailsPath(game));
          }}
          showRightFade
        />
        <FocusCarousel
          title="Trending Right Now"
          cardVariant="horizontal"
          games={hotGames}
          regionId={HOME_TRENDING_GAMES_CAROUSEL_REGION_ID}
          getItemId={getHomeTrendingGameItemId}
          getItemNavigationOverrides={getHotGameNavigationOverrides}
          onCarouselItemOpenContextMenu={openCatalogMenu}
          onItemActivate={(game) => {
            navigate(getBigPictureGameDetailsPath(game));
          }}
          showRightFade
        />
        {hardPlatinums.length > 0 ? (
          <section className="home-page__challenge-section">
            <h2 className="home-page__challenge-title">
              Challenge yourself: Hard platinums
            </h2>
            <GridFocusGroup
              className="home-page__challenge-grid"
              regionId={HOME_HARD_PLATINUMS_GRID_REGION_ID}
            >
              {hardPlatinums.map((game: HomeChallengeGame) => {
                const itemId = getHomeChallengeGameItemId(game);

                const openChallengeContextMenuSecondary = () => {
                  const element = document.getElementById(itemId);
                  const rect = element?.getBoundingClientRect();

                  if (!rect) return;

                  openCatalogMenu(
                    game,
                    {
                      x: rect.left + rect.width / 2,
                      y: rect.top + rect.height / 2,
                    },
                    itemId
                  );
                };

                const openChallengePointerMenu: MouseEventHandler<
                  HTMLElement
                > = (event) => {
                  event.preventDefault();
                  event.stopPropagation();

                  openCatalogMenu(
                    game,
                    { x: event.clientX, y: event.clientY },
                    itemId
                  );
                };

                return (
                  <FocusItem
                    key={itemId}
                    actions={{
                      primary: () => {
                        navigate(getBigPictureGameDetailsPath(game));
                      },
                      press: {
                        y: () => {
                          openChallengeContextMenuSecondary();
                        },
                      },
                    }}
                    navigationOverrides={
                      challengeNavigationOverridesByItemId[itemId]
                    }
                    id={itemId}
                  >
                    <ChallengeGameCard
                      coverImageUrl={getGameLandscapeImageSource(game)}
                      downloadSources={game.downloadSources}
                      gameTitle={game.title}
                      genres={game.genres}
                      onClick={() => {
                        navigate(getBigPictureGameDetailsPath(game));
                      }}
                      onContextMenu={openChallengePointerMenu}
                    />
                  </FocusItem>
                );
              })}
            </GridFocusGroup>
          </section>
        ) : null}

        <ContextMenu
          ariaLabel="Game context menu"
          items={menuItems}
          position={menuState.position}
          restoreFocusId={menuState.restoreFocusId}
          visible={
            Boolean(menuState.visible && menuState.catalogGame !== null) &&
            menuItems.length > 0
          }
          onClose={closeCatalogMenu}
        />

        {downloadModalGame ? (
          <DownloadGameModal
            key={`${downloadModalGame.shop}:${downloadModalGame.objectId}`}
            visible
            onClose={handleCloseDownloadModal}
            game={downloadModalGame}
          />
        ) : null}

        {pendingAction ? (
          <ConfirmationModal
            visible
            title={
              pendingAction.type === "remove-files"
                ? "Remove downloaded files?"
                : "Remove from library?"
            }
            description={
              pendingAction.type === "remove-files"
                ? "This deletes the downloaded game files from disk."
                : `Remove ${pendingAction.game.title} from your library. Downloaded files will not be deleted.`
            }
            confirmLabel={
              pendingAction.type === "remove-files" ? "Remove files" : "Remove"
            }
            danger
            loading={isSubmittingAction}
            onClose={handleClosePendingAction}
            onConfirm={handleConfirmPendingAction}
          />
        ) : null}
      </section>
    </VerticalFocusGroup>
  );
}
