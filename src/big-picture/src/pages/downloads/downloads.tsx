import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { LibraryGame } from "@types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type FocusItemActions } from "../../types";
import type { FocusOverrides } from "../../services";
import { useNavigation, useNavigationScreenActions } from "../../hooks";
import { BIG_PICTURE_HEADER_REGION_ID } from "../../layout";
import {
  ContextMenu,
  type ContextMenuItem,
  DownloadsGameCard,
  DownloadsHero,
  DownloadsNetworkStats,
  DownloadsProgressStats,
  Typography,
  VerticalFocusGroup,
} from "../../components";
import {
  DOWNLOADS_PAGE_REGION_ID,
  DOWNLOADS_HERO_PAUSE_RESUME_BUTTON_ID,
} from "../../components/pages/downloads/navigation";
import {
  useDownloadsHeroDisplayState,
  type DownloadsHeroSnapshot,
} from "../../components/pages/downloads/hero/use-downloads-hero-visual-state";
import {
  getDownloadCoverImageUrl,
  getDownloadLogoImageUrl,
  useBigPictureDownloadsPageData,
  type BigPictureActiveDownloadItem,
  type BigPictureDownloadsNetworkStats,
  type BigPictureDownloadListItem,
} from "./use-big-picture-downloads-page-data";
import { useNavigationSnapshot } from "../../stores";

import "./downloads.scss";

type DragPlacement = "hero" | "queue" | "paused";

type DragSourceData = {
  gameId: string;
  placement: DragPlacement;
};

type DragTarget =
  | {
      kind: "hero";
    }
  | {
      kind: "paused";
      index: number;
    }
  | {
      kind: "queue";
      index: number;
    };

type PreviewPlacement =
  | {
      kind: "hero";
    }
  | {
      kind: "queue";
      index: number;
    }
  | {
      kind: "paused";
      index: number;
    };

type PreviewLayoutState = {
  sourceGameId: string;
  heroId: string | null;
  queueIds: string[];
  pausedIds: string[];
};

type MoveModeState = PreviewLayoutState & {
  sourcePlacement: DragPlacement;
  moveTarget: PreviewPlacement;
  originalHeroId: string | null;
  originalQueueIds: string[];
  originalPausedIds: string[];
  isCommitting: boolean;
};

type OptimisticCommitState = {
  sourceGameId: string;
  sourcePlacement: DragPlacement;
  targetPlacement: PreviewPlacement;
  layout: PreviewLayoutState;
};

type DownloadMenuState = {
  item: BigPictureDownloadListItem | null;
  section: "queue" | "paused" | "completed" | null;
  position: { x: number; y: number };
  restoreFocusId: string | null;
  visible: boolean;
};

type DownloadSection = "hero" | "queue" | "paused" | "completed";

type PreviewScrollBehavior = "keep-visible" | "prefer-center";

const PREVIEW_SCROLL_SAFE_MARGIN = 96;
const PREVIEW_SCROLL_ANIMATION_DURATION = 180;
const MOVE_MODE_CROSS_SECTION_CENTER_THRESHOLD = 96;
const DRAG_EDGE_SCROLL_ZONE_PX = 120;
const DRAG_EDGE_SCROLL_MIN_STEP_PX = 8;
const DRAG_EDGE_SCROLL_MAX_STEP_PX = 30;
const previewScrollAnimationFrames = new WeakMap<HTMLElement, number>();

function isDragSourceData(value: unknown): value is DragSourceData {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.gameId === "string" &&
    (candidate.placement === "hero" ||
      candidate.placement === "queue" ||
      candidate.placement === "paused")
  );
}

function getDragTargetFromData(
  value: Record<string, unknown>
): DragTarget | null {
  if (value.kind === "hero") return { kind: "hero" };
  if (value.kind === "paused" && typeof value.index === "number") {
    return { kind: "paused", index: value.index };
  }

  if (value.kind === "queue" && typeof value.index === "number") {
    return { kind: "queue", index: value.index };
  }

  return null;
}

function areTargetsEqual(left: DragTarget | null, right: DragTarget | null) {
  if (!left || !right) return left === right;
  if (left.kind !== right.kind) return false;
  if (left.kind === "queue" && right.kind === "queue") {
    return left.index === right.index;
  }
  if (left.kind === "paused" && right.kind === "paused") {
    return left.index === right.index;
  }
  return true;
}

function getReorderedTargetIndex(targetIndex: number, sourceIndex: number) {
  return targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
}

function swapItemsAtIndices(
  items: string[],
  leftIndex: number,
  rightIndex: number
) {
  const next = [...items];
  const temporary = next[leftIndex];
  next[leftIndex] = next[rightIndex];
  next[rightIndex] = temporary;
  return next;
}

function clampInsertionIndex(targetIndex: number, length: number) {
  return Math.max(0, Math.min(targetIndex, length));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function cancelPreviewScrollAnimation(container: HTMLElement) {
  const animationFrame = previewScrollAnimationFrames.get(container);

  if (animationFrame === undefined) return;

  globalThis.cancelAnimationFrame(animationFrame);
  previewScrollAnimationFrames.delete(container);
}

function animatePreviewScroll(container: HTMLElement, targetScrollTop: number) {
  cancelPreviewScrollAnimation(container);

  const startScrollTop = container.scrollTop;
  const distance = targetScrollTop - startScrollTop;

  if (distance === 0) return;

  const startTime = performance.now();

  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = clamp(elapsed / PREVIEW_SCROLL_ANIMATION_DURATION, 0, 1);
    const easedProgress = easeOutCubic(progress);

    container.scrollTop = startScrollTop + distance * easedProgress;

    if (progress < 1) {
      previewScrollAnimationFrames.set(
        container,
        globalThis.requestAnimationFrame(step)
      );
      return;
    }

    container.scrollTop = targetScrollTop;
    previewScrollAnimationFrames.delete(container);
  };

  previewScrollAnimationFrames.set(
    container,
    globalThis.requestAnimationFrame(step)
  );
}

function insertAtIndex(items: string[], targetIndex: number, gameId: string) {
  const next = [...items];
  const safeIndex = clampInsertionIndex(targetIndex, next.length);
  next.splice(safeIndex, 0, gameId);
  return next;
}

function areIdListsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;

  return left.every((value, index) => value === right[index]);
}

function arePreviewLayoutsEqual(
  left: PreviewLayoutState | null,
  right: PreviewLayoutState | null
) {
  if (!left || !right) return left === right;

  return (
    left.sourceGameId === right.sourceGameId &&
    left.heroId === right.heroId &&
    areIdListsEqual(left.queueIds, right.queueIds) &&
    areIdListsEqual(left.pausedIds, right.pausedIds)
  );
}

function buildPreviewLayoutState(
  base: PreviewLayoutState,
  sourcePlacement: DragPlacement,
  targetPlacement: DragTarget,
  canPromoteToHero: boolean
): PreviewLayoutState {
  const sourceGameId = base.sourceGameId;
  const baseQueueIds = base.queueIds.filter((id) => id !== sourceGameId);
  const basePausedIds = base.pausedIds.filter((id) => id !== sourceGameId);

  if (targetPlacement.kind === "hero") {
    if (sourcePlacement === "hero" || !canPromoteToHero) {
      return base;
    }

    return {
      sourceGameId,
      heroId: sourceGameId,
      queueIds: base.heroId ? [base.heroId, ...baseQueueIds] : baseQueueIds,
      pausedIds: basePausedIds,
    };
  }

  if (targetPlacement.kind === "queue") {
    let heroId = base.heroId;
    let queueIds = baseQueueIds;
    let targetIndex = targetPlacement.index;

    if (sourcePlacement === "queue") {
      const sourceIndex = base.queueIds.indexOf(sourceGameId);

      if (sourceIndex >= 0) {
        targetIndex = getReorderedTargetIndex(
          targetPlacement.index,
          sourceIndex
        );
      }
    }

    if (sourcePlacement === "hero") {
      if (base.queueIds.length > 0) {
        targetIndex = Math.max(0, targetIndex - 1);
      }

      heroId = baseQueueIds[0] ?? null;
      queueIds = heroId ? baseQueueIds.slice(1) : baseQueueIds;
    }

    return {
      sourceGameId,
      heroId,
      queueIds: insertAtIndex(queueIds, targetIndex, sourceGameId),
      pausedIds: basePausedIds,
    };
  }

  let heroId = base.heroId;
  let queueIds = baseQueueIds;
  let targetIndex = targetPlacement.index;

  if (sourcePlacement === "paused") {
    const sourceIndex = base.pausedIds.indexOf(sourceGameId);

    if (sourceIndex >= 0) {
      targetIndex = getReorderedTargetIndex(targetPlacement.index, sourceIndex);
    }
  }

  if (sourcePlacement === "hero") {
    heroId = baseQueueIds[0] ?? null;
    queueIds = heroId ? baseQueueIds.slice(1) : baseQueueIds;
  }

  return {
    sourceGameId,
    heroId,
    queueIds,
    pausedIds: insertAtIndex(basePausedIds, targetIndex, sourceGameId),
  };
}

function getDownloadMainFocusId(gameId: string) {
  return `downloads-main-${gameId}`;
}

function getDownloadPrimaryActionFocusId(gameId: string) {
  return `downloads-primary-${gameId}`;
}

function getDownloadOptionsActionFocusId(gameId: string) {
  return `downloads-options-${gameId}`;
}

function getHeroPrimaryFocusId() {
  return DOWNLOADS_HERO_PAUSE_RESUME_BUTTON_ID;
}

const DOWNLOADS_REGION_NAVIGATION_ORDER = {
  hero: 0,
  queue: 1,
  paused: 2,
  completed: 3,
} as const;

function getRepresentativeFocusIdForPlacement(
  placement: DragPlacement,
  gameId: string
) {
  return placement === "hero"
    ? getHeroPrimaryFocusId()
    : getDownloadMainFocusId(gameId);
}

