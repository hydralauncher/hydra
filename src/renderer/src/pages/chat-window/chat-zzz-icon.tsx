/** Sleeping "zzz" for the offline hint; the letters drift up one after another. */
export function ChatZzzIcon() {
  return (
    <svg
      className="chat-window__zzz"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.25 11.5h2.5l-2.5 3h2.5" />
      <path d="M5.75 7h3l-3 3.5h3" />
      <path d="M10.5 1.5h4l-4 4.5h4" />
    </svg>
  );
}
