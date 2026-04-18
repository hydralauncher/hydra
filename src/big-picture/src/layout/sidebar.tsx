import {
  BookOpenIcon,
  DownloadSimpleIcon,
  GearIcon,
  HouseIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router-dom";
import { IS_DESKTOP } from "../constants";
import "./sidebar.scss";

function SidebarRouter() {
  const basePath = IS_DESKTOP ? "/big-picture" : "";

  const navigate = useNavigate();

  const routes = [
    {
      label: "Home",
      path: basePath,
      icon: HouseIcon,
    },
    {
      label: "Catalogue",
      path: `${basePath}/catalogue`,
      icon: SquaresFourIcon,
    },
    {
      label: "Library",
      path: `${basePath}/library`,
      icon: BookOpenIcon,
    },
    {
      label: "Download",
      path: `${basePath}/downloads`,
      icon: DownloadSimpleIcon,
    },
    {
      label: "Settings",
      path: `${basePath}/settings`,
      icon: GearIcon,
    },
  ];

  const { pathname } = useLocation();

  const handleSidebarItemClick = (path: string) => {
    if (path !== pathname) {
      navigate(path);
    }
  };

  return (
    <div className="big-picture__router-container">
      {routes.map((route) => {
        const active = pathname === route.path;
        return (
          <div
            key={route.path}
            className={`state-wrapper${active ? " state-wrapper--active" : ""}`}
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
          </div>
        );
      })}
    </div>
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