function getRepresentativeFocusIdForMoveTarget(
  sourceGameId: string,
  moveTarget: PreviewPlacement | DragTarget
) {
  return moveTarget.kind === "hero"
    ? getHeroPrimaryFocusId()
    : getDownloadMainFocusId(sourceGameId);
}

function getDownloadMenuPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect();

  return {
    x: rect.left,
    y: rect.bottom + 4,
  };
}

function getNextFocusIdInSection(gameIds: string[], removedGameId: string) {
  const removedIndex = gameIds.indexOf(removedGameId);
  const remainingGameIds = gameIds.filter((gameId) => gameId !== removedGameId);

  if (!remainingGameIds.length) return null;

  if (removedIndex >= 0 && removedIndex < remainingGameIds.length) {
    return getDownloadMainFocusId(remainingGameIds[removedIndex]);
  }

  return getDownloadMainFocusId(remainingGameIds[remainingGameIds.length - 1]);
}

function getPreviewPlacement(
  state: PreviewLayoutState,
  gameId: string
): PreviewPlacement | null {
  if (state.heroId === gameId) {
    return { kind: "hero" };
  }

  const queueIndex = state.queueIds.indexOf(gameId);

  if (queueIndex >= 0) {
    return {
      kind: "queue",
      index: queueIndex,
    };
  }

  const pausedIndex = state.pausedIds.indexOf(gameId);

  if (pausedIndex >= 0) {
    return {
      kind: "paused",
      index: pausedIndex,
    };
  }

  return null;
}

function getTargetForPlacement(
  placement: DragPlacement,
  index: number
): PreviewPlacement {
  if (placement === "hero") {
    return { kind: "hero" };
  }

  return {
    kind: placement,
    index,
  };
}

function getPreviewPlacementKey(
  state: PreviewLayoutState | null,
  sourceGameId: string | null
) {
  if (!state || !sourceGameId) return null;

  const placement = getPreviewPlacement(state, sourceGameId);
  if (!placement) return null;

  return placement.kind === "hero"
    ? "hero"
    : `${placement.kind}:${placement.index}`;
}

function resolvePreviewTargetElement(
  root: HTMLElement,
  state: PreviewLayoutState | null,
  sourceGameId: string | null
) {
  if (!state || !sourceGameId) return null;

  const placement = getPreviewPlacement(state, sourceGameId);
  if (!placement) return null;

  if (placement.kind === "hero") {
    return root.querySelector<HTMLElement>(
      "[data-download-drop-target='hero']"
    );
  }

  return globalThis.document.getElementById(
    getDownloadMainFocusId(sourceGameId)
  );
}

function scrollPreviewTargetIntoView(
  container: HTMLElement,
  target: HTMLElement,
  behavior: PreviewScrollBehavior,
  options: {
    safeMargin?: number;
    overflowTolerance?: number;
    centerThreshold?: number;
  } = {}
) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const maxScrollTop = Math.max(
    0,
    container.scrollHeight - container.clientHeight
  );
  const safeMargin = options.safeMargin ?? PREVIEW_SCROLL_SAFE_MARGIN;
  const overflowTolerance = options.overflowTolerance ?? 0;
  const centerThreshold = options.centerThreshold ?? 0;
  const safeTop = containerRect.top + safeMargin;
  const safeBottom = containerRect.bottom - safeMargin;

  let nextScrollTop = container.scrollTop;

  if (behavior === "prefer-center") {
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const containerCenterY = containerRect.top + containerRect.height / 2;
    const centerDelta = targetCenterY - containerCenterY;

    if (Math.abs(centerDelta) <= centerThreshold) {
      return;
    }

    nextScrollTop = container.scrollTop + centerDelta;
  } else if (targetRect.top < safeTop) {
    if (safeTop - targetRect.top <= overflowTolerance) {
      return;
    }

    nextScrollTop = container.scrollTop + (targetRect.top - safeTop);
  } else if (targetRect.bottom > safeBottom) {
    if (targetRect.bottom - safeBottom <= overflowTolerance) {
      return;
    }

    nextScrollTop = container.scrollTop + (targetRect.bottom - safeBottom);
  } else {
    return;
  }

  animatePreviewScroll(container, clamp(nextScrollTop, 0, maxScrollTop));
}

function getDragTargetFromPoint(root: HTMLElement, x: number, y: number) {
  const elements = globalThis.document.elementsFromPoint(x, y);

  for (const candidate of elements) {
    if (!(candidate instanceof HTMLElement)) continue;

    const dropElement = candidate.closest<HTMLElement>(
      "[data-download-drop-role='card'], [data-download-drop-role='container'], [data-download-drop-target='hero']"
    );

    if (!dropElement || !root.contains(dropElement)) {
      continue;
    }

    if (dropElement.dataset.downloadDropTarget === "hero") {
      return { kind: "hero" } satisfies DragTarget;
    }

    const placement = dropElement.dataset.dropPlacement;
    const rawIndex = dropElement.dataset.dropIndex;
    const index = Number(rawIndex ?? "0");

    if (
      (placement !== "queue" && placement !== "paused") ||
      Number.isNaN(index)
    ) {
      continue;
    }

    if (dropElement.dataset.downloadDropRole === "card") {
      const bounds = dropElement.getBoundingClientRect();
      const midpoint = bounds.top + bounds.height / 2;

      return {
        kind: placement,
        index: index + (y >= midpoint ? 1 : 0),
      } satisfies DragTarget;
    }

    return {
      kind: placement,
      index,
    } satisfies DragTarget;
  }

  return null;
}

function getNextMoveTarget(
  state: MoveModeState,
  direction: "up" | "down",
  canPromoteToHero: boolean
): PreviewPlacement | null {
  const placement = getPreviewPlacement(state, state.sourceGameId);

  if (!placement) return null;

  if (direction === "up") {
    if (placement.kind === "hero") {
      return null;
    }

    if (placement.kind === "queue") {
      if (placement.index > 0) {
        return { kind: "queue", index: placement.index - 1 };
      }

      return canPromoteToHero ? { kind: "hero" } : null;
    }

    if (placement.index > 0) {
      return { kind: "paused", index: placement.index - 1 };
    }

    return { kind: "queue", index: state.queueIds.length };
  }

  if (placement.kind === "hero") {
    if (state.queueIds.length > 0) {
      return { kind: "queue", index: 0 };
    }

    if (state.pausedIds.length > 0) {
      return { kind: "paused", index: 0 };
    }

    return null;
  }

  if (placement.kind === "queue") {
    if (placement.index < state.queueIds.length - 1) {
      return { kind: "queue", index: placement.index + 1 };
    }

    return { kind: "paused", index: 0 };
  }

  if (placement.index < state.pausedIds.length - 1) {
    return { kind: "paused", index: placement.index + 1 };
  }

  return null;
}

function applyPreviewPlacementToMoveModeState(
  state: MoveModeState,
  moveTarget: PreviewPlacement,
  canPromoteToHero: boolean
): MoveModeState {
  const placement = getPreviewPlacement(state, state.sourceGameId);

  if (!placement) {
    return state;
  }

  const sourceGameId = state.sourceGameId;

  if (placement.kind === moveTarget.kind) {
    if (
      placement.kind === "hero" ||
      ("index" in placement &&
        "index" in moveTarget &&
        placement.index === moveTarget.index)
    ) {
      return state;
    }
  }

  if (placement.kind === "hero" && moveTarget.kind === "queue") {
    const [nextHeroId, ...remainingQueueIds] = state.queueIds;

    if (!nextHeroId) return state;

    return {
      ...state,
      heroId: nextHeroId,
      queueIds: [sourceGameId, ...remainingQueueIds],
      moveTarget,
    };
  }

  if (placement.kind === "hero" && moveTarget.kind === "paused") {
    const [nextHeroId, ...remainingPausedIds] = state.pausedIds;

    if (!nextHeroId) return state;

    return {
      ...state,
      heroId: nextHeroId,
      pausedIds: [sourceGameId, ...remainingPausedIds],
      moveTarget,
    };
  }

  if (placement.kind === "queue" && moveTarget.kind === "hero") {
    if (!canPromoteToHero) return state;

    return {
      ...state,
      heroId: sourceGameId,
      queueIds: [
        ...(state.heroId ? [state.heroId] : []),
        ...state.queueIds.filter((id) => id !== sourceGameId),
      ],
      moveTarget,
    };
  }

  if (placement.kind === "queue" && moveTarget.kind === "queue") {
    return {
      ...state,
      queueIds: swapItemsAtIndices(
        state.queueIds,
        placement.index,
        moveTarget.index
      ),
      moveTarget,
    };
  }

  if (placement.kind === "queue" && moveTarget.kind === "paused") {
    return {
      ...state,
      queueIds: state.queueIds.filter((id) => id !== sourceGameId),
      pausedIds: [sourceGameId, ...state.pausedIds],
      moveTarget,
    };
  }

  if (placement.kind === "paused" && moveTarget.kind === "hero") {
    if (!canPromoteToHero) return state;

    return {
      ...state,
      heroId: sourceGameId,
      queueIds: [...(state.heroId ? [state.heroId] : []), ...state.queueIds],
      pausedIds: state.pausedIds.filter((id) => id !== sourceGameId),
      moveTarget,
    };
  }

  if (placement.kind === "paused" && moveTarget.kind === "queue") {
    return {
      ...state,
      queueIds: [...state.queueIds, sourceGameId],
      pausedIds: state.pausedIds.filter((id) => id !== sourceGameId),
      moveTarget,
    };
  }

  if (placement.kind === "paused" && moveTarget.kind === "paused") {
    return {
      ...state,
      pausedIds: swapItemsAtIndices(
        state.pausedIds,
        placement.index,
        moveTarget.index
      ),
      moveTarget,
    };
  }

  return state;
}

