import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useDominantColor,
  useAppDispatch,
  useAppSelector,
} from "@renderer/hooks";
import {
  setCatalogueCategory,
  setIsMyGames,
  setIsInstalledGames,
  setCurrentCategory,
} from "@renderer/features";
import { useSteamGridCover } from "@renderer/hooks/use-steamgrid-cover";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import { useNavigate } from "react-router-dom";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import { Button } from "@renderer/components";
import type { DownloadSource, LibraryGame, ShopAssets } from "@types";
import { useLibrary } from "@renderer/hooks/use-library";

import {
  buildGameDetailsPath,
  playBeep,
  getSteamLanguage,
  globalImageCache,
} from "@renderer/helpers";
import { CatalogueCategory } from "@shared";
import cn from "classnames";
import { GameInfo } from "./game-info";
import { FolderInfo } from "./folder-info";
import { ActionInfo } from "./action-info";
import { NewsSection } from "./news-section";
import { HeroCarousel } from "./hero-carousel";
import { WelcomeDashboard } from "./welcome-dashboard";
import HydraLogoSvg from "@renderer/assets/icons/hydra.svg?react";
import AddFolderSvg from "@renderer/assets/icons/add folder.svg?react";
import BibliotecaSvg from "@renderer/assets/icons/Biblioteca.svg?react";
import {
  ContextMenu,
  type ContextMenuItemData,
  ConfirmationModal,
  DownloadGameModal,
} from "@renderer/components";
import { useHomeGroups, type HomeGroup } from "@renderer/hooks/use-home-groups";
import { PlusCircleIcon, TrashIcon, GiftIcon } from "@primer/octicons-react";
import { setOpenedFolderName } from "@renderer/features";
import { useGamepadConnected } from "@renderer/hooks/use-gamepad";
import { useHomeGamepad } from "@renderer/hooks/use-home-gamepad";
import { GamepadHint } from "@renderer/components/gamepad-hint/gamepad-hint";
import "./home.scss";

export const resolveImageSource = (
  imageUrl: string | null | undefined
): string | null => {
  if (!imageUrl) return null;
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  )
    return trimmed;
  if (trimmed.startsWith("local:"))
    return `local:${trimmed.slice("local:".length).replaceAll("\\", "/")}`;
  const normalized = trimmed.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/"))
    return `local:${normalized}`;
  return normalized;
};

export function HomeGameImage({ game }: { game: ShopAssets }) {
  const customCover = resolveImageSource(game.coverImageUrl);
  const customLibrary = resolveImageSource(game.libraryImageUrl);
  const customIcon = resolveImageSource(game.iconUrl);

  const initialPrimarySrc =
    game.shop === "steam"
      ? `https://steamcdn-a.akamaihd.net/steam/apps/${game.objectId}/library_600x900_2x.jpg`
      : (customCover ?? customLibrary ?? customIcon ?? null);

  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [finalFailed, setFinalFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const steamGridCover = useSteamGridCover(
    game.objectId,
    game.title,
    fallbackIndex > 0,
    "vertical"
  );

  const steamHeader =
    game.shop === "steam"
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/header.jpg`
      : null;

  const fallbackSources = useMemo(() => {
    const sources: (string | null | undefined)[] = [initialPrimarySrc];

    if (steamGridCover) sources.push(steamGridCover);

    sources.push(customLibrary);
    sources.push(customCover);

    if (game.shop === "steam") {
      sources.push(
        `https://steamcdn-a.akamaihd.net/steam/apps/${game.objectId}/library_600x900.jpg`
      );
      sources.push(
        `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/capsule_616x353.jpg`
      );
      sources.push(steamHeader);
    }

    sources.push(customIcon);

    return Array.from(new Set(sources.filter(Boolean))) as string[];
  }, [
    initialPrimarySrc,
    steamGridCover,
    customLibrary,
    customCover,
    game.shop,
    game.objectId,
    steamHeader,
    customIcon,
  ]);

  const activeSrc =
    fallbackIndex === 0
      ? initialPrimarySrc
      : fallbackIndex > 0 && steamGridCover === undefined
        ? undefined
        : fallbackSources[fallbackIndex];

  const [imageLoaded, setImageLoaded] = useState(() =>
    activeSrc ? globalImageCache.has(activeSrc) : false
  );

  const handleImageError = () => {
    if (fallbackIndex < fallbackSources.length - 1) {
      setFallbackIndex((prev) => prev + 1);
    } else {
      setFinalFailed(true);
    }
  };

  useEffect(() => {
    setImageLoaded(activeSrc ? globalImageCache.has(activeSrc) : false);
    if (activeSrc && imgRef.current?.complete) {
      if (imgRef.current.naturalWidth > 0) {
        globalImageCache.add(activeSrc);
        setImageLoaded(true);
      } else {
        handleImageError();
      }
    }
  }, [activeSrc]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          textAlign: "center",
          fontSize: "13px",
          fontWeight: 600,
          color: "rgba(255,255,255,0.8)",
          wordBreak: "break-word",
        }}
      >
        {game.title}
      </span>
      {!imageLoaded && (
        <Skeleton
          className="home__card-skeleton"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            height: "100%",
            borderRadius: "inherit",
          }}
        />
      )}
      {!finalFailed &&
        activeSrc &&
        (!activeSrc &&
          steamGridCover !== undefined &&
          fallbackIndex >= fallbackSources.length) === false && (
          <img
            ref={imgRef}
            key={activeSrc}
            src={activeSrc}
            alt={game.title}
            className="home__card-image"
            loading="lazy"
            draggable={false}
            onLoad={(e) => {
              if (e.currentTarget.naturalWidth <= 1) {
                handleImageError();
              } else {
                globalImageCache.add(activeSrc);
                setImageLoaded(true);
              }
            }}
            style={{
              position: "relative",
              zIndex: 1,
              backgroundColor: "inherit",
              opacity: imageLoaded ? 1 : 0,
              transition: "opacity 0.3s ease",
            }}
            onError={handleImageError}
          />
        )}
    </div>
  );
}

