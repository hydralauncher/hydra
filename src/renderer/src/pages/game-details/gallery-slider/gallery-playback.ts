const ACTIVATABLE_CONTROL_SELECTOR = "button, a, [role='button']";
const PLAYER_SELECTOR = ".gallery-video";

interface PlaybackToggleState {
  paused: boolean;
  ended: boolean;
  pendingPlay: boolean;
}

export const shouldPauseOnToggle = ({
  paused,
  ended,
  pendingPlay,
}: PlaybackToggleState) => pendingPlay || (!paused && !ended);

const findActivatableControl = (target: EventTarget | null) => {
  const element = target as Element | null;
  return typeof element?.closest === "function"
    ? element.closest(ACTIVATABLE_CONTROL_SELECTOR)
    : null;
};

export const shouldSpaceTogglePlayback = (
  target: EventTarget | null,
  gallery: Element | null
) => {
  const control = findActivatableControl(target);
  if (!control) return true;
  if (!gallery?.contains(control)) return false;
  return control.closest(PLAYER_SELECTOR) === null;
};
