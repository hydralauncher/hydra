import type { LibraryGame, ShopAssets } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEventHandler } from "react";
import { useTranslation } from "react-i18next";
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
import {
  buildCatalogGameContextMenuItems,
  buildLibraryGameContextMenuItems,
  GameSettingsModal,
  useLibraryFavorite,
  useLibraryLaunchGame,
} from "../../components/pages/library";
import { ConfirmationModal } from "../../components/pages/library/settings-modal/submodals";
import { IS_DESKTOP } from "../../constants";
import { useGameCollections, useLibrary } from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";

import "./page.scss";

const HOME_SECTION_ORDER = ["hero", "weekly", "trending", "challenge"] as const;

type HomeSectionId = (typeof HOME_SECTION_ORDER)[number];

const DEFAULT_MENU_POSITION = { x: 0, y: 0 };

interface HomeCatalogMenuState {
  catalogGame: ShopAssets | null;
  visible: boolean;
  position: { x: number; y: number };
  restoreFocusId: string | null;
}

interface HomePendingConfirmationState {
  type: "remove-files" | "remove-library";
  game: LibraryGame;
}

export default function Home() {
  const navigate = useNavigate();
  const { t } = useTranslation("library");
  const { library, updateLibrary } = useLibrary();
  const { loadCollections } = useGameCollections();

  const refreshLibraryData = useCallback(async () => {
    await Promise.all([updateLibrary(), loadCollections()]);
    globalThis.window.dispatchEvent(new Event("library-update"));
  }, [loadCollections, updateLibrary]);

  const { favoriteLoadingGameId, toggleFavorite } =
    useLibraryFavorite(updateLibrary);

  const handleLaunchFromMenu = useLibraryLaunchGame(
    useCallback((_game: LibraryGame) => {
      logger.warn(
        "Big Picture: Install/download from context menu is not wired yet"
      );
    }, [])
  );

  const handleOpenLibraryGameDetails = useCallback(
    (game: LibraryGame) => {
      navigate(getBigPictureGameDetailsPath(game));
    },
    [navigate]
  );

  const handleViewAchievementsPlaceholder = useCallback((game: LibraryGame) => {
    logger.log(
      `Big Picture library context menu achievements: ${game.objectId}`
    );
  }, []);

  const handleSharePlaceholder = useCallback((game: LibraryGame) => {
    logger.log(`Big Picture library context menu share: ${game.objectId}`);
  }, []);

  const [settingsGame, setSettingsGame] = useState<LibraryGame | null>(null);

  const handleLibraryOptionsFromMenu = useCallback((game: LibraryGame) => {
    setSettingsGame(game);
  }, []);

  const [pendingConfirmation, setPendingConfirmation] =
    useState<HomePendingConfirmationState | null>(null);

  const handleRequestRemoveFilesFromMenu = useCallback((game: LibraryGame) => {
    setPendingConfirmation({ type: "remove-files", game });
  }, []);

  const handleRequestRemoveFromLibraryFromMenu = useCallback(
    (game: LibraryGame) => {
      setPendingConfirmation({ type: "remove-library", game });
    },
    []
  );

  const handleConfirmRemoveFiles = useCallback(async () => {
    if (pendingConfirmation?.type !== "remove-files") return;

    await globalThis.window.electron.deleteGameFolder(
      pendingConfirmation.game.shop,
      pendingConfirmation.game.objectId
    );
    await refreshLibraryData();
  }, [pendingConfirmation, refreshLibraryData]);

  const handleConfirmRemoveFromLibrary = useCallback(async () => {
    if (pendingConfirmation?.type !== "remove-library") return;

    const { game } = pendingConfirmation;

    if (game.download?.status === "active") {
      await globalThis.window.electron.cancelGameDownload(
        game.shop,
        game.objectId
      );
    }

    await globalThis.window.electron.removeGameFromLibrary(
      game.shop,
      game.objectId
    );
    await refreshLibraryData();
  }, [pendingConfirmation, refreshLibraryData]);

  const handleCloseConfirmation = useCallback(() => {
    setPendingConfirmation(null);
  }, []);

  const [menuState, setMenuState] = useState<HomeCatalogMenuState>({
    catalogGame: null,
    visible: false,
    position: DEFAULT_MENU_POSITION,
    restoreFocusId: null,
  });

  const [addingCatalogKey, setAddingCatalogKey] = useState<string | null>(null);

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
    } finally {
      setAddingCatalogKey(null);
    }
  }, [menuState.catalogGame, refreshLibraryData]);

  const handleCatalogNavigateFromMenu = useCallback(() => {
    const target = menuState.catalogGame;

    if (!target) return;

    navigate(getBigPictureGameDetailsPath(target));
  }, [menuState.catalogGame, navigate]);

  const handleCatalogViewAchievementsFromMenu = useCallback(() => {
    const target = menuState.catalogGame;

    if (!target) return;

    const basePath = getBigPictureGameDetailsPath(target);
    navigate(`${basePath}#game-achievements-title`);
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
        t,
        game,
        {
          onLaunchOrDownload: handleLaunchFromMenu,
          onOpenGamePage: handleOpenLibraryGameDetails,
          onToggleFavorite: toggleFavorite,
          onViewAchievements: handleViewAchievementsPlaceholder,
          onShare: handleSharePlaceholder,
          onOptions: handleLibraryOptionsFromMenu,
          onUninstall: handleRequestRemoveFilesFromMenu,
          onRemoveFromLibrary: handleRequestRemoveFromLibraryFromMenu,
        },
        favoriteLoadingGameId === game.id
      );
    }

    const catalogKey = `${target.shop}:${target.objectId}`;
    const canAddToLibrary = IS_DESKTOP && target.shop !== "custom";

    return buildCatalogGameContextMenuItems(t, target, {
      canAddToLibrary,
      isAddingToLibrary: addingCatalogKey === catalogKey,
      onAddToLibrary: handleAddCatalogGameToLibrary,
      onOpenGamePage: handleCatalogNavigateFromMenu,
      onShare: handleCatalogShareFromMenu,
      onViewAchievements: handleCatalogViewAchievementsFromMenu,
    });
  }, [
    addingCatalogKey,
    favoriteLoadingGameId,
    handleAddCatalogGameToLibrary,
    handleCatalogNavigateFromMenu,
    handleCatalogShareFromMenu,
    handleCatalogViewAchievementsFromMenu,
    handleLaunchFromMenu,
    handleLibraryOptionsFromMenu,
    handleOpenLibraryGameDetails,
    handleRequestRemoveFilesFromMenu,
    handleRequestRemoveFromLibraryFromMenu,
    handleSharePlaceholder,
    handleViewAchievementsPlaceholder,
    libraryGameForOpenMenu,
    menuState.catalogGame,
    menuState.visible,
    t,
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
            void navigate(getBigPictureGameDetailsPath(game));
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
            void navigate(getBigPictureGameDetailsPath(game));
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
                        void navigate(getBigPictureGameDetailsPath(game));
                      },
                      secondary: () => {
                        openChallengeContextMenuSecondary();
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
                      onContextMenu={openChallengePointerMenu}
                    />
                  </FocusItem>
                );
              })}
            </GridFocusGroup>
          </section>
        ) : null}

        <ContextMenu
          ariaLabel={t("context_menu_accessible_label")}
          items={menuItems}
          position={menuState.position}
          restoreFocusId={menuState.restoreFocusId}
          visible={
            Boolean(menuState.visible && menuState.catalogGame !== null) &&
            menuItems.length > 0
          }
          onClose={closeCatalogMenu}
        />

        <ConfirmationModal
          confirmLabel="Uninstall"
          danger
          description="This deletes the downloaded game files from disk."
          onClose={handleCloseConfirmation}
          onConfirm={handleConfirmRemoveFiles}
          visible={pendingConfirmation?.type === "remove-files"}
          title="Uninstall?"
        />

        <ConfirmationModal
          confirmLabel="Remove"
          danger
          description={`Remove ${
            pendingConfirmation?.type === "remove-library"
              ? (pendingConfirmation.game.title ?? "this game")
              : "this game"
          } from your library. Downloaded files will not be deleted.`}
          onClose={handleCloseConfirmation}
          onConfirm={handleConfirmRemoveFromLibrary}
          visible={pendingConfirmation?.type === "remove-library"}
          title="Remove from library?"
        />

        <GameSettingsModal
          game={settingsGame}
          visible={settingsGame !== null}
          onClose={() => setSettingsGame(null)}
          onGameUpdated={(updatedGame) => {
            setSettingsGame(updatedGame);
            void updateLibrary();
          }}
        />
      </section>
    </VerticalFocusGroup>
  );
}
