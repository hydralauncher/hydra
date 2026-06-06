import {
  AppsIcon,
  DownloadIcon,
  GearIcon,
  HomeIcon,
  BookIcon,
  CalendarIcon,
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
    path: "/crack-calendar",
    nameKey: "release_calendar",
    render: () => <CalendarIcon />,
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
