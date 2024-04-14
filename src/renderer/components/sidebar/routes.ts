import {
  DownloadIcon,
  GearIcon,
  ListUnorderedIcon,
} from "@primer/octicons-react";

export const routes = [
  {
    path: "/",
    nameKey: "catalogue",
    Icon: ListUnorderedIcon,
  },
  {
    path: "/downloads",
    nameKey: "downloads",
    Icon: DownloadIcon,
  },
  {
    path: "/settings",
    nameKey: "settings",
    Icon: GearIcon,
  },
];
