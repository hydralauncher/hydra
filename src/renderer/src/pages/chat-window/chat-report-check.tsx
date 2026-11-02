import { motion, useReducedMotion } from "framer-motion";

/** A fast start that settles gently, for confirmations. */
export const CHAT_REPORT_EASE_OUT = [0.16, 1, 0.3, 1] as const;
const CHECK_DRAW_SECONDS = 0.35;
const CHECK_DEFAULT_DELAY_SECONDS = 0.1;

export interface ChatReportCheckProps {
  size: number;
  /** Seconds before the stroke starts drawing. */
  delay?: number;
}

/** A check mark that draws itself in, for a sent report. */
export function ChatReportCheck({
  size,
  delay = CHECK_DEFAULT_DELAY_SECONDS,
}: Readonly<ChatReportCheckProps>) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <motion.path
        d="M5 13l4 4L19 7"
        initial={{ pathLength: shouldReduceMotion ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : {
                duration: CHECK_DRAW_SECONDS,
                ease: CHAT_REPORT_EASE_OUT,
                delay,
              }
        }
      />
    </svg>
  );
}