const cleanTabLabel = (text: string) =>
  text
    .replace(
      /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu,
      ""
    )
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");

export default function Home() {
  const { t, i18n } = useTranslation("home");
  const navigate = useNavigate();
  const { library, updateLibrary } = useLibrary();

  const [isLoading, setIsLoading] = useState(false);
  const [downloadGame, setDownloadGame] = useState<ShopAssets | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const sliderRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const [isSliderActive, setIsSliderActive] = useState(true);

  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    scrollLeft: 0,
    hasDragged: false,
  });
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const wheelThrottleRef = useRef(0);
  const draggedItemKeyRef = useRef<string | null>(null);
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);

  const scrollToCard = useCallback((index: number) => {
    requestAnimationFrame(() => {
      const slider = sliderRef.current;
      if (!slider || !slider.children[index]) return;

      const targetCard = slider.children[index] as HTMLElement;
      const slot3Card =
        (slider.children[2] as HTMLElement) ||
        (slider.children[0] as HTMLElement);

      const slot3X = slot3Card ? slot3Card.offsetLeft : 0;
      const targetLeft = targetCard.offsetLeft - slot3X;

      slider.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: "smooth",
      });
    });
  }, []);

  const prevIndexRef = useRef(selectedIndex);

  useEffect(() => {
    if (prevIndexRef.current !== selectedIndex) {
      if (!isLoading) playBeep();
      prevIndexRef.current = selectedIndex;
      scrollToCard(selectedIndex);
    }
  }, [selectedIndex, isLoading, scrollToCard]);

  const dispatch = useAppDispatch();
  const { closeFolderTrigger } = useAppSelector((state) => state.window);

  const { groups, createGroup, removeGameFromGroup, deleteGroup, renameGroup } =
    useHomeGroups();
  const [openedGroup, setOpenedGroup] = useState<HomeGroup | null>(null);
  const [isSelectingGames, setIsSelectingGames] = useState(false);
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(
    new Set()
  );

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    position: { x: number; y: number };
    targetItem?: {
      type: "game" | "folder";
      id: string;
      groupId?: string;
    } | null;
  } | null>(null);

  const isMyGames = useAppSelector((state) => state.homeCatalogue.isMyGames);
  const isInstalledGames = useAppSelector(
    (state) => state.homeCatalogue.isInstalledGames
  );
  const currentCatalogueCategory = useAppSelector(
    (state) => state.homeCatalogue.currentCategory
  );
  const catalogue = useAppSelector((state) => state.homeCatalogue.catalogue);

  const getCatalogue = useCallback(
    async (category: CatalogueCategory, forceLoadingState = true) => {
      const hasCached = catalogue[category] && catalogue[category].length > 0;

      try {
        dispatch(setCurrentCategory(category));
        // Only show skeleton if we have no cached data yet
        if (forceLoadingState && !hasCached) setIsLoading(true);

        let result: ShopAssets[] = [];

        if (category === CatalogueCategory.Hot) {
          if (typeof window.electron?.getSteamFeatured === "function") {
            result = await window.electron.getSteamFeatured(
              getSteamLanguage(i18n.language)
            );
          }
        } else {
          const sources = (await levelDBService.values(
            "downloadSources"
          )) as DownloadSource[];
          const downloadSources = orderBy(sources, "createdAt", "desc");

          const params = {
            take: category === CatalogueCategory.Achievements ? 60 : 20,
            skip: 0,
            downloadSourceIds: downloadSources.map((source) => source.id),
          };

          result = await window.electron.hydraApi.get<ShopAssets[]>(
            `/catalogue/${category}`,
            { params, needsAuth: false }
          );
        }

        dispatch(setCatalogueCategory({ category, games: result }));
        if (!hasCached) setSelectedIndex(0);
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, catalogue]
  );

  const handleCategoryClick = (category: CatalogueCategory) => {
    if (category !== currentCatalogueCategory) {
      getCatalogue(category);
    }
  };

  const handleMyGamesClick = () => {
    setIsTransitioning(true);
    dispatch(setIsMyGames(true));
    dispatch(setIsInstalledGames(false));
    setOpenedGroup(null);
    setSelectedIndex(0);
    requestAnimationFrame(() => setIsTransitioning(false));
  };

  const handleInstalledGamesClick = () => {
    setIsTransitioning(true);
    dispatch(setIsMyGames(false));
    dispatch(setIsInstalledGames(true));
    setOpenedGroup(null);
    setSelectedIndex(0);
    requestAnimationFrame(() => setIsTransitioning(false));
  };

  const handleCatTabClick = (category: CatalogueCategory) => {
    dispatch(setIsMyGames(false));
    dispatch(setIsInstalledGames(false));
    setOpenedGroup(null);
    handleCategoryClick(category);
  };

  useEffect(() => {
    dispatch(setOpenedFolderName(openedGroup?.name ?? null));
  }, [openedGroup, dispatch]);

  useEffect(() => {
    if (closeFolderTrigger > 0) {
      setOpenedGroup(null);
      setSelectedIndex(0);
      setIsSelectingGames(false);
      setSelectedGameIds(new Set());
    }
  }, [closeFolderTrigger]);

  useEffect(() => {
    if (
      !catalogue[CatalogueCategory.Hot] ||
      catalogue[CatalogueCategory.Hot].length === 0
    ) {
      getCatalogue(CatalogueCategory.Hot, false).then(() => {
        // Prefetch other categories silently after Hot loads
        const others = Object.values(CatalogueCategory).filter(
          (c) => c !== CatalogueCategory.Hot
        );
        others.forEach((c) => {
          if (!catalogue[c] || catalogue[c].length === 0) {
            getCatalogue(c, false).catch(() => {});
          }
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isInstalledGames) return;

    let isMounted = true;

    const verifyInstalledGames = async () => {
      const installed = library.filter(
        (g) => g.executablePath && g.shop && g.objectId
      );
      let changed = false;

      for (const game of installed) {
        if (!isMounted) break;
        try {
          const exists = await window.electron.checkFileExists(
            game.executablePath!
          );
          if (!exists) {
            await window.electron.updateExecutablePath(
              game.shop!,
              game.objectId!,
              null
            );
            changed = true;
          }
        } catch (error) {
          // ignore
        }
      }

      if (changed && isMounted) {
        updateLibrary();
      }
    };

    verifyInstalledGames();

    return () => {
      isMounted = false;
    };
  }, [isInstalledGames, library, updateLibrary]);

  const categories = Object.values(CatalogueCategory);

  const libraryAsGames = useMemo<
    (ShopAssets & {
      executablePath?: string | null;
      lastTimePlayed?: string | null;
    })[]
  >(
    () =>
      library
        .filter(
          (
            g
          ): g is LibraryGame & {
            objectId: string;
            shop: NonNullable<LibraryGame["shop"]>;
          } => Boolean(g.objectId && g.shop)
        )
        .map((g) => ({
          objectId: g.objectId!,
          shop: g.shop!,
          title: g.title,
          iconUrl: g.iconUrl ?? null,
          libraryHeroImageUrl: g.libraryHeroImageUrl ?? null,
          libraryImageUrl: g.libraryImageUrl ?? null,
          logoImageUrl: g.logoImageUrl ?? null,
          logoPosition: null,
          coverImageUrl: g.coverImageUrl ?? null,
          downloadSources: g.downloadSources ?? [],
          executablePath: g.executablePath,
          lastTimePlayed: (g.lastTimePlayed as any) ?? null,
        })),
    [library]
  );

  const homeItems = useMemo(() => {
    if (!isMyGames && !isInstalledGames) {
      return catalogue[currentCatalogueCategory].map((g) => ({
        type: "game" as const,
        data: g,
        covers: [],
      }));
    }

    if (isInstalledGames) {
      const installedGames = libraryAsGames.filter((g) => g.executablePath);
      return installedGames
        .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
        .map((g) => ({ type: "game" as const, data: g, covers: [] }));
    }

    if (openedGroup) {
      const activeGroup = groups.find((g) => g.id === openedGroup.id);
      if (!activeGroup) return [];

      return libraryAsGames
        .filter((g) => activeGroup.gameIds.includes(g.objectId))
        .map((g) => ({ type: "game" as const, data: g, covers: [] }));
    }

    const FOLDERS = groups.map((g) => {
      const covers = g.gameIds
        .map((id) => {
          const game = libraryAsGames.find((lg) => lg.objectId === id);
          if (!game) return null;
          if (game.shop === "steam") {
            return `https://steamcdn-a.akamaihd.net/steam/apps/${game.objectId}/library_600x900_2x.jpg`;
          }
          return game.libraryImageUrl ?? null;
        })
        .filter(Boolean) as string[];
      // We will fill missing covers with null to render opaque boxes later if needed
      return { type: "folder" as const, data: g, covers: covers.slice(0, 4) };
    });

    const sourceGames = libraryAsGames;

    const unassignedGames = sourceGames
      .filter(
        (g) => !groups.some((group) => group.gameIds.includes(g.objectId))
      )
      .map((g) => ({ type: "game" as const, data: g, covers: [] }));

    const trendingGames = [...unassignedGames]
      .filter((g) => g.data.lastTimePlayed != null)
      .sort(
        (a, b) =>
          new Date(b.data.lastTimePlayed!).getTime() -
          new Date(a.data.lastTimePlayed!).getTime()
      )
      .slice(0, 6);

    const trendingIds = new Set(trendingGames.map((g) => g.data.objectId));

    const remainingGames = unassignedGames
      .filter((g) => !trendingIds.has(g.data.objectId))
      .sort((a, b) => (a.data.title || "").localeCompare(b.data.title || ""));

    const sortedFolders = [...FOLDERS].sort((a, b) =>
      (a.data.name || "").localeCompare(b.data.name || "")
    );

    const actionButtons: {
      type:
        | "game"
        | "folder"
        | "button_welcome"
        | "button_library"
        | "button_create_folder";
      data: any;
      covers: string[];
    }[] = [
      { type: "button_welcome", data: null as any, covers: [] },
      { type: "button_library", data: null as any, covers: [] },
      { type: "button_create_folder", data: null as any, covers: [] },
    ];

    return [
      ...actionButtons,
      ...trendingGames,
      ...sortedFolders,
      ...remainingGames,
    ];
  }, [
    isMyGames,
    isInstalledGames,
    libraryAsGames,
    groups,
    openedGroup,
    catalogue,
    currentCatalogueCategory,
  ]);

  const showSkeleton = isLoading || isTransitioning;

  const getItemKey = (item: (typeof homeItems)[number]): string => {
    if (item.type === "button_welcome") return "btn-welcome";
    if (item.type === "button_library") return "btn-lib";
    if (item.type === "button_create_folder") return "btn-folder";
    if (item.type === "folder") return (item.data as HomeGroup).id;
    return (item.data as ShopAssets).objectId;
  };

  const currentGames = useMemo(() => {
    if (!manualOrder) return homeItems;

    const byKey = new Map(
      homeItems.map((item) => [getItemKey(item), item] as const)
    );
    const used = new Set<string>();
    const ordered: typeof homeItems = [];

    for (const key of manualOrder) {
      const item = byKey.get(key);
      if (item) {
        ordered.push(item);
        used.add(key);
      }
    }

    for (const item of homeItems) {
      if (!used.has(getItemKey(item))) ordered.push(item);
    }

    return ordered;
  }, [homeItems, manualOrder]);

  // Decouple the details panel from the raw selectedIndex so it doesn't try
  // to mount/unmount (and animate) for every card while the user is rapidly
  // paging through the slider — it only settles once selection stops moving.
  const [settledIndex, setSettledIndex] = useState(selectedIndex);
  const [isPagingFast, setIsPagingFast] = useState(false);
  useLayoutEffect(() => {
    setIsPagingFast(true);
    const id = window.setTimeout(() => {
      setSettledIndex(selectedIndex);
      setIsPagingFast(false);
    }, 150);
    return () => window.clearTimeout(id);
  }, [selectedIndex]);

  const selectedItem = showSkeleton
    ? null
    : (currentGames[settledIndex] ?? null);
  const selectedGame =
    selectedItem?.type === "game" ? (selectedItem.data as ShopAssets) : null;
  const selectedFolder =
    selectedItem?.type === "folder" ? (selectedItem.data as HomeGroup) : null;
  const selectedIsWelcomeButton = selectedItem?.type === "button_welcome";
  const selectedIsLibraryButton = selectedItem?.type === "button_library";
  const selectedIsCreateFolderButton =
    selectedItem?.type === "button_create_folder";

  const backgroundSrc = useMemo(() => {
    if (!selectedGame) return undefined;
    if (selectedGame.libraryHeroImageUrl) {
      return selectedGame.libraryHeroImageUrl;
    }
    if (selectedGame.shop === "steam") {
      return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${selectedGame.objectId}/page_bg_generated_v6.jpg`;
    }
    return selectedGame.libraryImageUrl ?? undefined;
  }, [selectedGame]);

  const cardImageUrl = useMemo(() => {
    if (!selectedGame) return undefined;
    return selectedGame.shop === "steam"
      ? `https://steamcdn-a.akamaihd.net/steam/apps/${selectedGame.objectId}/library_600x900_2x.jpg`
      : (selectedGame.libraryImageUrl ?? undefined);
  }, [selectedGame]);

  const { color: glowColor } = useDominantColor(cardImageUrl);
  const { isLight: isBgLight } = useDominantColor(backgroundSrc);

  // Fallback images for the game-specific news cards (which have no image of
  // their own). Steam provides real store screenshots, which give far more
  // variety than reusing the game's own cover/icon/header art.
  const [steamScreenshotUrls, setSteamScreenshotUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedGame || selectedGame.shop !== "steam") {
      setSteamScreenshotUrls([]);
      return;
    }

    let cancelled = false;
    window.electron
      .getGameShopDetails(
        selectedGame.objectId,
        selectedGame.shop,
        getSteamLanguage(i18n.language)
      )
      .then((details) => {
        if (cancelled) return;
        const urls = (details?.screenshots ?? [])
          .map((screenshot) => screenshot.path_full)
          .filter(Boolean);
        setSteamScreenshotUrls(urls);
      })
      .catch(() => {
        if (!cancelled) setSteamScreenshotUrls([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedGame, i18n.language]);

  const gameImageVariants = useMemo(() => {
    if (!selectedGame) return [];

    if (steamScreenshotUrls.length > 0) return steamScreenshotUrls;

    const candidates = [
      cardImageUrl,
      selectedGame.libraryImageUrl,
      selectedGame.iconUrl,
      selectedGame.coverImageUrl,
    ];
    return Array.from(
      new Set(
        candidates.filter(
          (url): url is string => Boolean(url) && url !== backgroundSrc
        )
      )
    );
  }, [selectedGame, cardImageUrl, backgroundSrc, steamScreenshotUrls]);

  const isGamepadConnected = useGamepadConnected();
  const hasInstalledGames = useMemo(
    () => libraryAsGames.some((g) => Boolean(g.executablePath)),
    [libraryAsGames]
  );

  const allTabKeys = useMemo(
    () =>
      hasInstalledGames
        ? (["myGames", "installed", ...categories] as const)
        : (["myGames", ...categories] as const),
    [hasInstalledGames, categories]
  );

  const activeTabIndex = useMemo(() => {
    if (isMyGames) return 0;
    if (hasInstalledGames) {
      if (isInstalledGames) return 1;
      return 2 + categories.indexOf(currentCatalogueCategory);
    }
    return 1 + categories.indexOf(currentCatalogueCategory);
  }, [
    isMyGames,
    hasInstalledGames,
    isInstalledGames,
    categories,
    currentCatalogueCategory,
  ]);

  const handleTabChange = useCallback(
    (idx: number) => {
      if (idx === 0) {
        handleMyGamesClick();
      } else if (hasInstalledGames && idx === 1) {
        handleInstalledGamesClick();
      } else {
        const catIdx = hasInstalledGames ? idx - 2 : idx - 1;
        if (categories[catIdx]) {
          handleCatTabClick(categories[catIdx]);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      hasInstalledGames,
      categories,
      handleMyGamesClick,
      handleInstalledGamesClick,
      handleCatTabClick,
    ]
  );

  const handleSurpriseMeClick = useCallback(async () => {
    if (libraryAsGames.length > 0 && isMyGames) {
      const randomGame =
        libraryAsGames[Math.floor(Math.random() * libraryAsGames.length)];
      navigate(buildGameDetailsPath(randomGame as ShopAssets));
    } else {
      try {
        const randomGame = await window.electron.getRandomGame();
        if (randomGame) {
          navigate(
            buildGameDetailsPath(
              {
                shop: "steam",
                objectId: randomGame.objectId,
                title: randomGame.title,
              } as unknown as ShopAssets,
              { fromRandomizer: "1" }
            )
          );
        }
      } catch (err) {
        console.error("Failed to fetch random game", err);
      }
    }
  }, [libraryAsGames, isMyGames, navigate]);

  const handleGamepadConfirm = useCallback(() => {
    const item = homeItems[selectedIndex];
    if (!item) return;
    if (item.type === "folder") {
      setOpenedGroup(item.data as HomeGroup);
      setSelectedIndex(0);
    } else if (item.type === "button_library") {
      navigate("/library");
    } else if (item.type === "button_create_folder") {
      navigate("/library?collection=new");
    } else if (item.type === "game") {
      navigate(buildGameDetailsPath(item.data as ShopAssets));
    }
  }, [homeItems, selectedIndex, navigate]);

  const handleGamepadBack = useCallback(() => {
    if (openedGroup) {
      setOpenedGroup(null);
      setSelectedIndex(0);
    }
  }, [openedGroup]);

  useHomeGamepad({
    isLoading,
    isEnabled: isGamepadConnected,
    items: homeItems as Parameters<typeof useHomeGamepad>[0]["items"],
    selectedIndex,
    openedGroup,
    allTabs: allTabKeys as unknown as string[],
    activeTabIndex,
    setSelectedIndex,
    scrollToCard,
    onTabChange: handleTabChange,
    onConfirm: handleGamepadConfirm,
    onBack: handleGamepadBack,
    sliderRef,
    actionsRef,
  });

  const stepSelection = useCallback(
    (direction: 1 | -1) => {
      if (isLoading || currentGames.length === 0) return;
      setSelectedIndex((prev) => {
        const next =
          direction > 0
            ? Math.min(prev + 1, currentGames.length - 1)
            : Math.max(prev - 1, 0);
        scrollToCard(next);
        return next;
      });
    },
    [isLoading, currentGames.length, scrollToCard]
  );

  // Repeat cadence while a key is held, instead of relying on the OS's
  // native (much faster, unthrottled) key-repeat rate.
  const keyRepeatRef = useRef<{
    key?: string;
    timeoutId?: number;
    intervalId?: number;
  }>({});

  useEffect(() => {
    const clearRepeat = () => {
      if (keyRepeatRef.current.timeoutId) {
        window.clearTimeout(keyRepeatRef.current.timeoutId);
      }
      if (keyRepeatRef.current.intervalId) {
        window.clearInterval(keyRepeatRef.current.intervalId);
      }
      keyRepeatRef.current = {};
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      if (e.repeat || keyRepeatRef.current.key === e.key) return;

      const direction = e.key === "ArrowRight" ? 1 : -1;
      stepSelection(direction);

      keyRepeatRef.current.key = e.key;
      keyRepeatRef.current.timeoutId = window.setTimeout(() => {
        keyRepeatRef.current.intervalId = window.setInterval(() => {
          stepSelection(direction);
        }, 90);
      }, 220);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === keyRepeatRef.current.key) clearRepeat();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      clearRepeat();
    };
  }, [stepSelection]);

  useEffect(() => {
    if (!isLoading && currentGames.length > 0) {
      requestAnimationFrame(() => scrollToCard(0));
    }
  }, [isLoading, currentGames.length, scrollToCard]);

  const handleContextMenu = (
    e: React.MouseEvent,
    targetItem?: { type: "game" | "folder"; id: string; groupId?: string }
  ) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      position: { x: e.clientX, y: e.clientY },
      targetItem,
    });
  };

  const getContextMenuItems = (): ContextMenuItemData[] => {
    const items: ContextMenuItemData[] = [];

    if (isMyGames && !openedGroup) {
      items.push({
        id: "create-group",
        label: t("criar_grupo", { defaultValue: "Criar Grupo" }),
        onClick: () => {
          const name = window.prompt(
            t("nome_do_grupo", { defaultValue: "Nome do grupo:" })
          );
          if (name?.trim()) createGroup(name);
        },
      });
    }

    if (isMyGames && contextMenu?.targetItem?.type === "folder") {
      const targetId = contextMenu.targetItem.id;
      items.push({
        id: "delete-group",
        label: t("excluir_grupo", { defaultValue: "Excluir Grupo" }),
        danger: true,
        onClick: () => {
          setFolderToDelete(targetId);
        },
      });
    }

    if (isMyGames && openedGroup && contextMenu?.targetItem?.type === "game") {
      const targetId = contextMenu.targetItem.id;
      items.push({
        id: "remove-from-group",
        label: t("remover_do_grupo", { defaultValue: "Remover do Grupo" }),
        danger: true,
        onClick: () => removeGameFromGroup(openedGroup.id, targetId),
      });
    }

    return items;
  };

  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <section className="home">
        {selectedGame && <div className="home__solid-background" />}
        {backgroundSrc && (
          <img
            src={backgroundSrc}
            alt=""
            className="home__background"
            key={backgroundSrc}
          />
        )}
        <div className="home__overlay" />

        <div className="home__content">
          {!openedGroup && (
            <div className="home__tabs-row">
              <ul className="home__tabs" data-gamepad-ignore="true">
                {isGamepadConnected && (
                  <li className="home__tabs-hint">
                    <GamepadHint label="LT" position="left" />
                  </li>
                )}
                <li>
                  <Button
                    theme={
                      isMyGames ? (isBgLight ? "dark" : "primary") : "outline"
                    }
                    onClick={handleMyGamesClick}
                  >
                    {cleanTabLabel(
                      t("my_games", { defaultValue: "Meus Jogos" })
                    )}
                  </Button>
                </li>
                {hasInstalledGames && (
                  <li>
                    <Button
                      theme={
                        isInstalledGames
                          ? isBgLight
                            ? "dark"
                            : "primary"
                          : "outline"
                      }
                      onClick={handleInstalledGamesClick}
                    >
                      {cleanTabLabel(
                        t("installed", { defaultValue: "Instalados" })
                      )}
                    </Button>
                  </li>
                )}
                {categories.map((category) => (
                  <li key={category}>
                    <Button
                      theme={
                        !isMyGames &&
                        !isInstalledGames &&
                        category === currentCatalogueCategory
                          ? isBgLight
                            ? "dark"
                            : "primary"
                          : "outline"
                      }
                      onClick={() => handleCatTabClick(category)}
                    >
                      {cleanTabLabel(t(category))}
                    </Button>
                  </li>
                ))}
                {isGamepadConnected && (
                  <li className="home__tabs-hint">
                    <GamepadHint label="RT" position="right" />
                  </li>
                )}
              </ul>

              <Button
                theme={isBgLight ? "dark" : "outline"}
                className="home__surprise-me-button"
                onClick={handleSurpriseMeClick}
              >
                <GiftIcon size={16} />
                {t("surprise_me", { defaultValue: "Surpreenda-me" })}
              </Button>
            </div>
          )}

          {openedGroup && (
            <div className="home__folder-header">
              <div
                style={{ display: "flex", gap: "8px", alignItems: "center" }}
              >
                {isSelectingGames ? (
                  <>
                    <Button
                      theme={isBgLight ? "dark" : "primary"}
                      className="home__folder-header-action-btn"
                      onClick={() => {
                        setIsSelectingGames(false);
                        setSelectedGameIds(new Set());
                      }}
                      title={t("cancelar", { defaultValue: "Cancelar" })}
                    >
                      ✕
                    </Button>
                    {selectedGameIds.size > 0 && (
                      <Button
                        theme={isBgLight ? "dark" : "primary"}
                        className="home__folder-header-action-btn"
                        style={{
                          width: "auto",
                          padding: "0 12px",
                          borderRadius: "18px",
                          fontSize: "13px",
                        }}
                        onClick={async () => {
                          for (const id of selectedGameIds) {
                            await removeGameFromGroup(openedGroup.id, id);
                          }
                          setSelectedGameIds(new Set());
                          setIsSelectingGames(false);
                        }}
                        title={t("remover_selecionados", {
                          defaultValue: "Remover selecionados",
                        })}
                      >
                        <TrashIcon size={14} />
                        {selectedGameIds.size}
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button
                      theme={isBgLight ? "dark" : "primary"}
                      title={t("add_game", { defaultValue: "Adicionar Jogo" })}
                      className="home__folder-header-action-btn"
                      onClick={() => {
                        setSelectedIndex(currentGames.length);
                        navigate(
                          `/library?collection=${openedGroup.id}&action=edit`
                        );
                      }}
                    >
                      <PlusCircleIcon size={16} />
                    </Button>
                    <Button
                      theme={isBgLight ? "dark" : "primary"}
                      title={t("selecionar_para_remover", {
                        defaultValue: "Selecionar para remover",
                      })}
                      className="home__folder-header-action-btn"
                      onClick={() => setIsSelectingGames(true)}
                    >
                      <TrashIcon size={16} />
                    </Button>
                  </>
                )}
              </div>
              <input
                className="home__folder-header-title-input"
                value={openedGroup.name}
                onChange={(e) => {
                  const newName = e.target.value;
                  setOpenedGroup({ ...openedGroup, name: newName });
                  renameGroup(openedGroup.id, newName);
                }}
              />
            </div>
          )}

          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div
            className="home__slider"
            ref={sliderRef}
            onFocus={() => setIsSliderActive(true)}
            onContextMenu={(e) => handleContextMenu(e)}
            onWheel={(e) => {
              if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
              e.preventDefault();
              const now = performance.now();
              if (now - wheelThrottleRef.current < 90) return;
              wheelThrottleRef.current = now;
              stepSelection(e.deltaY > 0 ? 1 : -1);
            }}
            onMouseDown={(e) => {
              dragRef.current.isDragging = true;
              dragRef.current.startX = e.pageX - e.currentTarget.offsetLeft;
              dragRef.current.scrollLeft = e.currentTarget.scrollLeft;
              dragRef.current.hasDragged = false;
              e.currentTarget.style.scrollBehavior = "auto";
              e.currentTarget.style.cursor = "grabbing";
            }}
            onMouseLeave={(e) => {
              dragRef.current.isDragging = false;
              e.currentTarget.style.scrollBehavior = "";
              e.currentTarget.style.cursor = "";
            }}
            onMouseUp={(e) => {
              dragRef.current.isDragging = false;
              e.currentTarget.style.scrollBehavior = "";
              e.currentTarget.style.cursor = "";

              const draggedKey = draggedItemKeyRef.current;
              draggedItemKeyRef.current = null;

              if (dragRef.current.hasDragged && draggedKey) {
                const baseOrder =
                  manualOrder ?? currentGames.map((item) => getItemKey(item));
                const withoutDragged = baseOrder.filter(
                  (key) => key !== draggedKey
                );
                withoutDragged.splice(2, 0, draggedKey);
                setManualOrder(withoutDragged);
              }
            }}
            onMouseMove={(e) => {
              if (!dragRef.current.isDragging) return;
              e.preventDefault();
              const x = e.pageX - e.currentTarget.offsetLeft;
              const walk = x - dragRef.current.startX;
              if (Math.abs(walk) > 5) dragRef.current.hasDragged = true;
              e.currentTarget.scrollLeft = dragRef.current.scrollLeft - walk;
            }}
          >
            {showSkeleton
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="home__card">
                    <Skeleton className="home__card-skeleton" />
                  </div>
                ))
              : currentGames.map((item, index) => {
                  if (item.type === "button_welcome") {
                    return (
                      <button
                        key="btn-welcome"
                        type="button"
                        className={cn("home__card home__action-btn", {
                          "home__card--selected": index === selectedIndex,
                        })}
                        onFocus={() => {
                          setSelectedIndex(index);
                        }}
                        onClick={() => {
                          if (dragRef.current.hasDragged) return;
                          setSelectedIndex(index);
                        }}
                        aria-label={t("bem_vindo", {
                          defaultValue: "Bem-vindo",
                        })}
                      >
                        <HydraLogoSvg
                          width={64}
                          height={64}
                          className="home__action-btn-icon"
                        />
                      </button>
                    );
                  }
                  if (item.type === "button_library") {
                    return (
                      <button
                        key="btn-lib"
                        type="button"
                        className={cn("home__card home__action-btn", {
                          "home__card--selected": index === selectedIndex,
                        })}
                        onFocus={() => {
                          setSelectedIndex(index);
                        }}
                        onClick={() => {
                          if (dragRef.current.hasDragged) return;
                          setSelectedIndex(index);
                          navigate("/library");
                        }}
                        aria-label={t("acessar_biblioteca", {
                          defaultValue: "Acessar Biblioteca",
                        })}
                      >
                        <BibliotecaSvg
                          width={64}
                          height={64}
                          className="home__action-btn-icon"
                        />
                      </button>
                    );
                  }
                  if (item.type === "button_create_folder") {
                    return (
                      <button
                        key="btn-folder"
                        type="button"
                        className={cn("home__card home__action-btn", {
                          "home__card--selected": index === selectedIndex,
                        })}
                        onFocus={() => {
                          setSelectedIndex(index);
                        }}
                        onClick={() => {
                          if (dragRef.current.hasDragged) return;
                          setSelectedIndex(index);
                          navigate("/library?collection=new");
                        }}
                        aria-label={t("criar_pasta", {
                          defaultValue: "Criar pasta",
                        })}
                      >
                        <AddFolderSvg
                          width={64}
                          height={64}
                          className="home__action-btn-icon"
                        />
                      </button>
                    );
                  }

                  const isFolder = item.type === "folder";
                  const game = !isFolder ? (item.data as ShopAssets) : null;
                  const folder = isFolder ? (item.data as HomeGroup) : null;
                  const itemId = isFolder ? folder!.id : game!.objectId;

                  return (
                    <button
                      key={itemId}
                      type="button"
                      onContextMenu={(e) => {
                        e.stopPropagation();
                        handleContextMenu(e, {
                          type: isFolder ? "folder" : "game",
                          id: itemId,
                        });
                      }}
                      className={cn("home__card", {
                        "home__card--selected": index === selectedIndex,
                        "home__card--gamepad-focus":
                          isGamepadConnected &&
                          index === selectedIndex &&
                          isSliderActive,
                        "home__folder-card": isFolder,
                        "home__card--selecting":
                          isSelectingGames &&
                          !isFolder &&
                          selectedGameIds.has(itemId),
                      })}
                      onFocus={() => {
                        setSelectedIndex(index);
                      }}
                      onMouseDown={() => {
                        draggedItemKeyRef.current = itemId;
                      }}
                      onClick={() => {
                        if (dragRef.current.hasDragged) return;
                        if (isSelectingGames && !isFolder) {
                          setSelectedGameIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(itemId)) next.delete(itemId);
                            else next.add(itemId);
                            return next;
                          });
                          return;
                        }
                        setSelectedIndex(index);
                      }}
                      onDoubleClick={() => {
                        if (isSelectingGames) return;
                        if (isFolder) {
                          setOpenedGroup(folder);
                          setSelectedIndex(0);
                        } else {
                          navigate(buildGameDetailsPath(game!));
                        }
                      }}
                      style={
                        index === selectedIndex && !isFolder
                          ? { boxShadow: `inset 0 0 0 2px ${glowColor}` }
                          : undefined
                      }
                    >
                      {isSelectingGames && !isFolder && (
                        <div
                          className={cn("home__card-select-badge", {
                            "home__card-select-badge--checked":
                              selectedGameIds.has(itemId),
                          })}
                        />
                      )}
                      {isFolder ? (
                        <div className="home__folder-grid">
                          {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="home__folder-thumb-wrapper">
                              {item.covers[i] ? (
                                <img
                                  src={item.covers[i]}
                                  alt=""
                                  className="home__folder-thumb"
                                  draggable={false}
                                />
                              ) : (
                                <div className="home__folder-thumb-empty" />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <HomeGameImage game={game!} />
                      )}
                    </button>
                  );
                })}
            <div
              className="home__slider-spacer"
              style={{
                width: "calc(100vw - 3 * (120px + 24px))",
                flexShrink: 0,
                pointerEvents: "none",
              }}
            />
          </div>

          <div
            className={cn("home__bottom-segment", {
              "home__bottom-segment--hidden": isPagingFast,
            })}
            ref={actionsRef}
            onFocus={() => setIsSliderActive(false)}
          >
            {selectedGame && (
              <GameInfo
                game={selectedGame}
                isBgLight={isBgLight}
                onInstallClick={(g) => setDownloadGame(g)}
                onAddToLibrary={
                  !isMyGames
                    ? (g) => {
                        window.electron
                          .addGameToLibrary(g.shop, g.objectId, g.title)
                          .then(() => {});
                      }
                    : undefined
                }
                isInLibrary={
                  !isMyGames &&
                  libraryAsGames.some(
                    (g) => g.objectId === selectedGame.objectId
                  )
                }
                onLocateExecutable={async (g) => {
                  const downloadsPath =
                    await window.electron.getDefaultDownloadsPath();
                  const { filePaths } = await window.electron.showOpenDialog({
                    properties: ["openFile"],
                    defaultPath: downloadsPath,
                    filters: [
                      { name: "Game executable", extensions: ["exe", "lnk"] },
                    ],
                  });
                  if (filePaths?.[0]) {
                    await window.electron.updateExecutablePath(
                      g.shop,
                      g.objectId,
                      filePaths[0]
                    );
                  }
                }}
              />
            )}
            {selectedFolder && (
              <FolderInfo
                folder={selectedFolder}
                libraryAsGames={libraryAsGames}
                onOpenFolder={() => {
                  setOpenedGroup(selectedFolder);
                  setSelectedIndex(0);
                }}
                isBgLight={isBgLight}
              />
            )}

            {selectedIsWelcomeButton && (
              <ActionInfo
                kind="welcome"
                onAction={() => navigate("/library")}
              />
            )}

            {selectedIsLibraryButton && (
              <ActionInfo
                kind="library"
                libraryGamesCount={libraryAsGames.length}
                onAction={() => navigate("/library")}
              />
            )}

            {selectedIsCreateFolderButton && (
              <ActionInfo
                kind="create-folder"
                onAction={() => navigate("/library?collection=new")}
              />
            )}

            {!selectedGame &&
              !selectedFolder &&
              !selectedIsWelcomeButton &&
              !selectedIsLibraryButton &&
              !selectedIsCreateFolderButton && <div />}
          </div>

          {selectedIsWelcomeButton ? (
            <div className="home__hero-row">
              <WelcomeDashboard />
            </div>
          ) : (
            catalogue[CatalogueCategory.Hot]?.length > 0 && (
              <div className="home__hero-row">
                <NewsSection
                  gameTitle={selectedGame?.title}
                  gameImageUrls={gameImageVariants}
                />
                <div className="home__carousel-wrapper">
                  <HeroCarousel games={catalogue[CatalogueCategory.Hot]} />
                </div>
              </div>
            )
          )}
        </div>

        {contextMenu && (
          <ContextMenu
            items={getContextMenuItems()}
            visible={contextMenu.visible && getContextMenuItems().length > 0}
            position={contextMenu.position}
            onClose={() => setContextMenu(null)}
          />
        )}
      </section>

      {folderToDelete && (
        <ConfirmationModal
          visible={!!folderToDelete}
          title={t("excluir_pasta", { defaultValue: "Excluir pasta" })}
          descriptionText={t("confirmar_exclusao_pasta", {
            defaultValue: "Tem certeza de que deseja excluir esta pasta?",
          })}
          confirmButtonLabel={t("excluir", { defaultValue: "Excluir" })}
          cancelButtonLabel={t("cancelar", { defaultValue: "Cancelar" })}
          onConfirm={() => {
            deleteGroup(folderToDelete);
            if (openedGroup?.id === folderToDelete) {
              setOpenedGroup(null);
            }
            setFolderToDelete(null);
          }}
          onClose={() => setFolderToDelete(null)}
        />
      )}

      {downloadGame && (
        <DownloadGameModal
          visible={!!downloadGame}
          game={downloadGame as any}
          onClose={() => setDownloadGame(null)}
        />
      )}
    </SkeletonTheme>
  );
}
