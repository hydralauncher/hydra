const FALLBACK_PATH = "M3 13.5V9M8 13.5V3M13 13.5V6.5M2 13.5h12";

const paths: Record<string, string> = {
  playtime: "M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2zM8 5v3l2 1.5",
  games:
    "M5 4.5h6a3.5 3.5 0 0 1 0 7H5a3.5 3.5 0 0 1 0-7zM4.5 8h3M6 6.5v3M10.5 7.5h.01M12 9h.01",
  friends:
    "M6 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5zM1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11.5 3a2 2 0 1 0 0 4 2 2 0 1 0 0-4zM11.5 9.5c1.8 0 3 1.3 3 3.5",
  achievements:
    "M5 2.5h6V6a3 3 0 0 1-6 0zM5 4H3v1a2 2 0 0 0 2 2M11 4h2v1a2 2 0 0 1-2 2M8 9v3M5.5 13.5h5",
  souvenirs:
    "M2.5 6h11v3h-11zM3 9v4.5h10V9M8 6v7.5M8 6C7 4 5.5 2.8 4.8 3.5S5.5 6 8 6zM8 6c1-2 2.5-3.2 3.2-2.5S10.5 6 8 6z",
  streak:
    "M8 14c-2.8 0-4.5-1.9-4.5-4.3 0-2.6 2.2-3.9 2.7-6.7 1.6 1 2.3 2.4 2.3 3.6.8-.4 1.3-1.2 1.4-2 1.6 1.3 2.6 3 2.6 5.1C12.5 12.1 10.8 14 8 14z",
  sessions: "M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2zM6.5 5.5v5l4-2.5z",
  reviews:
    "M5 7v6.5H2.5V7zM5 7l2.5-4.5c1 0 1.7.8 1.5 1.8L8.6 7h4a1.4 1.4 0 0 1 1.4 1.6l-.8 4A1.4 1.4 0 0 1 11.8 14H5",
};

export function MetricIcon({
  metric,
  size = 16,
}: Readonly<{
  metric: string;
  size?: number;
}>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[metric] ?? FALLBACK_PATH} />
    </svg>
  );
}
