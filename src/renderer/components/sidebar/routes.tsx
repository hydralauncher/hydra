import { GearIcon, ListUnorderedIcon } from "@primer/octicons-react";
import { DownloadIcon } from "./download-icon";

export const routes = [
  {
    path: "/",
    nameKey: "catalogue",
    render: () => <ListUnorderedIcon />,
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
