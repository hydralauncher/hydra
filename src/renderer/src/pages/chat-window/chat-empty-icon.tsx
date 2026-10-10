import HydraIcon from "@renderer/assets/icons/hydra.svg?react";

/**
 * Two speech bubbles with the Hydra mark cut out of the front one, for an
 * empty conversation. The cut-outs take the tile's background color.
 */
export function ChatEmptyIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M33 5h17a10 10 0 0 1 10 10v8a10 10 0 0 1-10 10v6.5l-7.5-6.5H33a10 10 0 0 1-10-10v-8a10 10 0 0 1 10-10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        className="chat-window__empty-icon-gap"
        d="M14 20h22a10 10 0 0 1 10 10v12a10 10 0 0 1-10 10H22l-9 7v-7.5A10 10 0 0 1 4 42V30a10 10 0 0 1 10-10Z"
        fill="currentColor"
        strokeWidth="4"
        paintOrder="stroke"
      />
      <HydraIcon
        className="chat-window__empty-icon-logo"
        x="10.5"
        y="24"
        width="25.3"
        height="22.54"
      />
    </svg>
  );
}
