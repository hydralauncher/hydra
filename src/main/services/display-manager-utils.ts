import type { HydraDisplay } from "@types";

type ElectronDisplayLike = {
  id: number;
  label?: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  internal: boolean;
};

export const DEFAULT_DISPLAY_ID = "default";

export function toHydraDisplays(
  displays: ElectronDisplayLike[],
  primaryDisplayId: number
): HydraDisplay[] {
  return [...displays]
    .sort((firstDisplay, secondDisplay) => {
      if (firstDisplay.bounds.x !== secondDisplay.bounds.x) {
        return firstDisplay.bounds.x - secondDisplay.bounds.x;
      }

      return firstDisplay.bounds.y - secondDisplay.bounds.y;
    })
    .map((display, index) => {
      const displayName = display.label?.trim() || `Display ${index + 1}`;
      const boundsLabel = `${display.bounds.width}x${display.bounds.height} @ ${display.bounds.x},${display.bounds.y}`;

      return {
        id: String(display.id),
        label: `${displayName} - ${boundsLabel}`,
        bounds: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        },
        isPrimary: display.id === primaryDisplayId,
        internal: display.internal,
      };
    });
}

export function resolveDisplayId<TDisplay extends ElectronDisplayLike>(
  displayId: string | null | undefined,
  displayBounds:
    | { x: number; y: number; width: number; height: number }
    | null
    | undefined,
  displays: TDisplay[],
  primaryDisplayId: number
): TDisplay {
  if (displayBounds) {
    const selectedDisplay = displays.find(
      (display) =>
        display.bounds.x === displayBounds.x &&
        display.bounds.y === displayBounds.y &&
        display.bounds.width === displayBounds.width &&
        display.bounds.height === displayBounds.height
    );

    if (selectedDisplay) {
      return selectedDisplay;
    }
  }

  if (displayId && displayId !== DEFAULT_DISPLAY_ID) {
    const selectedDisplay = displays.find(
      (display) => String(display.id) === displayId
    );

    if (selectedDisplay) {
      return selectedDisplay;
    }
  }

  const fallbackDisplay =
    displays.find((display) => display.id === primaryDisplayId) ?? displays[0];

  if (!fallbackDisplay) {
    throw new Error("No active displays were found");
  }

  return fallbackDisplay;
}
