import {
  BookOpenIcon,
  ClockCountdownIcon,
  DownloadSimpleIcon,
  GearIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  PuzzlePieceIcon,
  SignOutIcon,
  SquaresFourIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { AuthPage } from "@shared";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Divider,
  FocusItem,
  Input,
  RouteAnchor,
  ScrollArea,
  UserProfile,
  VerticalFocusGroup,
} from "../../components";
import { IS_DESKTOP } from "../../constants";
import {
  useLibrary,
  useNavigationActions,
  useSearch,
  useUserDetails,
} from "../../hooks";
import { getItemFocusTarget } from "../../helpers";
import {
  initializeBigPictureDownloadsStore,
  useBigPictureDownloadsStore,
} from "../../stores/downloads.store";
import type { DownloadProgress, LibraryGame } from "@types";
import type { FocusOverrides } from "../../services";
import {
  BIG_PICTURE_SIDEBAR_EXIT_ID,
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
  BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_ALL_ID,
  BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_FAVORITES_ID,
  BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_READY_TO_PLAY_ID,
  BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_RECENTLY_PLAYED_ID,
  BIG_PICTURE_SIDEBAR_LIBRARY_LIST_REGION_ID,
  BIG_PICTURE_SIDEBAR_LIBRARY_SEARCH_ID,
  BIG_PICTURE_SIDEBAR_NOTIFICATIONS_ID,
  BIG_PICTURE_SIDEBAR_PROFILE_ID,
  BIG_PICTURE_SIDEBAR_REGION_ID,
  BIG_PICTURE_CONTENT_REGION_ID,
  type BigPictureSidebarRouteKey,
  getBigPictureContentEntryRegionIdFromPathname,
  getBigPictureContentSidebarReturnTargetFromPathname,
  getBigPictureGameRouteMatch,
  getBigPictureSidebarLibraryGameFocusId,
  getBigPictureSidebarItemIdFromPathname,
  normalizeBigPicturePathname,
} from "../navigation";
import { SidebarNotificationsDropdown } from "./notifications-dropdown";
import "./styles.scss";

type SidebarLibraryFilter =
  | "all"
  | "ready_to_play"
  | "recently_played"
  | "favorites";

const SIDEBAR_LIBRARY_FILTERS = [
  {
    value: "all",
    label: "Library",
    focusId: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_ALL_ID,
  },
  {
    value: "ready_to_play",
    label: "Ready to Play",
    focusId: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_READY_TO_PLAY_ID,
  },
  {
    value: "recently_played",
    label: "Recent",
    focusId: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_RECENTLY_PLAYED_ID,
  },
  {
    value: "favorites",
    label: "Favorites",
    focusId: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_FAVORITES_ID,
  },
] satisfies Array<{
  value: SidebarLibraryFilter;
  label: string;
  focusId: string;
}>;

const SIDEBAR_LIBRARY_FILTER_FOCUS_IDS: Record<SidebarLibraryFilter, string> = {
  all: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_ALL_ID,
  ready_to_play: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_READY_TO_PLAY_ID,
  recently_played: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_RECENTLY_PLAYED_ID,
  favorites: BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_FAVORITES_ID,
};

