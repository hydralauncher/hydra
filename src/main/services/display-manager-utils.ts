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
  return displays.map((display, index) => ({
    id: String(display.id),
    label: display.label?.trim() || `Display ${index + 1}`,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    },
    isPrimary: display.id === primaryDisplayId,
    internal: display.internal,
  }));
}

export function resolveDisplayId<TDisplay extends ElectronDisplayLike>(
  displayId: string | null | undefined,
  displays: TDisplay[],
  primaryDisplayId: number
): TDisplay {
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
