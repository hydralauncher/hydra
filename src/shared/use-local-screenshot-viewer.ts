import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalScreenshot } from "@types";

import {
  getAdjacentLocalScreenshot,
  resolveViewerSelection,
} from "./local-screenshots";

export function useLocalScreenshotViewer(screenshots: LocalScreenshot[]) {
  const [openClientId, setOpenClientId] = useState<string | null>(null);
  const lastIndexRef = useRef(0);

  const current = useMemo(
    () =>
      resolveViewerSelection(screenshots, openClientId, lastIndexRef.current),
    [openClientId, screenshots]
  );

  const index = current
    ? screenshots.findIndex(
        (screenshot) => screenshot.clientId === current.clientId
      )
    : -1;

  useEffect(() => {
    if (index >= 0) lastIndexRef.current = index;
  }, [index]);

  useEffect(() => {
    if (openClientId && !current) setOpenClientId(null);
    if (current && current.clientId !== openClientId) {
      setOpenClientId(current.clientId);
    }
  }, [current, openClientId]);

  const open = useCallback((clientId: string) => setOpenClientId(clientId), []);
  const close = useCallback(() => setOpenClientId(null), []);

  const move = useCallback(
    (direction: -1 | 1) => {
      if (!current) return;
      const next = getAdjacentLocalScreenshot(
        screenshots,
        current.clientId,
        direction
      );
      if (next) setOpenClientId(next.clientId);
    },
    [current, screenshots]
  );

  return {
    current,
    index,
    hasPrevious: index > 0,
    hasNext: index >= 0 && index < screenshots.length - 1,
    open,
    close,
    previous: () => move(-1),
    next: () => move(1),
  };
}
