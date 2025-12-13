import {
  AppsIcon,
  DownloadIcon,
  GearIcon,
  HomeIcon,
  BookIcon,
} from "@primer/octicons-react";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";

export const routes = [
  {
    path: "/",
    nameKey: "home",
    render: () => <HomeIcon />,
  },
  {
    path: "/catalogue",
    nameKey: "catalogue",
    render: () => <AppsIcon />,
  },
  {
    path: "/steam",
    nameKey: "steam",
    render: () => <SteamLogo width={16} height={16} />,
  },
  {
    path: "/library",
    nameKey: "library",
    render: () => <BookIcon />,
  },
  {
    path: "/downloads",
    nameKey: "downloads",
    render: () => <DownloadIcon />,
  },
  {
    path: "/settings",
    nameKey: "settings",
    render: () => <GearIcon />,
  },
];
