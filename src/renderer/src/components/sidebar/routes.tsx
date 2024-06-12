import { AppsIcon, GearIcon, HomeIcon } from "@primer/octicons-react";

import { DownloadIcon } from "./download-icon";

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
    render: (isDownloading: boolean) => (
      <DownloadIcon isDownloading={isDownloading} />
    ),
  },
  {
    path: "/settings",
    nameKey: "settings",
    render: () => <GearIcon />,
  },
];