function buildDownloadsMainNavigationOverrides(
  sectionItemIds: string[][]
): Record<string, FocusOverrides> {
  const overridesByItemId: Record<string, FocusOverrides> = {};

  for (
    let sectionIndex = 0;
    sectionIndex < sectionItemIds.length;
    sectionIndex += 1
  ) {
    const items = sectionItemIds[sectionIndex];

    if (items.length === 0) continue;

    const previousSectionItems =
      sectionItemIds
        .slice(0, sectionIndex)
        .reverse()
        .find((candidate) => candidate.length > 0) ?? [];
    const nextSectionItems =
      sectionItemIds
        .slice(sectionIndex + 1)
        .find((candidate) => candidate.length > 0) ?? [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const itemId = items[itemIndex];
      const previousItemId =
        items[itemIndex - 1] ?? previousSectionItems.at(-1) ?? null;
      const nextItemId = items[itemIndex + 1] ?? nextSectionItems[0] ?? null;

      overridesByItemId[itemId] = {
        up: previousItemId
          ? {
              type: "item",
              itemId: previousItemId,
            }
          : undefined,
        down: nextItemId
          ? {
              type: "item",
              itemId: nextItemId,
            }
          : {
              type: "block",
            },
      };
    }
  }

  return overridesByItemId;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function buildPreviewRowItemFromListItem(
  item: BigPictureDownloadListItem,
  placement: "queue" | "paused"
): BigPictureDownloadListItem {
  if (placement === "queue") {
    return {
      ...item,
      statusLabel: "Queued",
      statusTone: "default",
      progress: item.progress ?? item.game.download?.progress ?? 0,
      trailingLabel: item.sizeLabel ?? item.trailingLabel,
      secondaryLabel: item.transferLabel ?? item.secondaryLabel,
      rightStatusLabel: null,
    };
  }

  return {
    ...item,
    statusLabel: "Paused",
    statusTone: "paused",
    progress: item.progress ?? item.game.download?.progress ?? 0,
    trailingLabel: item.progressLabel ?? item.trailingLabel,
    secondaryLabel: item.transferLabel ?? item.secondaryLabel,
    rightStatusLabel: null,
  };
}

function buildPreviewRowItemFromActive(
  item: BigPictureActiveDownloadItem,
  placement: "queue" | "paused"
): BigPictureDownloadListItem {
  return {
    id: item.id,
    title: item.title,
    href: item.href,
    coverImageUrl: getDownloadCoverImageUrl(item.game),
    metaLabel: item.metaLabel,
    statusLabel: placement === "queue" ? "Queued" : "Paused",
    statusTone: placement === "queue" ? "default" : "paused",
    progress: item.progress,
    trailingLabel: placement === "queue" ? item.sizeLabel : item.progressLabel,
    secondaryLabel: item.transferLabel ?? item.sizeLabel,
    rightStatusLabel: null,
    progressLabel: item.progressLabel,
    transferLabel: item.transferLabel,
    speedLabel: item.speedLabel,
    etaLabel: item.etaLabel,
    sizeLabel: item.sizeLabel,
    seedAction: null,
    canRemove: false,
    canMoveUp: false,
    canMoveDown: false,
    game: item.game,
  };
}

function buildPreviewHeroItemFromListItem(
  item: BigPictureDownloadListItem
): BigPictureActiveDownloadItem {
  const progress = item.game.download?.progress ?? 0;

  return {
    id: item.id,
    title: item.title,
    href: item.href,
    coverImageUrl: item.coverImageUrl,
    metaLabel: item.metaLabel,
    statusLabel: item.statusLabel,
    statusTone: item.statusTone,
    progress,
    progressLabel: item.progressLabel ?? "0%",
    transferLabel: item.transferLabel ?? item.sizeLabel ?? item.trailingLabel,
    speedLabel: item.speedLabel ?? "Ready when dropped",
    etaLabel: item.etaLabel ?? null,
    sizeLabel: item.sizeLabel ?? item.trailingLabel,
    pauseOrResumeAction: "pause",
    canPauseOrResume: true,
    canMoveFromHero: true,
    canPromoteToHero: true,
    game: item.game,
  };
}

function Section({
  title,
  children,
  count,
}: Readonly<{
  title: string;
  children: React.ReactNode;
  count: number;
}>) {
  return (
    <section className="downloads-page__section">
      <div className="downloads-page__section-header">
        <Typography variant="h4" className="downloads-page__section-title">
          {title}
        </Typography>
        <Typography variant="h3" className="downloads-page__section-count">
          {count}
        </Typography>
      </div>
      {children}
    </section>
  );
}

export default function Downloads() {
  const navigate = useNavigate();
  const { setFocus } = useNavigation();
  const { currentFocusId, nodes } = useNavigationSnapshot();
  const {
    activeDownload,
    networkStats,
    queuedDownloads,
    pausedDownloads,
    completedDownloads,
    hasDownloads,
    pauseDownload,
    resumeDownload,
    startNow,
    sendToQueue,
    moveToPaused,
    cancelDownload,
    removeDownload,
    moveQueuedDownload,
    setQueuedDownloadPosition,
    setPausedDownloadPosition,
    pauseSeeding,
    resumeSeeding,
  } = useBigPictureDownloadsPageData();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const previousMoveModePlacementKindRef = useRef<
    PreviewPlacement["kind"] | null
  >(null);
  const suppressOpenRef = useRef(false);
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragEdgeScrollFrameRef = useRef<number | null>(null);
  const dragSourceRef = useRef<DragSourceData | null>(null);
  const lastDragAssistTargetRef = useRef<DragTarget | null>(null);
  const updateMouseDragPreviewRef = useRef<
    ((source: DragSourceData, target: DragTarget | null) => void) | null
  >(null);
  const [dragSource, setDragSource] = useState<DragSourceData | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [dragPreviewState, setDragPreviewState] =
    useState<PreviewLayoutState | null>(null);
  const [moveMode, setMoveMode] = useState<MoveModeState | null>(null);
  const [optimisticCommitState, setOptimisticCommitState] =
    useState<OptimisticCommitState | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<DownloadMenuState>({
    item: null,
    section: null,
    position: { x: 0, y: 0 },
    restoreFocusId: null,
    visible: false,
  });
  const currentFocusRegionId = useMemo(() => {
    if (!currentFocusId) return null;

    return nodes.find((node) => node.id === currentFocusId)?.regionId ?? null;
  }, [currentFocusId, nodes]);

  const queuedById = useMemo(
    () => new Map(queuedDownloads.map((item) => [item.id, item])),
    [queuedDownloads]
  );
  const pausedById = useMemo(
    () => new Map(pausedDownloads.map((item) => [item.id, item])),
    [pausedDownloads]
  );
  const activePreviewQueueItem = useMemo(
    () =>
      activeDownload
        ? buildPreviewRowItemFromActive(activeDownload, "queue")
        : null,
    [activeDownload]
  );
  const activePreviewPausedItem = useMemo(
    () =>
      activeDownload
        ? buildPreviewRowItemFromActive(activeDownload, "paused")
        : null,
    [activeDownload]
  );

  const canPromoteToHero = !activeDownload || activeDownload.canPromoteToHero;
  const interactionsLocked = Boolean(moveMode);
  const previewLayoutState =
    moveMode ?? dragPreviewState ?? optimisticCommitState?.layout ?? null;
  const stopDragEdgeAutoScroll = useCallback(() => {
    if (dragEdgeScrollFrameRef.current !== null) {
      globalThis.window.cancelAnimationFrame(dragEdgeScrollFrameRef.current);
      dragEdgeScrollFrameRef.current = null;
    }

    dragPointerRef.current = null;
    lastDragAssistTargetRef.current = null;
  }, []);

  const scrollHeroTargetIntoViewForDrag = useCallback(
    (container: HTMLElement) => {
      const heroTarget = container.querySelector<HTMLElement>(
        "[data-download-drop-target='hero']"
      );
      if (!heroTarget) return;

      scrollPreviewTargetIntoView(container, heroTarget, "prefer-center");
    },
    []
  );

  const maybeRunHeroDragAssist = useCallback(
    (target: DragTarget | null) => {
      if (target?.kind !== "hero") {
        lastDragAssistTargetRef.current = target;
        return;
      }

      const previousTarget = lastDragAssistTargetRef.current;
      const isNewHeroTarget = previousTarget?.kind !== "hero";
      lastDragAssistTargetRef.current = target;

      if (!isNewHeroTarget) return;

      const container = pageRef.current;
      if (!container || !dragSourceRef.current) return;

      scrollHeroTargetIntoViewForDrag(container);
    },
    [scrollHeroTargetIntoViewForDrag]
  );

  const runDragEdgeAutoScroll = useCallback(() => {
    const container = pageRef.current;
    const pointer = dragPointerRef.current;

    if (!container || !pointer || !dragSourceRef.current) {
      dragEdgeScrollFrameRef.current = null;
      return;
    }

    const rect = container.getBoundingClientRect();
    const topZone = rect.top + DRAG_EDGE_SCROLL_ZONE_PX;
    const bottomZone = rect.bottom - DRAG_EDGE_SCROLL_ZONE_PX;
    let delta = 0;

    if (pointer.y < topZone) {
      const intensity = clamp(
        (topZone - pointer.y) / DRAG_EDGE_SCROLL_ZONE_PX,
        0,
        1
      );
      delta = -Math.max(
        DRAG_EDGE_SCROLL_MIN_STEP_PX,
        DRAG_EDGE_SCROLL_MAX_STEP_PX * intensity
      );
    } else if (pointer.y > bottomZone) {
      const intensity = clamp(
        (pointer.y - bottomZone) / DRAG_EDGE_SCROLL_ZONE_PX,
        0,
        1
      );
      delta = Math.max(
        DRAG_EDGE_SCROLL_MIN_STEP_PX,
        DRAG_EDGE_SCROLL_MAX_STEP_PX * intensity
      );
    }

    if (delta === 0) {
      dragEdgeScrollFrameRef.current = null;
      return;
    }

    const maxScrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight
    );
    const nextScrollTop = clamp(container.scrollTop + delta, 0, maxScrollTop);

    if (nextScrollTop === container.scrollTop) {
      dragEdgeScrollFrameRef.current = null;
      return;
    }

    container.scrollTop = nextScrollTop;

    const nextTarget = getDragTargetFromPoint(container, pointer.x, pointer.y);
    maybeRunHeroDragAssist(nextTarget);
    updateMouseDragPreviewRef.current?.(dragSourceRef.current, nextTarget);

    dragEdgeScrollFrameRef.current = globalThis.window.requestAnimationFrame(
      runDragEdgeAutoScroll
    );
  }, [maybeRunHeroDragAssist]);

  const updateDragEdgeAutoScroll = useCallback(
    (pointer: { x: number; y: number } | null) => {
      if (!pointer) {
        stopDragEdgeAutoScroll();
        return;
      }

      dragPointerRef.current = pointer;

      if (dragEdgeScrollFrameRef.current !== null) {
        return;
      }

      dragEdgeScrollFrameRef.current = globalThis.window.requestAnimationFrame(
        runDragEdgeAutoScroll
      );
    },
    [runDragEdgeAutoScroll, stopDragEdgeAutoScroll]
  );

  const getGameById = useCallback(
    (gameId: string) => {
      if (activeDownload?.id === gameId) return activeDownload.game;

      return (
        queuedById.get(gameId)?.game ?? pausedById.get(gameId)?.game ?? null
      );
    },
    [activeDownload, pausedById, queuedById]
  );

  const getOriginalPlacement = useCallback(
    (gameId: string): DragPlacement | null => {
      if (activeDownload?.id === gameId) return "hero";
      if (queuedById.has(gameId)) return "queue";
      if (pausedById.has(gameId)) return "paused";
      return null;
    },
    [activeDownload?.id, pausedById, queuedById]
  );

  const commitPreviewPlacement = useCallback(
    async (
      gameId: string,
      sourcePlacement: DragPlacement,
      targetPlacement: PreviewPlacement
    ) => {
      const game = getGameById(gameId);
      if (!game) return;

      if (targetPlacement.kind === "hero") {
        if (sourcePlacement === "hero") return;
        await startNow(game);
        return;
      }

      if (targetPlacement.kind === "paused") {
        if (sourcePlacement === "paused") {
          const sourceIndex = pausedDownloads.findIndex(
            (item) => item.id === gameId
          );
          if (sourceIndex === -1 || targetPlacement.index === sourceIndex)
            return;

          await setPausedDownloadPosition(game, targetPlacement.index);
          return;
        }

        await moveToPaused(game, targetPlacement.index);
        return;
      }

      if (sourcePlacement === "queue") {
        const sourceIndex = queuedDownloads.findIndex(
          (item) => item.id === gameId
        );
        if (sourceIndex === -1 || targetPlacement.index === sourceIndex) return;

        await setQueuedDownloadPosition(game, targetPlacement.index);
        return;
      }

      await sendToQueue(game, targetPlacement.index);
    },
    [
      getGameById,
      moveToPaused,
      pausedDownloads,
      queuedDownloads,
      sendToQueue,
      setPausedDownloadPosition,
      setQueuedDownloadPosition,
      startNow,
    ]
  );

  const commitDragTarget = useCallback(
    async (
      gameId: string,
      sourcePlacement: DragPlacement,
      targetPlacement: DragTarget
    ) => {
      const game = getGameById(gameId);
      if (!game) return;

      if (targetPlacement.kind === "hero") {
        if (sourcePlacement === "hero") return;
        await startNow(game);
        return;
      }

      if (targetPlacement.kind === "paused") {
        if (sourcePlacement === "paused") {
          const sourceIndex = pausedDownloads.findIndex(
            (item) => item.id === gameId
          );
          if (sourceIndex === -1) return;

          const targetIndex = getReorderedTargetIndex(
            targetPlacement.index,
            sourceIndex
          );

          if (targetIndex === sourceIndex) return;

          await setPausedDownloadPosition(game, targetIndex);
          return;
        }

        await moveToPaused(game, targetPlacement.index);
        return;
      }

      if (sourcePlacement === "queue") {
        const sourceIndex = queuedDownloads.findIndex(
          (item) => item.id === gameId
        );
        if (sourceIndex === -1) return;

        const targetIndex = getReorderedTargetIndex(
          targetPlacement.index,
          sourceIndex
        );
        if (targetIndex === sourceIndex) return;

        await setQueuedDownloadPosition(game, targetIndex);
        return;
      }

      await sendToQueue(game, targetPlacement.index);
    },
    [
      getGameById,
      moveToPaused,
      pausedDownloads,
      queuedDownloads,
      sendToQueue,
      setPausedDownloadPosition,
      setQueuedDownloadPosition,
      startNow,
    ]
  );

  const getBasePreviewLayoutState = useCallback(
    (sourceGameId: string): PreviewLayoutState => ({
      sourceGameId,
      heroId: activeDownload?.id ?? null,
      queueIds: queuedDownloads.map((item) => item.id),
      pausedIds: pausedDownloads.map((item) => item.id),
    }),
    [activeDownload?.id, pausedDownloads, queuedDownloads]
  );

  const beginOptimisticCommit = useCallback(
    (
      sourceGameId: string,
      sourcePlacement: DragPlacement,
      targetPlacement: PreviewPlacement
    ) => {
      const layout = buildPreviewLayoutState(
        getBasePreviewLayoutState(sourceGameId),
        sourcePlacement,
        targetPlacement,
        canPromoteToHero
      );
      const finalPlacement = getPreviewPlacement(layout, sourceGameId);

      if (!finalPlacement) return null;

      setOptimisticCommitState({
        sourceGameId,
        sourcePlacement,
        targetPlacement: finalPlacement,
        layout,
      });
      setPendingFocusId(
        getRepresentativeFocusIdForMoveTarget(sourceGameId, finalPlacement)
      );

      return {
        layout,
        finalPlacement,
      };
    },
    [canPromoteToHero, getBasePreviewLayoutState]
  );

  const updateMouseDragPreview = useCallback(
    (source: DragSourceData, target: DragTarget | null) => {
      setDragTarget((current) =>
        areTargetsEqual(current, target) ? current : target
      );

      if (!target) {
        setDragPreviewState(null);
        return;
      }

      const nextPreviewState = buildPreviewLayoutState(
        getBasePreviewLayoutState(source.gameId),
        source.placement,
        target,
        canPromoteToHero
      );

      setDragPreviewState((current) =>
        arePreviewLayoutsEqual(current, nextPreviewState)
          ? current
          : nextPreviewState
      );
    },
    [canPromoteToHero, getBasePreviewLayoutState]
  );

  useEffect(() => {
    updateMouseDragPreviewRef.current = updateMouseDragPreview;
  }, [updateMouseDragPreview]);

  const renderedData = useMemo(() => {
    if (!previewLayoutState) {
      return {
        active: activeDownload,
        queued: queuedDownloads,
        paused: pausedDownloads,
      };
    }

    const getListItemForPlacement = (
      gameId: string,
      placement: "queue" | "paused"
    ) => {
      if (activeDownload?.id === gameId) {
        return placement === "queue"
          ? activePreviewQueueItem
          : activePreviewPausedItem;
      }

      const original = queuedById.get(gameId) ?? pausedById.get(gameId);

      if (!original) return null;

      return buildPreviewRowItemFromListItem(original, placement);
    };

    const previewActive =
      previewLayoutState.heroId == null
        ? null
        : previewLayoutState.heroId === activeDownload?.id
          ? activeDownload
          : (() => {
              const sourceItem =
                queuedById.get(previewLayoutState.heroId) ??
                pausedById.get(previewLayoutState.heroId);

              return sourceItem
                ? buildPreviewHeroItemFromListItem(sourceItem)
                : null;
            })();

    return {
      active: previewActive,
      queued: previewLayoutState.queueIds
        .map((gameId) => getListItemForPlacement(gameId, "queue"))
        .filter(Boolean) as BigPictureDownloadListItem[],
      paused: previewLayoutState.pausedIds
        .map((gameId) => getListItemForPlacement(gameId, "paused"))
        .filter(Boolean) as BigPictureDownloadListItem[],
    };
  }, [
    activeDownload,
    activePreviewPausedItem,
    activePreviewQueueItem,
    previewLayoutState,
    pausedById,
    pausedDownloads,
    queuedById,
    queuedDownloads,
  ]);

  const renderedActiveDownload = renderedData.active;
  const renderedQueuedDownloads = renderedData.queued;
  const renderedPausedDownloads = renderedData.paused;
  const isHeroOptimisticLoading =
    Boolean(optimisticCommitState) &&
    optimisticCommitState?.targetPlacement.kind === "hero" &&
    optimisticCommitState.sourceGameId === renderedActiveDownload?.id &&
    activeDownload?.id !== renderedActiveDownload?.id;
  const isHeroMovePreviewActive =
    (Boolean(moveMode) &&
      moveMode?.moveTarget.kind === "hero" &&
      moveMode?.sourcePlacement !== "hero") ||
    (Boolean(dragPreviewState) &&
      dragTarget?.kind === "hero" &&
      dragSource?.placement !== "hero");
  const neutralNetworkStats = useMemo<BigPictureDownloadsNetworkStats>(() => {
    const sampleCount = Math.max(networkStats.speedHistory.length, 1);

    return {
      speedLabel: "0 B/s",
      peakSpeedLabel: "0 B/s",
      speedHistory: Array.from({ length: sampleCount }, () => 0),
      speedHistoryLabels: Array.from({ length: sampleCount }, () => "0 B/s"),
      seeds: null,
      peers: null,
      showSeedsAndPeers: false,
    };
  }, [networkStats.speedHistory.length]);
  const targetActiveHeroSnapshot = useMemo<DownloadsHeroSnapshot | null>(() => {
    const sourceDownload =
      isHeroOptimisticLoading && renderedActiveDownload
        ? renderedActiveDownload
        : activeDownload;
    if (!sourceDownload) return null;

    const backgroundImageUrl = getDownloadCoverImageUrl(sourceDownload.game);
    const logoImageUrl = getDownloadLogoImageUrl(sourceDownload.game);

    return {
      id: sourceDownload.id,
      title: sourceDownload.title,
      href: sourceDownload.href,
      backgroundImageUrl,
      logoImageUrl,
      accentImageUrl: backgroundImageUrl,
      accentColor: null,
      pauseOrResumeLabel:
        sourceDownload.pauseOrResumeAction === "resume"
          ? "Resume Download"
          : "Pause Download",
      canPauseOrResume: isHeroOptimisticLoading
        ? false
        : (activeDownload?.canPauseOrResume ?? false),
      progressPanel: {
        title: isHeroOptimisticLoading
          ? "Starting Download"
          : sourceDownload.pauseOrResumeAction === "resume"
            ? "Paused Download"
            : "Download In Progress",
        progress: isHeroOptimisticLoading ? 0 : (activeDownload?.progress ?? 0),
        progressLabel: isHeroOptimisticLoading
          ? "0%"
          : (activeDownload?.progressLabel ?? "0%"),
        transferLabel: isHeroOptimisticLoading
          ? "-- / --"
          : (activeDownload?.transferLabel ?? "-- / --"),
        etaLabel: isHeroOptimisticLoading
          ? "--"
          : (activeDownload?.etaLabel ?? "--"),
      },
      networkPanel: {
        ...(isHeroOptimisticLoading ? neutralNetworkStats : networkStats),
        downloaderLabel: isHeroOptimisticLoading
          ? null
          : (activeDownload?.metaLabel ?? null),
      },
      mode: isHeroOptimisticLoading ? "preview" : "normal",
    };
  }, [
    activeDownload,
    isHeroOptimisticLoading,
    networkStats,
    neutralNetworkStats,
    renderedActiveDownload,
  ]);
  const targetPreviewHeroSnapshot =
    useMemo<DownloadsHeroSnapshot | null>(() => {
      if (!isHeroMovePreviewActive || !renderedActiveDownload) {
        return null;
      }

      const backgroundImageUrl = getDownloadCoverImageUrl(
        renderedActiveDownload.game
      );
      const logoImageUrl = getDownloadLogoImageUrl(renderedActiveDownload.game);

      return {
        id: renderedActiveDownload.id,
        title: renderedActiveDownload.title,
        href: renderedActiveDownload.href,
        backgroundImageUrl,
        logoImageUrl,
        accentImageUrl: backgroundImageUrl,
        accentColor: null,
        pauseOrResumeLabel: "Pause Download",
        canPauseOrResume: false,
        progressPanel: {
          title: "Move Preview",
          progress: 0,
          progressLabel: "0%",
          transferLabel: "-- / --",
          etaLabel: "--",
        },
        networkPanel: {
          ...neutralNetworkStats,
          downloaderLabel: null,
        },
        mode: "preview",
      };
    }, [isHeroMovePreviewActive, neutralNetworkStats, renderedActiveDownload]);
  const targetHeroSnapshot =
    targetPreviewHeroSnapshot ?? targetActiveHeroSnapshot;
  const {
    displayedSnapshot: displayedHeroSnapshot,
    backgroundLayers: heroBackgroundLayers,
    getLayerEventHandlers: getHeroLayerEventHandlers,
    isTransitioning: isHeroSnapshotTransitioning,
  } = useDownloadsHeroDisplayState(targetHeroSnapshot);
  const heroPanelState = displayedHeroSnapshot ?? null;
  const heroInteractionDisabled = Boolean(
    interactionsLocked ||
      isHeroSnapshotTransitioning ||
      displayedHeroSnapshot?.mode !== "normal"
  );
  const isHeroOptimisticCommitPending = Boolean(
    optimisticCommitState &&
      optimisticCommitState.targetPlacement.kind === "hero" &&
      (displayedHeroSnapshot?.id !== optimisticCommitState.sourceGameId ||
        displayedHeroSnapshot?.mode !== "normal" ||
        isHeroSnapshotTransitioning)
  );
  const mainNavigationOverridesByFocusId = useMemo(() => {
    const heroFocusIds = displayedHeroSnapshot ? [getHeroPrimaryFocusId()] : [];
    const queueFocusIds = renderedQueuedDownloads.map((item) =>
      getDownloadMainFocusId(item.id)
    );
    const pausedFocusIds = renderedPausedDownloads.map((item) =>
      getDownloadMainFocusId(item.id)
    );
    const completedFocusIds = completedDownloads.map((item) =>
      getDownloadMainFocusId(item.id)
    );

    return buildDownloadsMainNavigationOverrides([
      heroFocusIds,
      queueFocusIds,
      pausedFocusIds,
      completedFocusIds,
    ]);
  }, [
    completedDownloads,
    displayedHeroSnapshot,
    renderedPausedDownloads,
    renderedQueuedDownloads,
  ]);
  const firstVisibleListFocusId =
    renderedQueuedDownloads[0]?.id != null
      ? getDownloadMainFocusId(renderedQueuedDownloads[0].id)
      : renderedPausedDownloads[0]?.id != null
        ? getDownloadMainFocusId(renderedPausedDownloads[0].id)
        : completedDownloads[0]?.id != null
          ? getDownloadMainFocusId(completedDownloads[0].id)
          : undefined;
  const moveModePreviewPlacement = useMemo(
    () =>
      moveMode ? getPreviewPlacement(moveMode, moveMode.sourceGameId) : null,
    [moveMode]
  );
  const moveModePreviewPlacementKey = useMemo(
    () =>
      moveMode ? getPreviewPlacementKey(moveMode, moveMode.sourceGameId) : null,
    [moveMode]
  );
  const moveModeTargetFocusId = useMemo(() => {
    if (!moveMode) return null;

    const previewPlacement = moveModePreviewPlacement;

    if (!previewPlacement) return null;

    return previewPlacement.kind === "hero"
      ? getHeroPrimaryFocusId()
      : getDownloadMainFocusId(moveMode.sourceGameId);
  }, [moveModePreviewPlacement, moveMode?.sourceGameId]);
  const isCrossSectionMoveModePreview = useMemo(() => {
    const previousKind = previousMoveModePlacementKindRef.current;
    const currentKind = moveModePreviewPlacement?.kind ?? null;

    if (!previousKind || !currentKind || previousKind === currentKind) {
      return false;
    }

    return (
      (previousKind === "queue" && currentKind === "paused") ||
      (previousKind === "paused" && currentKind === "queue")
    );
  }, [moveModePreviewPlacement?.kind]);
  const dragPreviewPlacementKey = useMemo(
    () =>
      dragPreviewState && dragSource
        ? getPreviewPlacementKey(dragPreviewState, dragSource.gameId)
        : null,
    [dragPreviewState, dragSource]
  );

  const visibleMainFocusIds = useMemo(() => {
    const ids: string[] = [];

    if (displayedHeroSnapshot) {
      ids.push(getHeroPrimaryFocusId());
    }

    renderedQueuedDownloads.forEach((item) => {
      ids.push(getDownloadMainFocusId(item.id));
    });

    renderedPausedDownloads.forEach((item) => {
      ids.push(getDownloadMainFocusId(item.id));
    });

    completedDownloads.forEach((item) => {
      ids.push(getDownloadMainFocusId(item.id));
    });

    return ids;
  }, [
    completedDownloads,
    displayedHeroSnapshot,
    renderedPausedDownloads,
    renderedQueuedDownloads,
  ]);

  const getRemovalFallbackFocusId = useCallback(
    (sourceSection: DownloadSection, removedGameId: string) => {
      const queueIds = renderedQueuedDownloads.map((item) => item.id);
      const pausedIds = renderedPausedDownloads.map((item) => item.id);
      const completedIds = completedDownloads.map((item) => item.id);

      const sameSectionFocusId =
        sourceSection === "queue"
          ? getNextFocusIdInSection(queueIds, removedGameId)
          : sourceSection === "paused"
            ? getNextFocusIdInSection(pausedIds, removedGameId)
            : sourceSection === "completed"
              ? getNextFocusIdInSection(completedIds, removedGameId)
              : null;

      if (sameSectionFocusId) {
        return sameSectionFocusId;
      }

      const getFirstFocusId = (gameIds: string[]) =>
        gameIds[0] ? getDownloadMainFocusId(gameIds[0]) : null;

      if (sourceSection === "hero") {
        return (
          getFirstFocusId(queueIds) ??
          getFirstFocusId(pausedIds) ??
          getFirstFocusId(completedIds) ??
          null
        );
      }

      if (sourceSection === "queue") {
        return (
          getFirstFocusId(pausedIds) ??
          getFirstFocusId(completedIds) ??
          (displayedHeroSnapshot ? getHeroPrimaryFocusId() : null)
        );
      }

      if (sourceSection === "paused") {
        return (
          getFirstFocusId(queueIds) ??
          getFirstFocusId(completedIds) ??
          (displayedHeroSnapshot ? getHeroPrimaryFocusId() : null)
        );
      }

      return (
        getFirstFocusId(pausedIds) ??
        getFirstFocusId(queueIds) ??
        (displayedHeroSnapshot ? getHeroPrimaryFocusId() : null)
      );
    },
    [
      completedDownloads,
      displayedHeroSnapshot,
      renderedPausedDownloads,
      renderedQueuedDownloads,
    ]
  );

  const handleRemovalCancel = useCallback(
    async (
      game: LibraryGame,
      section: Exclude<DownloadSection, "completed">
    ) => {
      const nextFocusId = getRemovalFallbackFocusId(section, game.id);

      await cancelDownload(game);

      if (nextFocusId) {
        setPendingFocusId(nextFocusId);
      }
    },
    [cancelDownload, getRemovalFallbackFocusId]
  );

  const handleCompletedRemoval = useCallback(
    async (game: LibraryGame) => {
      const nextFocusId = getRemovalFallbackFocusId("completed", game.id);

      await removeDownload(game);

      if (nextFocusId) {
        setPendingFocusId(nextFocusId);
      }
    },
    [getRemovalFallbackFocusId, removeDownload]
  );

  useEffect(() => {
    if (!pendingFocusId) return;
    if (!visibleMainFocusIds.includes(pendingFocusId)) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(pendingFocusId);

      if (!isHeroOptimisticCommitPending) {
        setPendingFocusId(null);
      }
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [
    isHeroOptimisticCommitPending,
    pendingFocusId,
    setFocus,
    visibleMainFocusIds,
  ]);

  useEffect(() => {
    if (currentFocusRegionId !== BIG_PICTURE_HEADER_REGION_ID) return;

    const pageElement = pageRef.current;
    if (!pageElement || pageElement.scrollTop <= 0) return;

    pageElement.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }, [currentFocusRegionId]);

  useEffect(() => {
    if (!moveModePreviewPlacementKey) return;
    if (!moveModeTargetFocusId) return;
    if (!visibleMainFocusIds.includes(moveModeTargetFocusId)) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(moveModeTargetFocusId);
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [
    moveModePreviewPlacementKey,
    moveModeTargetFocusId,
    setFocus,
    visibleMainFocusIds,
  ]);

  useEffect(() => {
    if (
      !moveMode ||
      !moveModePreviewPlacementKey ||
      !isCrossSectionMoveModePreview
    ) {
      return;
    }

    const root = pageRef.current;
    if (!root) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      const target = resolvePreviewTargetElement(
        root,
        moveMode,
        moveMode.sourceGameId
      );
      if (!target) return;

      scrollPreviewTargetIntoView(root, target, "prefer-center", {
        centerThreshold: MOVE_MODE_CROSS_SECTION_CENTER_THRESHOLD,
      });
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [isCrossSectionMoveModePreview, moveMode, moveModePreviewPlacementKey]);

  useEffect(() => {
    previousMoveModePlacementKindRef.current =
      moveModePreviewPlacement?.kind ?? null;
  }, [moveModePreviewPlacement?.kind]);

  useEffect(() => {
    dragSourceRef.current = dragSource;
  }, [dragSource]);

  useEffect(() => stopDragEdgeAutoScroll, [stopDragEdgeAutoScroll]);

  useEffect(() => {
    if (!dragSource) return;

    const handlePointerMove = (event: PointerEvent) => {
      updateDragEdgeAutoScroll({
        x: event.clientX,
        y: event.clientY,
      });
    };

    globalThis.window.addEventListener("pointermove", handlePointerMove);

    return () => {
      globalThis.window.removeEventListener("pointermove", handlePointerMove);
      stopDragEdgeAutoScroll();
    };
  }, [dragSource, stopDragEdgeAutoScroll, updateDragEdgeAutoScroll]);

  useEffect(() => {
    if (!optimisticCommitState) return;

    const actualLayout = getBasePreviewLayoutState(
      optimisticCommitState.sourceGameId
    );

    if (optimisticCommitState.targetPlacement.kind === "hero") {
      if (
        displayedHeroSnapshot?.id === optimisticCommitState.sourceGameId &&
        displayedHeroSnapshot.mode === "normal" &&
        !isHeroSnapshotTransitioning
      ) {
        setOptimisticCommitState(null);
        if (pendingFocusId === getHeroPrimaryFocusId()) {
          setPendingFocusId(null);
        }
      }

      return;
    }

    if (arePreviewLayoutsEqual(actualLayout, optimisticCommitState.layout)) {
      setOptimisticCommitState(null);
    }
  }, [
    displayedHeroSnapshot,
    getBasePreviewLayoutState,
    isHeroSnapshotTransitioning,
    optimisticCommitState,
    pendingFocusId,
  ]);

  useEffect(() => {
    if (!dragPreviewState || !dragSource || !dragPreviewPlacementKey) return;

    const root = pageRef.current;
    if (!root) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      const target = resolvePreviewTargetElement(
        root,
        dragPreviewState,
        dragSource.gameId
      );
      if (!target) return;

      scrollPreviewTargetIntoView(
        root,
        target,
        dragTarget?.kind === "hero" ? "prefer-center" : "keep-visible"
      );
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [dragPreviewPlacementKey, dragPreviewState, dragSource, dragTarget?.kind]);

  const beginMoveMode = useCallback(
    (gameId: string) => {
      if (moveMode) return;

      const placement = getOriginalPlacement(gameId);
      if (!placement) return;

      if (placement === "hero" && !activeDownload?.canMoveFromHero) {
        return;
      }

      setMoveMode({
        sourceGameId: gameId,
        sourcePlacement: placement,
        moveTarget:
          placement === "hero"
            ? getTargetForPlacement("hero", 0)
            : getTargetForPlacement(
                placement,
                placement === "queue"
                  ? queuedDownloads.findIndex((item) => item.id === gameId)
                  : pausedDownloads.findIndex((item) => item.id === gameId)
              ),
        originalHeroId: activeDownload?.id ?? null,
        originalQueueIds: queuedDownloads.map((item) => item.id),
        originalPausedIds: pausedDownloads.map((item) => item.id),
        heroId: activeDownload?.id ?? null,
        queueIds: queuedDownloads.map((item) => item.id),
        pausedIds: pausedDownloads.map((item) => item.id),
        isCommitting: false,
      });
    },
    [
      activeDownload,
      getOriginalPlacement,
      moveMode,
      pausedDownloads,
      queuedDownloads,
    ]
  );

  const cancelMoveMode = useCallback(() => {
    if (!moveMode) return;

    setPendingFocusId(
      getRepresentativeFocusIdForPlacement(
        moveMode.sourcePlacement,
        moveMode.sourceGameId
      )
    );
    setMoveMode(null);
  }, [moveMode]);

  const stepMoveMode = useCallback(
    (direction: "up" | "down") => {
      setMoveMode((current) => {
        if (!current || current.isCommitting) return current;
        const nextTarget = getNextMoveTarget(
          current,
          direction,
          canPromoteToHero
        );
        if (!nextTarget) return current;

        return applyPreviewPlacementToMoveModeState(
          current,
          nextTarget,
          canPromoteToHero
        );
      });
    },
    [canPromoteToHero]
  );

  const confirmMoveMode = useCallback(async () => {
    if (!moveMode || moveMode.isCommitting) return;

    const finalPlacement = getPreviewPlacement(moveMode, moveMode.sourceGameId);
    if (!finalPlacement) return;

    const isSamePlacement =
      moveMode.heroId === moveMode.originalHeroId &&
      areIdListsEqual(moveMode.queueIds, moveMode.originalQueueIds) &&
      areIdListsEqual(moveMode.pausedIds, moveMode.originalPausedIds);

    if (isSamePlacement) {
      setPendingFocusId(
        getRepresentativeFocusIdForPlacement(
          moveMode.sourcePlacement,
          moveMode.sourceGameId
        )
      );
      setMoveMode(null);
      return;
    }

    setMoveMode((current) =>
      current ? { ...current, isCommitting: true } : current
    );

    const optimisticCommit = beginOptimisticCommit(
      moveMode.sourceGameId,
      moveMode.sourcePlacement,
      finalPlacement
    );

    try {
      await commitPreviewPlacement(
        moveMode.sourceGameId,
        moveMode.sourcePlacement,
        finalPlacement
      );
    } catch (error) {
      setOptimisticCommitState(null);
      setPendingFocusId(
        getRepresentativeFocusIdForPlacement(
          moveMode.sourcePlacement,
          moveMode.sourceGameId
        )
      );
      throw error;
    } finally {
      if (!optimisticCommit) {
        setPendingFocusId(
          getRepresentativeFocusIdForMoveTarget(
            moveMode.sourceGameId,
            finalPlacement
          )
        );
      }
      setMoveMode(null);
    }
  }, [beginOptimisticCommit, commitPreviewPlacement, moveMode]);

  useNavigationScreenActions(
    moveMode
      ? {
          press: {
            a: () => {
              void confirmMoveMode();
            },
            b: () => {
              cancelMoveMode();
            },
          },
          direction: {
            up: () => stepMoveMode("up"),
            down: () => stepMoveMode("down"),
            left: () => {},
            right: () => {},
          },
        }
      : {}
  );

  const handleOpen = (href: string) => {
    if (moveMode) return;

    if (suppressOpenRef.current) {
      suppressOpenRef.current = false;
      return;
    }

    navigate(href);
  };

  const closeDownloadMenu = useCallback(() => {
    setMenuState((current) => ({
      ...current,
      visible: false,
      item: null,
      section: null,
    }));
  }, []);

  const openDownloadMenu = useCallback(
    (
      item: BigPictureDownloadListItem,
      section: "queue" | "paused" | "completed",
      position: { x: number; y: number },
      restoreFocusId: string
    ) => {
      setMenuState({
        item,
        section,
        position,
        restoreFocusId,
        visible: true,
      });
    },
    []
  );

  const heroPauseTargetDownload =
    displayedHeroSnapshot?.mode === "normal" &&
    activeDownload?.id === displayedHeroSnapshot.id
      ? activeDownload
      : null;

  const handleHeroCancel = useCallback(async () => {
    if (!heroPauseTargetDownload) return;

    const nextFocusId = getRemovalFallbackFocusId(
      "hero",
      heroPauseTargetDownload.id
    );

    await cancelDownload(heroPauseTargetDownload.game);

    if (nextFocusId) {
      setPendingFocusId(nextFocusId);
    }
  }, [cancelDownload, getRemovalFallbackFocusId, heroPauseTargetDownload]);

  const downloadMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menuState.item || !menuState.section) return [];

    const item = menuState.item;

    if (menuState.section === "queue") {
      return [
        {
          id: "move-to-paused",
          label: "Pause",
          disabled: interactionsLocked,
          onSelect: () => moveToPaused(item.game),
        },
        {
          id: "cancel",
          label: "Cancel",
          danger: true,
          disabled: interactionsLocked,
          restoreFocusOnClose: false,
          onSelect: () => handleRemovalCancel(item.game, "queue"),
        },
      ];
    }

    if (menuState.section === "paused") {
      return [
        {
          id: "cancel",
          label: "Cancel",
          danger: true,
          disabled: interactionsLocked,
          restoreFocusOnClose: false,
          onSelect: () => handleRemovalCancel(item.game, "paused"),
        },
      ];
    }

    return [
      ...(item.seedAction
        ? [
            {
              id: "toggle-seeding",
              label:
                item.seedAction === "pause" ? "Stop Seeding" : "Resume Seeding",
              disabled: interactionsLocked,
              onSelect: () => {
                if (item.seedAction === "pause") {
                  return pauseSeeding(item.game);
                }

                return resumeSeeding(item.game);
              },
            } satisfies ContextMenuItem,
          ]
        : []),
      ...(item.canRemove
        ? [
            {
              id: "remove",
              label: "Remove",
              danger: true,
              disabled: interactionsLocked,
              restoreFocusOnClose: false,
              onSelect: () => handleCompletedRemoval(item.game),
            } satisfies ContextMenuItem,
          ]
        : []),
    ];
  }, [
    canPromoteToHero,
    handleCompletedRemoval,
    handleRemovalCancel,
    interactionsLocked,
    menuState.item,
    menuState.section,
    moveQueuedDownload,
    moveToPaused,
    pauseSeeding,
    resumeSeeding,
    sendToQueue,
    startNow,
  ]);

  useEffect(() => {
    if (moveMode) return;

    const root = pageRef.current;

    if (!root) return;

    const cleanupFns: Array<() => void> = [];

    const sourceElements = Array.from(
      root.querySelectorAll<HTMLElement>("[data-download-drag-source='true']")
    );

    for (const element of sourceElements) {
      const gameId = element.dataset.gameId;
      const placement = element.dataset.dragPlacement;

      if (!gameId) continue;
      if (
        placement !== "hero" &&
        placement !== "queue" &&
        placement !== "paused"
      ) {
        continue;
      }

      cleanupFns.push(
        draggable({
          element,
          canDrag: () => {
            if (placement === "hero") {
              return Boolean(activeDownload?.canMoveFromHero);
            }

            return true;
          },
          getInitialData: () => ({
            gameId,
            placement,
          }),
        })
      );
    }

    const listContainerElements = Array.from(
      root.querySelectorAll<HTMLElement>(
        "[data-download-drop-role='container']"
      )
    );

    for (const element of listContainerElements) {
      cleanupFns.push(
        dropTargetForElements({
          element,
          getIsSticky: () => true,
          canDrop: ({ source }) => {
            if (!isDragSourceData(source.data)) return false;
            if (source.data.placement === "hero") {
              return Boolean(activeDownload?.canMoveFromHero);
            }
            return true;
          },
          getData: ({ element: dropElement }) => {
            const targetElement = dropElement as HTMLElement;
            const placement = targetElement.dataset.dropPlacement;
            const rawIndex = targetElement.dataset.dropIndex;
            const index = Number(rawIndex ?? "0");

            if (
              (placement !== "queue" && placement !== "paused") ||
              Number.isNaN(index)
            ) {
              return {};
            }

            return {
              kind: placement,
              index,
            };
          },
        })
      );
    }

    const cardTargetElements = Array.from(
      root.querySelectorAll<HTMLElement>("[data-download-drop-role='card']")
    );

    for (const element of cardTargetElements) {
      cleanupFns.push(
        dropTargetForElements({
          element,
          getIsSticky: () => true,
          canDrop: ({ source }) => {
            if (!isDragSourceData(source.data)) return false;
            if (source.data.placement === "hero") {
              return Boolean(activeDownload?.canMoveFromHero);
            }
            return true;
          },
          getData: ({ element: dropElement, input }) => {
            const targetElement = dropElement as HTMLElement;
            const placement = targetElement.dataset.dropPlacement;
            const rawIndex = targetElement.dataset.dropIndex;
            const index = Number(rawIndex ?? "0");

            if (
              (placement !== "queue" && placement !== "paused") ||
              Number.isNaN(index)
            ) {
              return {};
            }

            const bounds = targetElement.getBoundingClientRect();
            const midpoint = bounds.top + bounds.height / 2;
            const insertionIndex = index + (input.clientY >= midpoint ? 1 : 0);

            return {
              kind: placement,
              index: insertionIndex,
            };
          },
        })
      );
    }

    const heroTargetElement = root.querySelector<HTMLElement>(
      "[data-download-drop-target='hero']"
    );

    if (heroTargetElement) {
      cleanupFns.push(
        dropTargetForElements({
          element: heroTargetElement,
          getIsSticky: () => true,
          canDrop: ({ source }) => {
            if (!isDragSourceData(source.data)) return false;
            if (source.data.placement === "hero") return false;

            return canPromoteToHero;
          },
          getData: () => ({
            kind: "hero",
          }),
        })
      );
    }

    cleanupFns.push(
      monitorForElements({
        canMonitor: ({ source }) => isDragSourceData(source.data),
        onDragStart: ({ source }) => {
          if (!isDragSourceData(source.data)) return;
          setDragSource(source.data);
          lastDragAssistTargetRef.current = null;
          updateMouseDragPreview(source.data, null);
        },
        onDrag: ({ source, location }) => {
          if (!isDragSourceData(source.data)) return;

          const currentTarget = location.current.dropTargets[0]?.data
            ? getDragTargetFromData(location.current.dropTargets[0].data)
            : null;

          maybeRunHeroDragAssist(currentTarget);
          updateMouseDragPreview(source.data, currentTarget);
        },
        onDropTargetChange: ({ source, location }) => {
          if (!isDragSourceData(source.data)) return;

          const currentTarget = location.current.dropTargets[0]?.data
            ? getDragTargetFromData(location.current.dropTargets[0].data)
            : null;

          maybeRunHeroDragAssist(currentTarget);
          updateMouseDragPreview(source.data, currentTarget);
        },
        onDrop: ({ source, location }) => {
          stopDragEdgeAutoScroll();
          setDragSource(null);
          setDragTarget(null);
          setDragPreviewState(null);

          if (!isDragSourceData(source.data)) return;
          const dragSourceData = source.data;

          const resolvedTarget = location.current.dropTargets[0]?.data
            ? getDragTargetFromData(location.current.dropTargets[0].data)
            : null;

          if (!resolvedTarget) return;

          suppressOpenRef.current = true;
          const optimisticCommit = beginOptimisticCommit(
            dragSourceData.gameId,
            dragSourceData.placement,
            resolvedTarget.kind === "hero"
              ? resolvedTarget
              : {
                  kind: resolvedTarget.kind,
                  index: resolvedTarget.index,
                }
          );

          void commitDragTarget(
            dragSourceData.gameId,
            dragSourceData.placement,
            resolvedTarget
          )
            .catch(() => {
              setOptimisticCommitState(null);
              setPendingFocusId(
                getRepresentativeFocusIdForPlacement(
                  dragSourceData.placement,
                  dragSourceData.gameId
                )
              );
            })
            .finally(() => {
              if (!optimisticCommit) {
                setPendingFocusId(
                  getRepresentativeFocusIdForMoveTarget(
                    dragSourceData.gameId,
                    resolvedTarget
                  )
                );
              }
              globalThis.window.setTimeout(() => {
                suppressOpenRef.current = false;
              }, 0);
            });
        },
      })
    );

    return combine(...cleanupFns);
  }, [
    activeDownload?.canMoveFromHero,
    canPromoteToHero,
    beginOptimisticCommit,
    commitDragTarget,
    maybeRunHeroDragAssist,
    moveMode,
    stopDragEdgeAutoScroll,
    updateMouseDragPreview,
  ]);

  const getDownloadCardFocusActions = useCallback(
    (
      itemId: string,
      canEnterMoveMode: boolean,
      listItem: BigPictureDownloadListItem,
      section: "queue" | "paused" | "completed",
      optionsDisabled: boolean
    ): FocusItemActions => ({
      primary: moveMode ? "off" : "auto",
      press: {
        x:
          canEnterMoveMode && !moveMode
            ? () => {
                beginMoveMode(itemId);
              }
            : undefined,
        y:
          optionsDisabled || moveMode
            ? undefined
            : () => {
                const optionsFocusId = getDownloadOptionsActionFocusId(itemId);
                const element =
                  globalThis.document.getElementById(optionsFocusId);
                if (!(element instanceof HTMLElement)) return;

                openDownloadMenu(
                  listItem,
                  section,
                  getDownloadMenuPosition(element),
                  optionsFocusId
                );
              },
      },
    }),
    [beginMoveMode, moveMode, openDownloadMenu]
  );

  const grabbedGameId = moveMode?.sourceGameId ?? null;

  if (!hasDownloads) {
    return (
      <div className="downloads-page downloads-page--empty">
        <div className="downloads-page__empty-state">
          <Typography variant="h2">No downloads yet</Typography>
          <Typography className="downloads-page__empty-copy">
            Start a download to see it here.
          </Typography>
        </div>
      </div>
    );
  }

  return (
    <VerticalFocusGroup regionId={DOWNLOADS_PAGE_REGION_ID} asChild>
      <div
        ref={pageRef}
        className="downloads-page"
        data-suppress-navigation-autoscroll={
          isCrossSectionMoveModePreview ? "true" : undefined
        }
      >
        <>
          <DownloadsHero
            snapshot={displayedHeroSnapshot}
            backgroundLayers={heroBackgroundLayers}
            getLayerEventHandlers={getHeroLayerEventHandlers}
            navigationOrder={DOWNLOADS_REGION_NAVIGATION_ORDER.hero}
            isInteractive={!heroInteractionDisabled}
            onPauseOrResume={() => {
              if (!heroPauseTargetDownload) return;
              if (heroPauseTargetDownload.pauseOrResumeAction === "resume") {
                void resumeDownload(heroPauseTargetDownload.game);
                return;
              }

              void pauseDownload(heroPauseTargetDownload.game);
            }}
            onCancel={() => {
              void handleHeroCancel();
            }}
            onOpenDetails={() => {
              if (!displayedHeroSnapshot) return;
              handleOpen(displayedHeroSnapshot.href);
            }}
            isMoveGrabbed={
              Boolean(displayedHeroSnapshot) &&
              grabbedGameId === displayedHeroSnapshot?.id
            }
            isDragSource={
              Boolean(displayedHeroSnapshot) && !heroInteractionDisabled
            }
            isDragging={dragSource?.gameId === displayedHeroSnapshot?.id}
            isDropActive={areTargetsEqual(dragTarget, { kind: "hero" })}
            isDropDisabled={Boolean(displayedHeroSnapshot && !canPromoteToHero)}
            isMoveModeActive={Boolean(moveMode)}
            nextListFocusId={firstVisibleListFocusId}
          />

          <div className="downloads-page__hero-stats-stack">
            <DownloadsProgressStats
              title={heroPanelState?.progressPanel.title ?? "Waiting Download"}
              progress={heroPanelState?.progressPanel.progress ?? 0}
              progressLabel={
                heroPanelState?.progressPanel.progressLabel ?? "0%"
              }
              transferLabel={
                heroPanelState?.progressPanel.transferLabel ?? "-- / --"
              }
              etaLabel={heroPanelState?.progressPanel.etaLabel ?? "--"}
              accentColor={displayedHeroSnapshot?.accentColor ?? undefined}
            />

            <DownloadsNetworkStats
              speedLabel={heroPanelState?.networkPanel.speedLabel ?? "0 B/s"}
              peakSpeedLabel={
                heroPanelState?.networkPanel.peakSpeedLabel ?? "0 B/s"
              }
              speedHistory={
                heroPanelState?.networkPanel.speedHistory ??
                neutralNetworkStats.speedHistory
              }
              speedHistoryLabels={
                heroPanelState?.networkPanel.speedHistoryLabels ??
                neutralNetworkStats.speedHistoryLabels
              }
              downloaderLabel={
                heroPanelState?.networkPanel.downloaderLabel ?? null
              }
              seeds={heroPanelState?.networkPanel.seeds ?? null}
              peers={heroPanelState?.networkPanel.peers ?? null}
              showSeedsAndPeers={
                heroPanelState?.networkPanel.showSeedsAndPeers ?? false
              }
              accentColor={displayedHeroSnapshot?.accentColor ?? undefined}
            />
          </div>
        </>

        <Section title="Queued" count={renderedQueuedDownloads.length}>
          <VerticalFocusGroup
            className="downloads-page__list"
            navigationOrder={DOWNLOADS_REGION_NAVIGATION_ORDER.queue}
            data-download-drop-role="container"
            data-download-drop-target="queue"
            data-drop-placement="queue"
            data-drop-index={renderedQueuedDownloads.length}
          >
            {renderedQueuedDownloads.length === 0 ? (
              <div
                className={cx(
                  "downloads-page__drop-target-shell downloads-page__queue-empty-shell",
                  areTargetsEqual(dragTarget, { kind: "queue", index: 0 }) &&
                    "downloads-page__drop-target--active"
                )}
              >
                <Typography className="downloads-page__empty-copy">
                  Drag downloads here to line them up for automatic start.
                </Typography>
              </div>
            ) : null}

            {renderedQueuedDownloads.map((item, index) => (
              <DownloadsGameCard
                key={item.id}
                gameId={item.id}
                variant="queue"
                title={item.title}
                coverImageUrl={item.coverImageUrl}
                logoImageUrl={getDownloadLogoImageUrl(item.game)}
                metaLabel={item.metaLabel}
                secondaryLabel={item.secondaryLabel}
                progress={item.progress}
                progressLabel={item.progressLabel}
                onOpen={() => handleOpen(item.href)}
                onPrimaryAction={() => moveToPaused(item.game)}
                primaryActionLabel="Pause"
                primaryActionDisabled={interactionsLocked}
                onOpenOptions={(event) => {
                  openDownloadMenu(
                    item,
                    "queue",
                    getDownloadMenuPosition(event.currentTarget),
                    getDownloadOptionsActionFocusId(item.id)
                  );
                }}
                optionsDisabled={interactionsLocked}
                dragPlacement={!moveMode ? "queue" : undefined}
                dropPlacement="queue"
                dropIndex={index}
                navigationOrder={index}
                isDragging={dragSource?.gameId === item.id}
                focusId={getDownloadMainFocusId(item.id)}
                navigationOverrides={
                  mainNavigationOverridesByFocusId[
                    getDownloadMainFocusId(item.id)
                  ]
                }
                focusActions={getDownloadCardFocusActions(
                  item.id,
                  true,
                  item,
                  "queue",
                  interactionsLocked
                )}
                isMoveGrabbed={grabbedGameId === item.id}
                primaryActionFocusId={getDownloadPrimaryActionFocusId(item.id)}
                optionsFocusId={getDownloadOptionsActionFocusId(item.id)}
              />
            ))}
          </VerticalFocusGroup>
        </Section>

        <Section title="Paused" count={renderedPausedDownloads.length}>
          <VerticalFocusGroup
            className="downloads-page__list"
            navigationOrder={DOWNLOADS_REGION_NAVIGATION_ORDER.paused}
            data-download-drop-role="container"
            data-download-drop-target="paused"
            data-drop-placement="paused"
            data-drop-index={renderedPausedDownloads.length}
          >
            {renderedPausedDownloads.length === 0 ? (
              <div
                className={cx(
                  "downloads-page__drop-target-shell",
                  "downloads-page__paused-drop-shell",
                  areTargetsEqual(dragTarget, { kind: "paused", index: 0 }) &&
                    "downloads-page__drop-target--active"
                )}
              >
                <Typography className="downloads-page__empty-copy">
                  Downloads you pause manually will stay here until you move
                  them.
                </Typography>
              </div>
            ) : null}

            {renderedPausedDownloads.map((item, index) => (
              <DownloadsGameCard
                key={item.id}
                gameId={item.id}
                variant="paused"
                title={item.title}
                coverImageUrl={item.coverImageUrl}
                logoImageUrl={getDownloadLogoImageUrl(item.game)}
                metaLabel={item.metaLabel}
                secondaryLabel={item.secondaryLabel}
                progress={item.progress}
                progressLabel={item.progressLabel}
                onOpen={() => handleOpen(item.href)}
                onPrimaryAction={() => sendToQueue(item.game)}
                primaryActionLabel="Resume"
                primaryActionDisabled={interactionsLocked}
                onOpenOptions={(event) => {
                  openDownloadMenu(
                    item,
                    "paused",
                    getDownloadMenuPosition(event.currentTarget),
                    getDownloadOptionsActionFocusId(item.id)
                  );
                }}
                optionsDisabled={interactionsLocked}
                dragPlacement={!moveMode ? "paused" : undefined}
                dropPlacement="paused"
                dropIndex={index}
                navigationOrder={index}
                isDragging={dragSource?.gameId === item.id}
                focusId={getDownloadMainFocusId(item.id)}
                navigationOverrides={
                  mainNavigationOverridesByFocusId[
                    getDownloadMainFocusId(item.id)
                  ]
                }
                focusActions={getDownloadCardFocusActions(
                  item.id,
                  true,
                  item,
                  "paused",
                  interactionsLocked
                )}
                isMoveGrabbed={grabbedGameId === item.id}
                primaryActionFocusId={getDownloadPrimaryActionFocusId(item.id)}
                optionsFocusId={getDownloadOptionsActionFocusId(item.id)}
              />
            ))}
          </VerticalFocusGroup>
        </Section>

        {completedDownloads.length > 0 ? (
          <Section
            title="Downloads Completed"
            count={completedDownloads.length}
          >
            <VerticalFocusGroup
              className="downloads-page__list"
              navigationOrder={DOWNLOADS_REGION_NAVIGATION_ORDER.completed}
            >
              {completedDownloads.map((item, index) => (
                <DownloadsGameCard
                  key={item.id}
                  gameId={item.id}
                  variant="completed"
                  title={item.title}
                  coverImageUrl={item.coverImageUrl}
                  logoImageUrl={getDownloadLogoImageUrl(item.game)}
                  metaLabel={item.metaLabel}
                  secondaryLabel={item.secondaryLabel}
                  rightStatusLabel={item.rightStatusLabel}
                  onOpen={() => handleOpen(item.href)}
                  onOpenOptions={(event) => {
                    openDownloadMenu(
                      item,
                      "completed",
                      getDownloadMenuPosition(event.currentTarget),
                      getDownloadOptionsActionFocusId(item.id)
                    );
                  }}
                  optionsDisabled={interactionsLocked}
                  navigationOrder={index}
                  focusId={getDownloadMainFocusId(item.id)}
                  navigationOverrides={
                    mainNavigationOverridesByFocusId[
                      getDownloadMainFocusId(item.id)
                    ]
                  }
                  focusActions={getDownloadCardFocusActions(
                    item.id,
                    false,
                    item,
                    "completed",
                    interactionsLocked
                  )}
                  optionsFocusId={getDownloadOptionsActionFocusId(item.id)}
                />
              ))}
            </VerticalFocusGroup>
          </Section>
        ) : null}

        <ContextMenu
          ariaLabel="Download options"
          items={downloadMenuItems}
          position={menuState.position}
          restoreFocusId={menuState.restoreFocusId}
          visible={menuState.visible && downloadMenuItems.length > 0}
          onClose={closeDownloadMenu}
        />
      </div>
    </VerticalFocusGroup>
  );
}
