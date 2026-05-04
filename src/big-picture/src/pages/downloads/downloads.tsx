import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { type FocusItemActions } from "../../types";
import { getGameLandscapeImageSource, resolveImageSource } from "../../helpers";
import {
  useDominantColor,
  useNavigation,
  useNavigationScreenActions,
} from "../../hooks";
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
import { DOWNLOADS_HERO_OPTIONS_BUTTON_ID } from "../../components/pages/downloads/navigation";
import {
  useBigPictureDownloadsPageData,
  type BigPictureActiveDownloadItem,
  type BigPictureDownloadListItem,
} from "./use-big-picture-downloads-page-data";

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
  moveTarget: DragTarget;
  originalHeroId: string | null;
  originalQueueIds: string[];
  originalPausedIds: string[];
  isCommitting: boolean;
};

type DownloadMenuState = {
  item: BigPictureDownloadListItem | null;
  section: "queue" | "paused" | "completed" | null;
  position: { x: number; y: number };
  restoreFocusId: string | null;
  visible: boolean;
};

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

function clampInsertionIndex(targetIndex: number, length: number) {
  return Math.max(0, Math.min(targetIndex, length));
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
): DragTarget {
  if (placement === "hero") {
    return { kind: "hero" };
  }

  return {
    kind: placement,
    index,
  };
}

function getOriginalPreviewLayoutState(
  state: MoveModeState
): PreviewLayoutState {
  return {
    sourceGameId: state.sourceGameId,
    heroId: state.originalHeroId,
    queueIds: state.originalQueueIds,
    pausedIds: state.originalPausedIds,
  };
}

function getNextMoveTarget(
  state: MoveModeState,
  direction: "up" | "down",
  canPromoteToHero: boolean
): DragTarget | null {
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

    if (state.queueIds.length > 0) {
      return { kind: "queue", index: state.queueIds.length };
    }

    return canPromoteToHero ? { kind: "hero" } : null;
  }

  if (placement.kind === "hero") {
    if (state.queueIds.length > 0) {
      return { kind: "queue", index: 1 };
    }

    if (state.pausedIds.length > 0) {
      return { kind: "paused", index: 1 };
    }

    return null;
  }

  if (placement.kind === "queue") {
    if (placement.index < state.queueIds.length - 1) {
      return { kind: "queue", index: placement.index + 2 };
    }

    return { kind: "paused", index: 0 };
  }

  if (placement.index < state.pausedIds.length - 1) {
    return { kind: "paused", index: placement.index + 2 };
  }

  return null;
}

