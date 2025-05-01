import {
  AppsIcon,
  DownloadIcon,
  GearIcon,
  HomeIcon,
  BookmarkIcon,
} from "@primer/octicons-react";

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
    path: "/downloads",
    nameKey: "downloads",
    render: () => <DownloadIcon />,
  },
  {
    path: "/collections",
    nameKey: "collections",
    render: () => <BookmarkIcon />,
  },
  {
    path: "/settings",
    nameKey: "settings",
    render: () => <GearIcon />,
  },
];
