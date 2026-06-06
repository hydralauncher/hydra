import {
  BookOpenIcon,
  DownloadSimpleIcon,
  GearIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  PuzzlePieceIcon,
  CalendarDotsIcon,
  SignOutIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { forwardRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Divider,
  FocusItem,
  Input,
  RouteAnchor,
  ScrollArea,
  VerticalFocusGroup,
} from "../../components";
import { IS_DESKTOP } from "../../constants";
import { useLibrary, useSearch } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  BIG_PICTURE_SIDEBAR_EXIT_ID,
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
  BIG_PICTURE_SIDEBAR_REGION_ID,
  type BigPictureSidebarRouteKey,
  getBigPictureContentSidebarReturnTargetFromPathname,
  getBigPictureGameRouteMatch,
  getBigPictureSidebarLibraryGameFocusId,
  getBigPictureSidebarItemIdFromPathname,
  normalizeBigPicturePathname,
} from "../navigation";
import "./styles.scss";

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
        key: "releaseCalendar",
        label: "Release Calendar",
        path: `${basePath}/crack-calendar`,
        icon: CalendarDotsIcon,
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
            focusNavigationOverrides={sidebarItemNavigationOverrides}
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

const SidebarContainer = forwardRef<
  HTMLDivElement,
  Readonly<{ children: React.ReactNode }>
>(function SidebarContainer({ children }, ref) {
  const handleMouseLeave = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  return (
    <div
      ref={ref}
      role="presentation"
      className="sidebar-container"
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  );
});

function Sidebar() {
  return (
    <>
      <VerticalFocusGroup regionId={BIG_PICTURE_SIDEBAR_REGION_ID} asChild>
        <SidebarContainer>
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
