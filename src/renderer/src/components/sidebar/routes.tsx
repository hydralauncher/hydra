import {
  AppsIcon,
  DownloadIcon,
  GearIcon,
  HomeIcon,
  BookIcon,
} from "@primer/octicons-react";
import { Gamepad2, Rss } from "lucide-react";

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
    path: "/roms",
    nameKey: "roms",
    render: () => <Gamepad2 size={16} />,
  },
  {
    path: "/news",
    nameKey: "news",
    render: () => <Rss size={16} />,
  },
  {
    path: "/settings",
    nameKey: "settings",
    render: () => <GearIcon />,
  },
];