function applyMoveTargetToMoveModeState(
  state: MoveModeState,
  moveTarget: DragTarget,
  canPromoteToHero: boolean
): MoveModeState {
  const previewLayout = buildPreviewLayoutState(
    getOriginalPreviewLayoutState(state),
    state.sourcePlacement,
    moveTarget,
    canPromoteToHero
  );

  return {
    ...state,
    ...previewLayout,
    moveTarget,
  };
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
    coverImageUrl: resolveImageSource(getGameLandscapeImageSource(item.game)),
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
    metaLabel: item.metaLabel,
    statusLabel: item.statusLabel,
    statusTone: item.statusTone,
    progress,
    progressLabel: item.progressLabel ?? "0%",
    transferLabel: item.transferLabel ?? item.sizeLabel ?? item.trailingLabel,
    speedLabel: item.speedLabel ?? "Ready when dropped",
    etaLabel: item.etaLabel ?? null,
    sizeLabel: item.sizeLabel ?? item.trailingLabel,
    canPause: true,
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
  const { t } = useTranslation("downloads");
  const { setFocus } = useNavigation();
  const {
    activeDownload,
    networkStats,
    queuedDownloads,
    pausedDownloads,
    completedDownloads,
    hasDownloads,
    pauseDownload,
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
  const suppressOpenRef = useRef(false);
  const [dragSource, setDragSource] = useState<DragSourceData | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [dragPreviewState, setDragPreviewState] =
    useState<PreviewLayoutState | null>(null);
  const [moveMode, setMoveMode] = useState<MoveModeState | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<DownloadMenuState>({
    item: null,
    section: null,
    position: { x: 0, y: 0 },
    restoreFocusId: null,
    visible: false,
  });

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

  const canPromoteToHero = !activeDownload || activeDownload.canPause;
  const interactionsLocked = Boolean(moveMode);
  const previewLayoutState = moveMode ?? dragPreviewState;

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

  const commitPlacement = useCallback(
    async (
      gameId: string,
      sourcePlacement: DragPlacement,
      targetPlacement: PreviewPlacement | DragTarget
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

  const visibleMainFocusIds = useMemo(() => {
    const ids: string[] = [];

    if (renderedActiveDownload) {
      ids.push(getDownloadMainFocusId(renderedActiveDownload.id));
    }

    renderedQueuedDownloads.forEach((item) => {
      ids.push(getDownloadMainFocusId(item.id));
    });

    renderedPausedDownloads.forEach((item) => {
      ids.push(getDownloadMainFocusId(item.id));
    });

    return ids;
  }, [
    renderedActiveDownload,
    renderedPausedDownloads,
    renderedQueuedDownloads,
  ]);

  useEffect(() => {
    if (!pendingFocusId) return;
    if (!visibleMainFocusIds.includes(pendingFocusId)) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(pendingFocusId);
      setPendingFocusId(null);
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [pendingFocusId, setFocus, visibleMainFocusIds]);

  const beginMoveMode = useCallback(
    (gameId: string) => {
      if (moveMode) return;

      const placement = getOriginalPlacement(gameId);
      if (!placement) return;

      if (placement === "hero" && !activeDownload?.canPause) {
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

    setPendingFocusId(getDownloadMainFocusId(moveMode.sourceGameId));
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

        return applyMoveTargetToMoveModeState(
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

    const isSamePlacement =
      moveMode.heroId === moveMode.originalHeroId &&
      areIdListsEqual(moveMode.queueIds, moveMode.originalQueueIds) &&
      areIdListsEqual(moveMode.pausedIds, moveMode.originalPausedIds);

    if (isSamePlacement) {
      setPendingFocusId(getDownloadMainFocusId(moveMode.sourceGameId));
      setMoveMode(null);
      return;
    }

    setMoveMode((current) =>
      current ? { ...current, isCommitting: true } : current
    );

    try {
      await commitPlacement(
        moveMode.sourceGameId,
        moveMode.sourcePlacement,
        moveMode.moveTarget
      );
    } finally {
      setPendingFocusId(getDownloadMainFocusId(moveMode.sourceGameId));
      setMoveMode(null);
    }
  }, [commitPlacement, moveMode]);

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

  const heroDownloadMenuContext = useMemo(() => {
    if (!renderedActiveDownload) return null;

    const listItem =
      queuedById.get(renderedActiveDownload.id) ??
      pausedById.get(renderedActiveDownload.id) ??
      buildPreviewRowItemFromActive(renderedActiveDownload, "queue");

    const section: "queue" | "paused" = pausedById.has(
      renderedActiveDownload.id
    )
      ? "paused"
      : "queue";

    return { listItem, section };
  }, [pausedById, queuedById, renderedActiveDownload]);

  const handleHeroOptions = useCallback(() => {
    if (
      !heroDownloadMenuContext ||
      !renderedActiveDownload ||
      interactionsLocked
    ) {
      return;
    }

    const element = globalThis.document.getElementById(
      DOWNLOADS_HERO_OPTIONS_BUTTON_ID
    );
    const rect = element?.getBoundingClientRect();

    if (!rect) return;

    openDownloadMenu(
      heroDownloadMenuContext.listItem,
      heroDownloadMenuContext.section,
      {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
      DOWNLOADS_HERO_OPTIONS_BUTTON_ID
    );
  }, [
    heroDownloadMenuContext,
    interactionsLocked,
    openDownloadMenu,
    renderedActiveDownload,
  ]);

  const downloadMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menuState.item || !menuState.section) return [];

    const item = menuState.item;

    if (menuState.section === "queue") {
      return [
        {
          id: "start-now",
          label: t("start_now", { defaultValue: "Start now" }),
          disabled: interactionsLocked || !canPromoteToHero,
          onSelect: () => startNow(item.game),
        },
        {
          id: "move-to-paused",
          label: t("move_to_paused", { defaultValue: "Move to paused" }),
          disabled: interactionsLocked,
          onSelect: () => moveToPaused(item.game),
        },
        {
          id: "move-up",
          label: t("move_up"),
          disabled: interactionsLocked || !item.canMoveUp,
          onSelect: () => moveQueuedDownload(item.game, "up"),
        },
        {
          id: "move-down",
          label: t("move_down"),
          disabled: interactionsLocked || !item.canMoveDown,
          onSelect: () => moveQueuedDownload(item.game, "down"),
        },
        {
          id: "cancel",
          label: t("cancel"),
          danger: true,
          disabled: interactionsLocked,
          onSelect: () => cancelDownload(item.game),
        },
      ];
    }

    if (menuState.section === "paused") {
      return [
        {
          id: "start-now",
          label: t("start_now", { defaultValue: "Start now" }),
          disabled: interactionsLocked || !canPromoteToHero,
          onSelect: () => startNow(item.game),
        },
        {
          id: "send-to-queue",
          label: t("send_to_queue", { defaultValue: "Send to queue" }),
          disabled: interactionsLocked,
          onSelect: () => sendToQueue(item.game),
        },
        {
          id: "cancel",
          label: t("cancel"),
          danger: true,
          disabled: interactionsLocked,
          onSelect: () => cancelDownload(item.game),
        },
      ];
    }

    return [
      ...(item.seedAction
        ? [
            {
              id: "toggle-seeding",
              label:
                item.seedAction === "pause"
                  ? t("stop_seeding")
                  : t("resume_seeding"),
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
              label: t("remove"),
              danger: true,
              disabled: interactionsLocked,
              onSelect: () => removeDownload(item.game),
            } satisfies ContextMenuItem,
          ]
        : []),
    ];
  }, [
    cancelDownload,
    canPromoteToHero,
    interactionsLocked,
    menuState.item,
    menuState.section,
    moveQueuedDownload,
    moveToPaused,
    pauseSeeding,
    removeDownload,
    resumeSeeding,
    sendToQueue,
    startNow,
    t,
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
              return Boolean(activeDownload?.canPause);
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
              return Boolean(activeDownload?.canPause);
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
              return Boolean(activeDownload?.canPause);
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
          updateMouseDragPreview(source.data, null);
        },
        onDrag: ({ source, location }) => {
          if (!isDragSourceData(source.data)) return;

          const currentTarget = location.current.dropTargets[0]?.data
            ? getDragTargetFromData(location.current.dropTargets[0].data)
            : null;

          updateMouseDragPreview(source.data, currentTarget);
        },
        onDropTargetChange: ({ source, location }) => {
          if (!isDragSourceData(source.data)) return;

          const currentTarget = location.current.dropTargets[0]?.data
            ? getDragTargetFromData(location.current.dropTargets[0].data)
            : null;

          updateMouseDragPreview(source.data, currentTarget);
        },
        onDrop: ({ source, location }) => {
          setDragSource(null);
          setDragTarget(null);
          setDragPreviewState(null);

          if (!isDragSourceData(source.data)) return;

          const resolvedTarget = location.current.dropTargets[0]?.data
            ? getDragTargetFromData(location.current.dropTargets[0].data)
            : null;

          if (!resolvedTarget) return;

          suppressOpenRef.current = true;

          void commitPlacement(
            source.data.gameId,
            source.data.placement,
            resolvedTarget
          ).finally(() => {
            globalThis.window.setTimeout(() => {
              suppressOpenRef.current = false;
            }, 0);
          });
        },
      })
    );

    return combine(...cleanupFns);
  }, [
    activeDownload?.canPause,
    canPromoteToHero,
    commitPlacement,
    moveMode,
    updateMouseDragPreview,
  ]);

  const activeDownloadAccentColor = useDominantColor(
    renderedActiveDownload?.game.libraryHeroImageUrl ?? null
  );

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
      },
      secondary:
        optionsDisabled || moveMode
          ? "off"
          : () => {
              const optionsFocusId = getDownloadOptionsActionFocusId(itemId);
              const element =
                globalThis.document.getElementById(optionsFocusId);
              const rect = element?.getBoundingClientRect();

              if (!rect) return;

              openDownloadMenu(
                listItem,
                section,
                {
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                },
                optionsFocusId
              );
            },
    }),
    [beginMoveMode, moveMode, openDownloadMenu]
  );

  const grabbedGameId = moveMode?.sourceGameId ?? null;

  if (!hasDownloads) {
    return (
      <div className="downloads-page downloads-page--empty">
        <div className="downloads-page__empty-state">
          <Typography variant="h2">{t("no_downloads_title")}</Typography>
          <Typography className="downloads-page__empty-copy">
            {t("no_downloads_description")}
          </Typography>
        </div>
      </div>
    );
  }

  return (
    <VerticalFocusGroup asChild>
      <div ref={pageRef} className="downloads-page">
        {moveMode ? (
          <div className="downloads-page__move-mode-banner">
            <Typography variant="h5">
              {moveMode.isCommitting
                ? t("move_mode_committing", {
                    defaultValue: "Applying move...",
                  })
                : t("move_mode_title", { defaultValue: "Move mode active" })}
            </Typography>
            <Typography className="downloads-page__empty-copy">
              {moveMode.isCommitting
                ? t("move_mode_committing_copy", {
                    defaultValue:
                      "Please wait while the new position is saved.",
                  })
                : t("move_mode_copy", {
                    defaultValue:
                      "Use Up/Down to move the card, A to confirm, and B to cancel.",
                  })}
            </Typography>
          </div>
        ) : null}

        <>
          <DownloadsHero
            download={renderedActiveDownload}
            canPauseOrResume={Boolean(
              renderedActiveDownload && !interactionsLocked
                ? renderedActiveDownload.canPause
                : false
            )}
            pauseOrResumeLabel={t("pause")}
            onPauseOrResume={() => {
              if (!renderedActiveDownload) return;
              void pauseDownload(renderedActiveDownload.game);
            }}
            onOpenOptions={handleHeroOptions}
            onOpenDetails={() => {
              if (!renderedActiveDownload) return;
              handleOpen(renderedActiveDownload.href);
            }}
            isMoveGrabbed={
              Boolean(renderedActiveDownload) &&
              grabbedGameId === renderedActiveDownload?.id
            }
            isDragSource={Boolean(renderedActiveDownload) && !moveMode}
            isDragging={dragSource?.gameId === renderedActiveDownload?.id}
            isDropActive={areTargetsEqual(dragTarget, { kind: "hero" })}
            isDropDisabled={Boolean(
              renderedActiveDownload && !canPromoteToHero
            )}
            focusId={
              renderedActiveDownload
                ? getDownloadMainFocusId(renderedActiveDownload.id)
                : undefined
            }
            focusActions={
              renderedActiveDownload && heroDownloadMenuContext
                ? getDownloadCardFocusActions(
                    renderedActiveDownload.id,
                    renderedActiveDownload.canPause,
                    heroDownloadMenuContext.listItem,
                    heroDownloadMenuContext.section,
                    interactionsLocked
                  )
                : undefined
            }
          />

          <div className="downloads-page__hero-stats-stack">
            <DownloadsProgressStats
              title={
                renderedActiveDownload
                  ? "Download In Progress"
                  : "Waiting Download"
              }
              progress={renderedActiveDownload?.progress ?? 0}
              progressLabel={renderedActiveDownload?.progressLabel ?? "0%"}
              transferLabel={renderedActiveDownload?.transferLabel ?? "-- / --"}
              etaLabel={renderedActiveDownload?.etaLabel ?? "--"}
              accentColor={activeDownloadAccentColor ?? undefined}
            />

            <DownloadsNetworkStats
              speedLabel={networkStats.speedLabel}
              peakSpeedLabel={networkStats.peakSpeedLabel}
              speedHistory={networkStats.speedHistory}
              speedHistoryLabels={networkStats.speedHistoryLabels}
              seeds={networkStats.seeds}
              peers={networkStats.peers}
              showSeedsAndPeers={networkStats.showSeedsAndPeers}
              accentColor={activeDownloadAccentColor ?? undefined}
            />
          </div>
        </>

        <Section title="Queued" count={renderedQueuedDownloads.length}>
          <VerticalFocusGroup
            className="downloads-page__list"
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
                <Typography variant="h5">
                  {t("queue_empty_title", { defaultValue: "Queue is empty" })}
                </Typography>
                <Typography className="downloads-page__empty-copy">
                  {t("queue_empty_copy", {
                    defaultValue:
                      "Drag downloads here to line them up for automatic start.",
                  })}
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
                secondaryLabel={item.secondaryLabel}
                progress={item.progress}
                progressLabel={item.progressLabel}
                onOpen={() => handleOpen(item.href)}
                onPrimaryAction={() => moveToPaused(item.game)}
                primaryActionLabel={t("pause")}
                primaryActionDisabled={interactionsLocked}
                onOpenOptions={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  openDownloadMenu(
                    item,
                    "queue",
                    {
                      x: rect.left + rect.width / 2,
                      y: rect.top + rect.height / 2,
                    },
                    getDownloadOptionsActionFocusId(item.id)
                  );
                }}
                optionsDisabled={interactionsLocked}
                dragPlacement={!moveMode ? "queue" : undefined}
                dropPlacement="queue"
                dropIndex={index}
                isDragging={dragSource?.gameId === item.id}
                focusId={getDownloadMainFocusId(item.id)}
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

        <Section title={t("paused")} count={renderedPausedDownloads.length}>
          <VerticalFocusGroup
            className="downloads-page__list"
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
                  {t("paused_empty_copy", {
                    defaultValue:
                      "Downloads you pause manually will stay here until you move them.",
                  })}
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
                secondaryLabel={item.secondaryLabel}
                progress={item.progress}
                progressLabel={item.progressLabel}
                onOpen={() => handleOpen(item.href)}
                onPrimaryAction={() => sendToQueue(item.game)}
                primaryActionLabel={t("resume")}
                primaryActionDisabled={interactionsLocked}
                onOpenOptions={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  openDownloadMenu(
                    item,
                    "paused",
                    {
                      x: rect.left + rect.width / 2,
                      y: rect.top + rect.height / 2,
                    },
                    getDownloadOptionsActionFocusId(item.id)
                  );
                }}
                optionsDisabled={interactionsLocked}
                dragPlacement={!moveMode ? "paused" : undefined}
                dropPlacement="paused"
                dropIndex={index}
                isDragging={dragSource?.gameId === item.id}
                focusId={getDownloadMainFocusId(item.id)}
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
            title={t("downloads_completed")}
            count={completedDownloads.length}
          >
            <VerticalFocusGroup className="downloads-page__list">
              {completedDownloads.map((item) => (
                <DownloadsGameCard
                  key={item.id}
                  gameId={item.id}
                  variant="completed"
                  title={item.title}
                  coverImageUrl={item.coverImageUrl}
                  secondaryLabel={item.secondaryLabel}
                  rightStatusLabel={item.rightStatusLabel}
                  onOpen={() => handleOpen(item.href)}
                  onOpenOptions={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    openDownloadMenu(
                      item,
                      "completed",
                      {
                        x: rect.left + rect.width / 2,
                        y: rect.top + rect.height / 2,
                      },
                      getDownloadOptionsActionFocusId(item.id)
                    );
                  }}
                  optionsDisabled={interactionsLocked}
                  focusId={getDownloadMainFocusId(item.id)}
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
          ariaLabel={t("context_menu_accessible_label", {
            defaultValue: "Download options",
          })}
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
