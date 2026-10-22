import {
  AppsIcon,
  DownloadIcon,
  GearIcon,
  HomeIcon,
  BookIcon,
} from "@primer/octicons-react";

function LeaderboardsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        display: "inline-block",
        verticalAlign: "text-bottom",
        overflow: "visible",
      }}
    >
      <path d="M5 2.5h6V6a3 3 0 0 1-6 0zM5 4H3v1a2 2 0 0 0 2 2M11 4h2v1a2 2 0 0 1-2 2M8 9v3M5.5 13.5h5" />
    </svg>
  );
}

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
    path: "/leaderboards",
    nameKey: "leaderboards",
    isGlobalLeaderboards: true,
    render: () => <LeaderboardsIcon />,
  },
  {
    path: "/settings",
    nameKey: "settings",
    render: () => <GearIcon />,
  },
];
