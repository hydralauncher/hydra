import { useCallback, useLayoutEffect, useRef, useState } from "react";

const SLOT_X_RATIO = 59.5 / 411;
const SLOT_Y_RATIO = 129 / 221;
const BRANCH_GAP = 40;
const ROW_TOLERANCE = 8;
const COLUMN_TOLERANCE = 8;

export interface CloudConnector {
  width: number;
  height: number;
  path: string;
}

export function useCloudConnector(dependency: unknown) {
  const stageRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [connector, setConnector] = useState<CloudConnector>({
    width: 0,
    height: 0,
    path: "",
  });

  const drawConnector = useCallback(() => {
    const stage = stageRef.current;
    const consoleEl = consoleRef.current;
    const grid = gridRef.current;
    if (!stage || !consoleEl || !grid) return;

    const stageRect = stage.getBoundingClientRect();
    const consoleRect = consoleEl.getBoundingClientRect();
    const cards = Array.from(
      grid.querySelectorAll<HTMLElement>(".emulator-detail__cloud-card")
    );
    if (cards.length === 0) {
      setConnector({
        width: stageRect.width,
        height: stageRect.height,
        path: "",
      });
      return;
    }

    const slotX =
      consoleRect.left - stageRect.left + SLOT_X_RATIO * consoleRect.width;
    const slotY =
      consoleRect.top - stageRect.top + SLOT_Y_RATIO * consoleRect.height;

    const cardGeoms = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        x: rect.left - stageRect.left + rect.width / 2,
        top: rect.top - stageRect.top,
        bottom: rect.bottom - stageRect.top,
      };
    });

    type CardGeom = (typeof cardGeoms)[number];

    const clusterBy = (
      pick: (card: CardGeom) => number,
      tolerance: number
    ): CardGeom[][] => {
      const sorted = [...cardGeoms].sort((a, b) => pick(a) - pick(b));
      const groups: CardGeom[][] = [];
      for (const card of sorted) {
        const last = groups.at(-1);
        if (last && pick(card) - pick(last[0]) <= tolerance) last.push(card);
        else groups.push([card]);
      }
      return groups;
    };

    const rows = clusterBy((card) => card.top, ROW_TOLERANCE);
    const firstRow = rows[0];

    const segments: string[] = [];

    const rowTop = Math.min(...firstRow.map((c) => c.top));
    const busY = rowTop - BRANCH_GAP;
    const xs = firstRow.map((c) => c.x);
    const left = Math.min(slotX, ...xs);
    const right = Math.max(slotX, ...xs);
    segments.push(
      `M ${slotX} ${slotY} L ${slotX} ${busY}`,
      `M ${left} ${busY} L ${right} ${busY}`,
      ...firstRow.map((geom) => `M ${geom.x} ${busY} L ${geom.x} ${geom.top}`)
    );

    const columns = clusterBy((card) => card.x, COLUMN_TOLERANCE);
    for (const column of columns) {
      const ordered = [...column].sort((a, b) => a.top - b.top);
      for (let i = 1; i < ordered.length; i += 1) {
        const upper = ordered[i - 1];
        const lower = ordered[i];
        segments.push(`M ${lower.x} ${upper.bottom} L ${lower.x} ${lower.top}`);
      }
    }

    setConnector({
      width: stageRect.width,
      height: stageRect.height,
      path: segments.join(" "),
    });
  }, []);

  useLayoutEffect(() => {
    drawConnector();
    const observer = new ResizeObserver(drawConnector);
    if (stageRef.current) observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [drawConnector, dependency]);

  return { stageRef, consoleRef, gridRef, connector };
}
