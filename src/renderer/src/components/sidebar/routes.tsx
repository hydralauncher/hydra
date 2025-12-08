import {
  AppsIcon,
  DownloadIcon,
  GearIcon,
  HomeIcon,
  BookIcon,
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
  {
    path: "https://hydrawrapped.com",
    nameKey: "hydra_2025_wrapped",
    render: () => (
      <img
        src="https://cdn.losbroxas.org/thumbnail_hydra_badge2_fb01af31e3.png"
        alt="Hydra 2025 Wrapped"
        style={{ width: 16, height: 16 }}
      />
    ),
  },
];
