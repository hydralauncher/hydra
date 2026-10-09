import { useEffect, useState } from "react";

import type { ChatSendCooldown } from "./chat-rate-limit";

/** Matches the ring's circumference in chat-window.scss. */
const RING_RADIUS = 11;
const TICK_MS = 250;

const getSecondsLeft = (until: number) =>
  Math.max(Math.ceil((until - Date.now()) / 1000), 0);

export interface ChatSendCooldownGaugeProps {
  cooldown: ChatSendCooldown;
}

/**
 * Draining ring and seconds left, shown in the send button while the rate
 * limit cools down. Key it by `cooldown.startedAt`: the ring's progress is
 * fixed when it mounts.
 */
export function ChatSendCooldownGauge({
  cooldown,
}: ChatSendCooldownGaugeProps) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    getSecondsLeft(cooldown.until)
  );
  // A conversation opened mid-cooldown picks the ring up where it is.
  const [elapsed] = useState(() => Date.now() - cooldown.startedAt);

  useEffect(() => {
    const interval = setInterval(
      () => setSecondsLeft(getSecondsLeft(cooldown.until)),
      TICK_MS
    );
    return () => clearInterval(interval);
  }, [cooldown.until]);

  return (
    <span className="chat-window__send-cooldown" aria-hidden="true">
      <svg className="chat-window__send-cooldown-ring" viewBox="0 0 32 32">
        <circle
          className="chat-window__send-cooldown-track"
          cx="16"
          cy="16"
          r={RING_RADIUS}
        />
        <circle
          className="chat-window__send-cooldown-progress"
          cx="16"
          cy="16"
          r={RING_RADIUS}
          style={{
            animationDuration: `${cooldown.until - cooldown.startedAt}ms`,
            animationDelay: `-${elapsed}ms`,
          }}
        />
      </svg>
      <span className="chat-window__send-cooldown-seconds">{secondsLeft}</span>
    </span>
  );
}
