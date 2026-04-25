import {
  BookOpenIcon,
  DownloadSimpleIcon,
  GearIcon,
  HouseIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router-dom";
import { IS_DESKTOP } from "../../constants";
import { FocusItem, VerticalFocusGroup } from "../../components";
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

  const { pathname } = useLocation();
  const activeSidebarItemId = getBigPictureSidebarItemIdFromPathname(pathname);
  const sidebarNavigationOverrides: FocusOverrides = {
    left: {
      type: "block",
    },
    right: {
      type: "region",
      regionId: BIG_PICTURE_CONTENT_REGION_ID,
      entryDirection: "right",
    },
  };

  const handleSidebarItemClick = (path: string) => {
    if (path !== pathname) {
      navigate(path);
    }
  };

  return (
    <VerticalFocusGroup
      className="big-picture__router-container"
      regionId={BIG_PICTURE_SIDEBAR_REGION_ID}
      navigationOverrides={sidebarNavigationOverrides}
      autoScrollMode="region"
      style={{ gap: "calc(var(--spacing-unit) / 2)" }}
    >
      {routes.map((route) => {
        const itemId = BIG_PICTURE_SIDEBAR_ITEM_IDS[route.key];
        const active = activeSidebarItemId === itemId;

        return (
          <div
            key={route.path}
            className={`state-wrapper${active ? " state-wrapper--active" : ""}`}
          >
            <FocusItem id={itemId} asChild>
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
    </VerticalFocusGroup>
  );
}

function SidebarContainer({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <div className="big-picture__sidebar-container">{children}</div>
      <div className="big-picture__sidebar-spacer" />
      <div className="big-picture__sidebar-drawer-overlay" />
    </>
  );
}

function Sidebar() {
  return (
    <SidebarContainer>
      <SidebarRouter />
    </SidebarContainer>
  );
}

export { Sidebar };
