import {
  BookOpenIcon,
  DownloadSimpleIcon,
  FunnelSimpleIcon,
  GearIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router-dom";
import { IS_DESKTOP } from "../../constants";
import {
  Button,
  Divider,
  Input,
  RouteAnchor,
  ScrollArea,
  UserProfile,
} from "../../components";
import "./styles.scss";
import { useLibrary, useSearch, useUserDetails } from "../../hooks";
import { useMemo } from "react";
import { toSlug } from "../../helpers";

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

function SidebarLibrary() {
  const { library } = useLibrary();

  const sortedLibrary = useMemo(() => {
    return library.sort(
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

        <Button variant="rounded" size="icon">
          <FunnelSimpleIcon
            size={24}
            className="library-container__header__icon"
          />
        </Button>
      </div>

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
    </div>
  );
}

function SidebarProfile() {
  const { userDetails } = useUserDetails();

  return (
    <div className="bp-sidebar-profile">
      <UserProfile
        name={userDetails?.displayName ?? ""}
        image={userDetails?.profileImageUrl}
        friendCode={userDetails?.id ?? ""}
      />
    </div>
  );
}

function SidebarContainer({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const handleMouseLeave = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  return (
    <>
      <div
        className="big-picture__sidebar-container"
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      <div className="big-picture__sidebar-spacer" />
      <div className="big-picture__sidebar-drawer-overlay" />
    </>
  );
}

function Sidebar() {
  return (
    <SidebarContainer>
      <SidebarRouter />
      <Divider />
      <SidebarLibrary />
      <SidebarProfile />
    </SidebarContainer>
  );
}

export { Sidebar };
