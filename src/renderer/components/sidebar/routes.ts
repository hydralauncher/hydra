import {
  DownloadIcon,
  GearIcon,
  ListUnorderedIcon,
  PencilIcon,
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
  {
    path: "/patch-notes",
    nameKey: "patch-notes",
    Icon: PencilIcon,
  },
];
