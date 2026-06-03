import {
  BookOpenIcon,
  DownloadSimpleIcon,
  GearIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  PuzzlePieceIcon,
  SignOutIcon,
  SquaresFourIcon,
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
import { useLibrary, useSearch } from "../../hooks";
import { getItemFocusTarget } from "../../helpers";
import type { UserDetails } from "@types";
import type { FocusOverrides } from "../../services";
import {
  BIG_PICTURE_SIDEBAR_EXIT_ID,
  BIG_PICTURE_SIDEBAR_FRIENDS_ID,
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
  BIG_PICTURE_SIDEBAR_NOTIFICATIONS_ID,
  BIG_PICTURE_SIDEBAR_PROFILE_ID,
  BIG_PICTURE_SIDEBAR_REGION_ID,
  type BigPictureSidebarRouteKey,
  getBigPictureContentSidebarReturnTargetFromPathname,
  getBigPictureGameRouteMatch,
  getBigPictureSidebarLibraryGameFocusId,
  getBigPictureSidebarItemIdFromPathname,
  normalizeBigPicturePathname,
} from "../navigation";
import { SidebarNotificationsDropdown } from "./notifications-dropdown";
import "./styles.scss";

const DEFAULT_PROFILE_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='8' fill='%2320242d'/%3E%3Ccircle cx='24' cy='18' r='8' fill='%23838383'/%3E%3Cpath d='M10 42c2.4-8.2 7.5-12 14-12s11.6 3.8 14 12' fill='%23838383'/%3E%3C/svg%3E";

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
          up: getItemFocusTarget(BIG_PICTURE_SIDEBAR_FRIENDS_ID),
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
  const normalizedPathname = normalizeBigPicturePathname(pathname);
  const activeGameRoute = getBigPictureGameRouteMatch(normalizedPathname);
  const contentEntryTarget =
    getBigPictureContentSidebarReturnTargetFromPathname(pathname);

  const sortedLibrary = useMemo(() => {
    return [...library].sort(
      (a, b) =>
        (b.playTimeInMilliseconds ?? 0) - (a.playTimeInMilliseconds ?? 0)
    );
  }, [library]);

  const { filteredItems, search, setSearch } = useSearch(sortedLibrary, [
    "title",
  ]);

  return (
    <div className="library-container">
      <div className="library-container__header">
        <Input
          placeholder="Search"
          iconLeft={<MagnifyingGlassIcon size={24} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />

        {/* <Button variant="rounded" size="icon">
            <FunnelSimpleIcon
              size={24}
              className="library-container__header__icon"
            />
          </Button> */}
      </div>

      <div className="library-container__list-focus-region">
        <VerticalFocusGroup regionId="sidebar-library-list">
          <ScrollArea>
            <ul className="library-list">
              {filteredItems.map((game) => {
                const desktopPath = `/big-picture/game/${game.shop}/${game.objectId}`;
                const focusId = getBigPictureSidebarLibraryGameFocusId({
                  shop: game.shop,
                  objectId: game.objectId,
                });
                const active =
                  normalizedPathname === desktopPath ||
                  (activeGameRoute?.shop === game.shop &&
                    activeGameRoute.objectId === game.objectId);

                return (
                  <li key={game.id} className="library-list__item">
                    <RouteAnchor
                      key={game.id}
                      label={game.title}
                      href={desktopPath}
                      icon={game.iconUrl}
                      isFavorite={game.favorite}
                      active={active}
                      focusId={focusId}
                      focusNavigationOverrides={{
                        right: contentEntryTarget,
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </VerticalFocusGroup>
      </div>
    </div>
  );
}

function getCachedUserDetails() {
  try {
    const cachedUserDetails =
      globalThis.window.localStorage.getItem("userDetails");

    return cachedUserDetails
      ? (JSON.parse(cachedUserDetails) as UserDetails)
      : null;
  } catch {
    return null;
  }
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
  const [userDetails, setUserDetails] = useState<UserDetails | null>(
    getCachedUserDetails
  );
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
    down: getItemFocusTarget(BIG_PICTURE_SIDEBAR_FRIENDS_ID),
  };
  const friendsFocusNavigationOverrides: FocusOverrides = {
    up: getItemFocusTarget(BIG_PICTURE_SIDEBAR_PROFILE_ID),
    right: getItemFocusTarget(BIG_PICTURE_SIDEBAR_NOTIFICATIONS_ID),
    down: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home),
  };
  const notificationsFocusNavigationOverrides: FocusOverrides = {
    up: getItemFocusTarget(BIG_PICTURE_SIDEBAR_PROFILE_ID),
    left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_FRIENDS_ID),
    down: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home),
  };

  useEffect(() => {
    if (!IS_DESKTOP) return;

    const fetchUserDetails = () => {
      void globalThis.window.electron
        .getMe()
        .then(setUserDetails)
        .catch(() => {
          setUserDetails(null);
        });
    };

    fetchUserDetails();

    const unsubscribeSignIn =
      globalThis.window.electron.onSignIn(fetchUserDetails);
    const unsubscribeAccountUpdated =
      globalThis.window.electron.onAccountUpdated(fetchUserDetails);
    const unsubscribeSignOut = globalThis.window.electron.onSignOut(() => {
      setUserDetails(null);
    });

    return () => {
      unsubscribeSignIn();
      unsubscribeAccountUpdated();
      unsubscribeSignOut();
    };
  }, []);

  return (
    <>
      <div className="sidebar-profile">
        <UserProfile
          image={userDetails?.profileImageUrl ?? DEFAULT_PROFILE_IMAGE}
          name={userDetails?.displayName ?? "Sign in"}
          friendCode={
            userDetails?.username || userDetails?.id || "Not signed in"
          }
          profileFocusId={BIG_PICTURE_SIDEBAR_PROFILE_ID}
          friendsFocusId={BIG_PICTURE_SIDEBAR_FRIENDS_ID}
          notificationsFocusId={BIG_PICTURE_SIDEBAR_NOTIFICATIONS_ID}
          profileFocusNavigationOverrides={profileFocusNavigationOverrides}
          friendsFocusNavigationOverrides={friendsFocusNavigationOverrides}
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
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [restoringNotificationsFocus, setRestoringNotificationsFocus] =
    useState(false);

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
      <div className="sidebar-drawer-overlay" />
    </>
  );
}

export { Sidebar };