function compareGamesByTitle(a: LibraryGame, b: LibraryGame) {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

function getDateTimestamp(date: Date | string | null | undefined) {
  if (!date) return null;

  const timestamp = new Date(date).getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
}

function getLastPlayedTimestamp(game: LibraryGame) {
  return getDateTimestamp(game.lastTimePlayed);
}

function getExecutablePathUpdatedTimestamp(game: LibraryGame) {
  return getDateTimestamp(game.executablePathUpdatedAt);
}

function compareGamesByLastPlayed(a: LibraryGame, b: LibraryGame) {
  const aLastPlayed = getLastPlayedTimestamp(a);
  const bLastPlayed = getLastPlayedTimestamp(b);

  if (aLastPlayed !== null && bLastPlayed !== null) {
    const lastPlayedDifference = bLastPlayed - aLastPlayed;
    if (lastPlayedDifference !== 0) return lastPlayedDifference;
  }

  if (aLastPlayed !== null) return -1;
  if (bLastPlayed !== null) return 1;

  return compareGamesByTitle(a, b);
}

function compareGamesByExecutablePathUpdatedAt(a: LibraryGame, b: LibraryGame) {
  const aUpdatedAt = getExecutablePathUpdatedTimestamp(a);
  const bUpdatedAt = getExecutablePathUpdatedTimestamp(b);

  if (aUpdatedAt !== null && bUpdatedAt !== null) {
    const updatedAtDifference = bUpdatedAt - aUpdatedAt;
    if (updatedAtDifference !== 0) return updatedAtDifference;
  }

  if (aUpdatedAt !== null) return -1;
  if (bUpdatedAt !== null) return 1;

  return compareGamesByTitle(a, b);
}

function compareGamesByPlaytime(a: LibraryGame, b: LibraryGame) {
  const playtimeDifference =
    (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0);

  if (playtimeDifference !== 0) return playtimeDifference;

  return compareGamesByTitle(a, b);
}

function formatSidebarProgress(progress?: number | null) {
  if (!progress || !Number.isFinite(progress)) return "0%";

  const percentage = Math.round(Math.min(Math.max(progress, 0), 1) * 100);

  return `${percentage}%`;
}

function getSidebarGameStatus(
  game: LibraryGame,
  runningGameIds: Set<string>,
  lastDownloadPacket: DownloadProgress | null,
  extractionProgressByGameId: Record<string, number>
) {
  if (runningGameIds.has(game.id)) {
    return "Playing now";
  }

  const download = game.download;
  if (!download) return null;

  if (download.extracting || download.status === "extracting") {
    const progress =
      extractionProgressByGameId[game.id] ?? download.extractionProgress;

    return `Extracting - ${formatSidebarProgress(progress)}`;
  }

  if (download.status === "active") {
    const progress =
      lastDownloadPacket?.gameId === game.id
        ? lastDownloadPacket.progress
        : download.progress;

    return `Downloading - ${formatSidebarProgress(progress)}`;
  }

  if (download.status === "seeding") {
    return "Seeding";
  }

  if (download.queued) {
    return "Download Queued";
  }

  if (download.status === "paused") {
    return "Download Paused";
  }

  return null;
}

function getSidebarLibraryFilterIcon(filter: SidebarLibraryFilter) {
  if (filter === "all") {
    return <BookOpenIcon size={24} />;
  }

  if (filter === "ready_to_play") {
    return <PlayIcon size={24} />;
  }

  if (filter === "favorites") {
    return <StarIcon size={24} />;
  }

  return <ClockCountdownIcon size={24} />;
}

function filterSidebarLibraryGames(
  library: LibraryGame[],
  selectedFilter: SidebarLibraryFilter
) {
  if (selectedFilter === "all") {
    return [...library].sort(compareGamesByTitle);
  }

  if (selectedFilter === "ready_to_play") {
    return library
      .filter((game) => Boolean(game.executablePath))
      .sort(compareGamesByExecutablePathUpdatedAt);
  }

  if (selectedFilter === "favorites") {
    return library.filter((game) => game.favorite).sort(compareGamesByPlaytime);
  }

  return library
    .filter((game) => getLastPlayedTimestamp(game) !== null)
    .sort(compareGamesByLastPlayed);
}

function SidebarRouter() {
  const basePath = IS_DESKTOP ? "/big-picture" : "";
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeSidebarItemId = getBigPictureSidebarItemIdFromPathname(pathname);
  const contentEntryTarget =
    getBigPictureContentSidebarReturnTargetFromPathname(pathname);
  const sidebarItemNavigationOverrides: FocusOverrides = {
    left: {
      type: "block",
    },
    right: contentEntryTarget,
  };
  const getRouteNavigationOverrides = (itemId: string): FocusOverrides =>
    itemId === BIG_PICTURE_SIDEBAR_ITEM_IDS.home
      ? {
          ...sidebarItemNavigationOverrides,
          up: getItemFocusTarget(BIG_PICTURE_SIDEBAR_PROFILE_ID),
        }
      : sidebarItemNavigationOverrides;
  const handleExitBigPicture = () => {
    if (IS_DESKTOP) {
      globalThis.close();
      return;
    }

    navigate("/");
  };

  const routes = (
    [
      {
        key: "home",
        label: "Home",
        path: basePath,
        icon: HouseIcon,
      },
      {
        key: "catalogue",
        label: "Catalogue",
        path: `${basePath}/catalogue`,
        icon: SquaresFourIcon,
      },
      {
        key: "library",
        label: "Library",
        path: `${basePath}/library`,
        icon: BookOpenIcon,
      },
      {
        key: "downloads",
        label: "Download",
        path: `${basePath}/downloads`,
        icon: DownloadSimpleIcon,
      },
      {
        key: "settings",
        label: "Settings",
        path: `${basePath}/settings`,
        icon: GearIcon,
      },
      {
        key: "componentLab",
        label: "Component Lab",
        path: `${basePath}/component-lab`,
        icon: PuzzlePieceIcon,
      },
    ] satisfies Array<{
      key: BigPictureSidebarRouteKey;
      label: string;
      path: string;
      icon: typeof HouseIcon;
    }>
  ).filter((route) => {
    if (import.meta.env.DEV) return true;
    return route.key !== "componentLab";
  });

  return (
    <div className="sidebar-router-container">
      {routes.map((route) => {
        const itemId = BIG_PICTURE_SIDEBAR_ITEM_IDS[route.key];

        return (
          <RouteAnchor
            key={route.label}
            label={route.label}
            href={route.path}
            icon={<route.icon size={24} />}
            active={activeSidebarItemId === itemId}
            focusId={itemId}
            focusNavigationOverrides={getRouteNavigationOverrides(itemId)}
          />
        );
      })}

      <div className="state-wrapper">
        <FocusItem
          id={BIG_PICTURE_SIDEBAR_EXIT_ID}
          navigationOverrides={sidebarItemNavigationOverrides}
          asChild
        >
          <button
            type="button"
            className="route-anchor route-anchor--extra-padding sidebar-action-button"
            onClick={handleExitBigPicture}
          >
            <div className="route-anchor__icon route-anchor__icon--small-size">
              <SignOutIcon size={24} />
            </div>
            <div className="route-anchor__label">Exit Big Picture</div>
          </button>
        </FocusItem>
      </div>
    </div>
  );
}

function SidebarLibrary() {
  const { library } = useLibrary();
  const { pathname } = useLocation();
  const lastDownloadPacket = useBigPictureDownloadsStore(
    (state) => state.lastPacket
  );
  const extractionProgressByGameId = useBigPictureDownloadsStore(
    (state) => state.extractionProgressByGameId
  );
  const [runningGameIds, setRunningGameIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedLibraryFilter, setSelectedLibraryFilter] =
    useState<SidebarLibraryFilter>("all");
  const normalizedPathname = normalizeBigPicturePathname(pathname);
  const activeGameRoute = getBigPictureGameRouteMatch(normalizedPathname);
  const contentEntryTarget =
    getBigPictureContentSidebarReturnTargetFromPathname(pathname);

  useEffect(() => {
    setSelectedLibraryFilter("all");
  }, []);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    initializeBigPictureDownloadsStore();

    const unsubscribe = globalThis.window.electron.onGamesRunning(
      (gamesRunning) => {
        setRunningGameIds(new Set(gamesRunning.map((game) => game.id)));
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const sidebarLibrary = useMemo(() => {
    return filterSidebarLibraryGames(library, selectedLibraryFilter);
  }, [library, selectedLibraryFilter]);

  const { filteredItems, search, setSearch } = useSearch(sidebarLibrary, [
    "title",
  ]);
  const emptyLibraryMessage =
    library.length === 0
      ? "No games in library"
      : search.trim()
        ? "No games found"
        : "No games here";

  const selectedFilterFocusId =
    SIDEBAR_LIBRARY_FILTER_FOCUS_IDS[selectedLibraryFilter];

  const firstFilteredGameFocusId = filteredItems[0]
    ? getBigPictureSidebarLibraryGameFocusId({
        shop: filteredItems[0].shop,
        objectId: filteredItems[0].objectId,
      })
    : null;

  const searchNavigationOverrides: FocusOverrides = {
    left: {
      type: "block",
    },
    right: contentEntryTarget,
    up: getItemFocusTarget(BIG_PICTURE_SIDEBAR_EXIT_ID),
    down: getItemFocusTarget(selectedFilterFocusId),
  };

  const filterDownTarget = firstFilteredGameFocusId
    ? getItemFocusTarget(firstFilteredGameFocusId)
    : {
        type: "block" as const,
      };

  const getFilterNavigationOverrides = (
    index: number,
    focusId: string
  ): FocusOverrides => {
    const previousFilter = SIDEBAR_LIBRARY_FILTERS[index - 1];
    const nextFilter = SIDEBAR_LIBRARY_FILTERS[index + 1];

    return {
      left: previousFilter
        ? getItemFocusTarget(previousFilter.focusId)
        : {
            type: "block",
          },
      right: nextFilter
        ? getItemFocusTarget(nextFilter.focusId)
        : contentEntryTarget,
      up: getItemFocusTarget(BIG_PICTURE_SIDEBAR_LIBRARY_SEARCH_ID),
      down:
        focusId === selectedFilterFocusId
          ? filterDownTarget
          : getItemFocusTarget(selectedFilterFocusId),
    };
  };

  const getGameNavigationOverrides = (index: number): FocusOverrides => ({
    right: contentEntryTarget,
    ...(index === 0 && {
      up: getItemFocusTarget(selectedFilterFocusId),
    }),
    ...(index === filteredItems.length - 1 && {
      down: {
        type: "block" as const,
      },
    }),
  });

  return (
    <div className="library-container">
      <div className="library-container__header">
        <Input
          focusId={BIG_PICTURE_SIDEBAR_LIBRARY_SEARCH_ID}
          focusNavigationOverrides={searchNavigationOverrides}
          placeholder="Search"
          iconLeft={<MagnifyingGlassIcon size={24} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          data-sidebar-library-search="true"
        />
      </div>

      <div
        className="library-container__filters"
        role="group"
        aria-label="Library filters"
      >
        {SIDEBAR_LIBRARY_FILTERS.map((filter, index) => (
          <FocusItem
            key={filter.value}
            id={filter.focusId}
            navigationOverrides={getFilterNavigationOverrides(
              index,
              filter.focusId
            )}
            asChild
          >
            <button
              type="button"
              className={`sidebar-library-filter ${
                selectedLibraryFilter === filter.value
                  ? "sidebar-library-filter--active"
                  : ""
              }`}
              aria-label={filter.label}
              aria-pressed={selectedLibraryFilter === filter.value}
              onClick={() => setSelectedLibraryFilter(filter.value)}
            >
              <span className="sidebar-library-filter__icon" aria-hidden="true">
                {getSidebarLibraryFilterIcon(filter.value)}
              </span>
              <span className="sidebar-library-filter__label">
                {filter.label}
              </span>
            </button>
          </FocusItem>
        ))}
      </div>

      <div className="library-container__list-focus-region">
        <VerticalFocusGroup
          regionId={BIG_PICTURE_SIDEBAR_LIBRARY_LIST_REGION_ID}
        >
          <ScrollArea>
            {filteredItems.length === 0 ? (
              <div className="library-container__empty">
                {emptyLibraryMessage}
              </div>
            ) : (
              <ul className="library-list">
                {filteredItems.map((game, index) => {
                  const desktopPath = `/big-picture/game/${game.shop}/${game.objectId}`;
                  const focusId = getBigPictureSidebarLibraryGameFocusId({
                    shop: game.shop,
                    objectId: game.objectId,
                  });
                  const active =
                    normalizedPathname === desktopPath ||
                    (activeGameRoute?.shop === game.shop &&
                      activeGameRoute.objectId === game.objectId);
                  const status = getSidebarGameStatus(
                    game,
                    runningGameIds,
                    lastDownloadPacket,
                    extractionProgressByGameId
                  );

                  return (
                    <li key={game.id} className="library-list__item">
                      <RouteAnchor
                        key={game.id}
                        label={game.title}
                        subtitle={status}
                        href={desktopPath}
                        icon={game.iconUrl}
                        isFavorite={game.favorite}
                        active={active}
                        focusId={focusId}
                        focusNavigationOrder={index}
                        focusNavigationOverrides={getGameNavigationOverrides(
                          index
                        )}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </VerticalFocusGroup>
      </div>
    </div>
  );
}

interface SidebarProfileProps {
  notificationsOpen: boolean;
  onNotificationsOpenChange: (isOpen: boolean) => void;
  onNotificationsRestoringFocusChange: (isRestoring: boolean) => void;
}

function SidebarProfile({
  notificationsOpen,
  onNotificationsOpenChange,
  onNotificationsRestoringFocusChange,
}: Readonly<SidebarProfileProps>) {
  const navigate = useNavigate();
  const { userDetails } = useUserDetails();
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const [notificationCount, setNotificationCount] = useState(0);

  const toggleNotifications = useCallback(() => {
    onNotificationsOpenChange(!notificationsOpen);
  }, [notificationsOpen, onNotificationsOpenChange]);

  const closeNotifications = useCallback(() => {
    onNotificationsOpenChange(false);
  }, [onNotificationsOpenChange]);
  const handleProfileClick = useCallback(() => {
    if (!userDetails?.id) {
      void globalThis.window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    const basePath = IS_DESKTOP ? "/big-picture" : "";
    navigate(`${basePath}/profile/${userDetails.id}`);
  }, [navigate, userDetails?.id]);

  const profileFocusNavigationOverrides: FocusOverrides = {
    up: {
      type: "block",
    },
    right: getItemFocusTarget(BIG_PICTURE_SIDEBAR_NOTIFICATIONS_ID),
    down: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home),
  };
  const notificationsFocusNavigationOverrides: FocusOverrides = {
    up: {
      type: "block",
    },
    left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_PROFILE_ID),
    down: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home),
  };

  return (
    <>
      <div className="sidebar-profile">
        <UserProfile
          image={userDetails?.profileImageUrl}
          name={userDetails?.displayName ?? "Sign in"}
          friendCode={userDetails?.id ?? "Not signed in"}
          profileFocusId={BIG_PICTURE_SIDEBAR_PROFILE_ID}
          notificationsFocusId={BIG_PICTURE_SIDEBAR_NOTIFICATIONS_ID}
          profileFocusNavigationOverrides={profileFocusNavigationOverrides}
          notificationsFocusNavigationOverrides={
            notificationsFocusNavigationOverrides
          }
          notificationCount={notificationCount}
          notificationsButtonRef={notificationsButtonRef}
          onProfileClick={handleProfileClick}
          onNotificationsClick={toggleNotifications}
        />
      </div>

      <SidebarNotificationsDropdown
        anchorRef={notificationsButtonRef}
        visible={notificationsOpen}
        onClose={closeNotifications}
        onRestoringFocusChange={onNotificationsRestoringFocusChange}
        onUnreadCountChange={setNotificationCount}
        restoreFocusId={BIG_PICTURE_SIDEBAR_NOTIFICATIONS_ID}
      />
    </>
  );
}

const SidebarContainer = forwardRef<
  HTMLDivElement,
  Readonly<{ children: React.ReactNode; forcedOpen?: boolean }>
>(function SidebarContainer({ children, forcedOpen = false }, ref) {
  const handleMouseLeave = () => {
    const activeElement = document.activeElement;

    if (!(activeElement instanceof HTMLElement)) return;
    if (activeElement.dataset.sidebarLibrarySearch === "true") return;

    activeElement.blur();
  };

  return (
    <div
      ref={ref}
      role="presentation"
      className={`sidebar-container${forcedOpen ? " sidebar-container--open" : ""}`}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  );
});

function Sidebar() {
  const { pathname } = useLocation();
  const { setFocusRegion } = useNavigationActions();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [restoringNotificationsFocus, setRestoringNotificationsFocus] =
    useState(false);

  const handleOverlayPointerDown = () => {
    const activeElement = document.activeElement;

    if (
      activeElement instanceof HTMLElement &&
      activeElement.closest(".sidebar-container")
    ) {
      activeElement.blur();
    }

    setNotificationsOpen(false);

    const contentRegionId =
      getBigPictureContentEntryRegionIdFromPathname(pathname) ??
      BIG_PICTURE_CONTENT_REGION_ID;

    setFocusRegion(contentRegionId, "right", {
      preferRememberedFocus: true,
    });
  };

  return (
    <>
      <VerticalFocusGroup regionId={BIG_PICTURE_SIDEBAR_REGION_ID} asChild>
        <SidebarContainer
          forcedOpen={notificationsOpen || restoringNotificationsFocus}
        >
          <SidebarProfile
            notificationsOpen={notificationsOpen}
            onNotificationsOpenChange={setNotificationsOpen}
            onNotificationsRestoringFocusChange={setRestoringNotificationsFocus}
          />
          <Divider />
          <SidebarRouter />
          <Divider />
          <SidebarLibrary />
        </SidebarContainer>
      </VerticalFocusGroup>
      <div className="sidebar-spacer" />
      <div
        className="sidebar-drawer-overlay"
        onPointerDown={handleOverlayPointerDown}
      />
    </>
  );
}

export { Sidebar };
