import {
  BookOpenIcon,
  DownloadSimpleIcon,
  GearIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import {
  forwardRef,
  useMemo,
  type HTMLAttributes,
  type ReactNode,
} from "react";
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
import { toSlug } from "../../helpers";
import { useLibrary, useSearch } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  BIG_PICTURE_CONTENT_REGION_ID,
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
  BIG_PICTURE_SIDEBAR_REGION_ID,
  type BigPictureSidebarRouteKey,
  getBigPictureSidebarItemIdFromPathname,
} from "../navigation";
import "./styles.scss";

function getSidebarRoutePath(routeKey: BigPictureSidebarRouteKey) {
  const basePath = IS_DESKTOP ? "/big-picture" : "";

  if (routeKey === "home") return basePath || "/";

  return `${basePath}/${routeKey}`;
}

function SidebarRouter() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeSidebarItemId = getBigPictureSidebarItemIdFromPathname(pathname);
  const sidebarItemNavigationOverrides: FocusOverrides = {
    left: {
      type: "block",
    },
    right: {
      type: "region",
      regionId: BIG_PICTURE_CONTENT_REGION_ID,
      entryDirection: "right",
    },
  };

  const routes = [
    {
      key: "home",
      label: "Home",
      path: getSidebarRoutePath("home"),
      icon: HouseIcon,
    },
    {
      key: "catalogue",
      label: "Catalogue",
      path: getSidebarRoutePath("catalogue"),
      icon: SquaresFourIcon,
    },
    {
      key: "library",
      label: "Library",
      path: getSidebarRoutePath("library"),
      icon: BookOpenIcon,
    },
    {
      key: "downloads",
      label: "Download",
      path: getSidebarRoutePath("downloads"),
      icon: DownloadSimpleIcon,
    },
    {
      key: "settings",
      label: "Settings",
      path: getSidebarRoutePath("settings"),
      icon: GearIcon,
    },
  ] as const;

  const handleSidebarItemClick = (path: string) => {
    if (path !== pathname) {
      navigate(path);
    }
  };

  return (
    <div className="sidebar-router-container">
      {routes.map((route) => {
        const itemId = BIG_PICTURE_SIDEBAR_ITEM_IDS[route.key];
        const active = activeSidebarItemId === itemId;

        return (
          <div
            key={route.label}
            className={`state-wrapper ${active ? "state-wrapper--active" : ""}`}
          >
            <FocusItem
              id={itemId}
              navigationOverrides={sidebarItemNavigationOverrides}
              asChild
            >
              <button
                type="button"
                onClick={() => handleSidebarItemClick(route.path)}
                className={`route-anchor route-anchor--extra-padding${active ? " route-anchor--active" : ""}`}
              >
                <div className="route-anchor__icon route-anchor__icon--small-size">
                  <route.icon size={24} />
                </div>
                <div className="route-anchor__label">{route.label}</div>
              </button>
            </FocusItem>
          </div>
        );
      })}
    </div>
  );
}

function SidebarLibrary() {
  const { library } = useLibrary();

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
        <FocusItem id="sidebar-library-search-input" asChild>
          <Input
            placeholder="Search"
            iconLeft={<MagnifyingGlassIcon size={24} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </FocusItem>
      </div>

      <div className="library-container__list-focus-region">
        <VerticalFocusGroup regionId="sidebar-library-list">
          <ScrollArea>
            <ul className="library-list">
              {filteredItems.map((game) => (
                <li key={game.id} className="library-list__item">
                  <RouteAnchor
                    key={game.id}
                    label={game.title}
                    href={`/game/${game.objectId}/${toSlug(game.title)}`}
                    icon={game.iconUrl}
                    isFavorite={game.favorite}
                  />
                </li>
              ))}
            </ul>
          </ScrollArea>
        </VerticalFocusGroup>
      </div>
    </div>
  );
}

interface SidebarContainerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const SidebarContainer = forwardRef<HTMLDivElement, SidebarContainerProps>(
  function SidebarContainer({ children, className, ...props }, ref) {
    const handleMouseLeave = () => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    };

    return (
      <>
        <div
          {...props}
          ref={ref}
          role="presentation"
          className={`sidebar-container${className ? ` ${className}` : ""}`}
          onMouseLeave={handleMouseLeave}
        >
          {children}
        </div>
        <div className="sidebar-spacer" />
        <div className="sidebar-drawer-overlay" />
      </>
    );
  }
);

function Sidebar() {
  return (
    <VerticalFocusGroup
      regionId={BIG_PICTURE_SIDEBAR_REGION_ID}
      autoScrollMode="region"
      asChild
    >
      <SidebarContainer>
        <SidebarRouter />
        <Divider />
        <SidebarLibrary />
      </SidebarContainer>
    </VerticalFocusGroup>
  );
}

export { Sidebar };
