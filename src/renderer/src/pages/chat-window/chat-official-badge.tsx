import { useTranslation } from "react-i18next";

export interface ChatOfficialBadgeProps {
  size: number;
}

/**
 * The seal next to the Hydra team's name: a filled rosette with a check, the
 * one mark of the official account. Its tooltip says what it means.
 */
export function ChatOfficialBadge({ size }: Readonly<ChatOfficialBadgeProps>) {
  const { t } = useTranslation("chat_window");
  const label = t("official_account");

  return (
    <span className="chat-window__official-badge" title={label}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        role="img"
        aria-label={label}
      >
        <path
          d="M8 .5l1.9 1.3 2.3-.2.8 2.2 2 1.2-.5 2.3 1 2.1-1.7 1.6-.2 2.3-2.3.5L10 15.5 8 14.3l-2 1.2-1.3-1.9-2.3-.5-.2-2.3L.5 9.2l1-2.1L1 4.8l2-1.2.8-2.2 2.3.2z"
          fill="currentColor"
        />
        <path
          d="M5.4 8.3l1.7 1.7 3.6-3.6"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
