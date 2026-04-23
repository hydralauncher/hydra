import {
  BookOpenIcon,
  DownloadSimpleIcon,
  GearIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import {
  Divider,
  Input,
  RouteAnchor,
  ScrollArea,
  VerticalFocusGroup,
} from "../../components";
import { IS_DESKTOP } from "../../constants";
import { toSlug } from "../../helpers";
import { useLibrary, useSearch } from "../../hooks";
import "./styles.scss";

function SidebarRouter() {
  const basePath = IS_DESKTOP ? "/big-picture" : "";

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

  return (
    <div className="sidebar-router-container">
      {routes.map((route) => (
        <RouteAnchor
          key={route.label}
          label={route.label}
          href={route.path}
          icon={<route.icon size={24} />}
        />
      ))}
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
        {/* <HorizontalFocusGroup regionId="sidebar-library-search"> */}
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
        {/* </HorizontalFocusGroup> */}
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
        role="presentation"
        className="sidebar-container"
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      <div className="sidebar-spacer" />
      <div className="sidebar-drawer-overlay" />
    </>
  );
}

function Sidebar() {
  return (
    <VerticalFocusGroup regionId="sidebar" asChild>
      <SidebarContainer>
        <SidebarRouter />
        <Divider />
        <SidebarLibrary />
      </SidebarContainer>
    </VerticalFocusGroup>
  );
}

export { Sidebar };
