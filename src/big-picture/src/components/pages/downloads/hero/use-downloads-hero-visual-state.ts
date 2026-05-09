import { getDominantColorFromImage } from "../../../../helpers";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface DownloadsHeroProgressPanelState {
  title: string;
  progress: number;
  progressLabel: string;
  transferLabel: string;
  etaLabel: string;
}

export interface DownloadsHeroNetworkPanelState {
  speedLabel: string;
  peakSpeedLabel: string;
  speedHistory: number[];
  speedHistoryLabels: string[];
  downloaderLabel?: string | null;
  seeds: number | null;
  peers: number | null;
  showSeedsAndPeers: boolean;
}

export interface DownloadsHeroSnapshot {
  id: string;
  title: string;
  href: string;
  backgroundImageUrl: string | null;
  logoImageUrl: string | null;
  accentImageUrl: string | null;
  accentColor: string | null;
  pauseOrResumeLabel: string;
  canPauseOrResume: boolean;
  progressPanel: DownloadsHeroProgressPanelState;
  networkPanel: DownloadsHeroNetworkPanelState;
  mode: "normal" | "preview";
}

export interface DownloadsHeroSnapshotLayer {
  key: number;
  snapshot: DownloadsHeroSnapshot;
  role: "base" | "incoming";
  isVisible: boolean;
  isImageReady: boolean;
  isAccentReady: boolean;
  hasTransitionEnded: boolean;
}

const accentColorCache = new Map<string, string | null>();
const accentColorPromiseCache = new Map<string, Promise<string | null>>();

function getNextLayerKey() {
  return Date.now();
}

function getSnapshotVisualSignature(snapshot: DownloadsHeroSnapshot) {
  return [
    snapshot.id,
    snapshot.title,
    snapshot.backgroundImageUrl ?? "",
    snapshot.logoImageUrl ?? "",
    snapshot.accentImageUrl ?? "",
  ].join("::");
}

function getCachedAccentColor(imageUrl: string | null | undefined) {
  if (!imageUrl) return null;
  return accentColorCache.get(imageUrl) ?? null;
}

function hasResolvedAccentColor(imageUrl: string | null | undefined) {
  if (!imageUrl) return true;
  return accentColorCache.has(imageUrl);
}

function preloadAccentColor(imageUrl: string | null | undefined) {
  if (!imageUrl) {
    return Promise.resolve<string | null>(null);
  }

  if (accentColorCache.has(imageUrl)) {
    return Promise.resolve(accentColorCache.get(imageUrl) ?? null);
  }

  const cachedPromise = accentColorPromiseCache.get(imageUrl);
  if (cachedPromise) return cachedPromise;

  const nextPromise = getDominantColorFromImage(imageUrl)
    .then((color) => {
      accentColorCache.set(imageUrl, color);
      accentColorPromiseCache.delete(imageUrl);
      return color;
    })
    .catch(() => {
      accentColorCache.set(imageUrl, null);
      accentColorPromiseCache.delete(imageUrl);
      return null;
    });

  accentColorPromiseCache.set(imageUrl, nextPromise);
  return nextPromise;
}

function withResolvedAccentColor(snapshot: DownloadsHeroSnapshot) {
  const accentColor =
    snapshot.accentColor ?? getCachedAccentColor(snapshot.accentImageUrl);

  return accentColor === snapshot.accentColor
    ? snapshot
    : {
        ...snapshot,
        accentColor,
      };
}

function canPromoteLayer(layer: DownloadsHeroSnapshotLayer) {
  return (
    layer.role === "incoming" &&
    layer.isVisible &&
    layer.isImageReady &&
    layer.isAccentReady &&
    layer.hasTransitionEnded
  );
}

function promoteLayerIfReady(
  layers: DownloadsHeroSnapshotLayer[],
  layerKey: number
) {
  const candidate = layers.find((layer) => layer.key === layerKey);

  if (!candidate || !canPromoteLayer(candidate)) {
    return layers;
  }

  return layers
    .filter((layer) => layer.key === layerKey)
    .map((layer) => ({
      ...layer,
      role: "base" as const,
      isVisible: true,
      isImageReady: true,
      isAccentReady: true,
      hasTransitionEnded: true,
    }));
}

function createLayer(
  snapshot: DownloadsHeroSnapshot,
  role: "base" | "incoming",
  key: number
): DownloadsHeroSnapshotLayer {
  const resolvedSnapshot = withResolvedAccentColor(snapshot);
  const hasBackgroundImage = Boolean(resolvedSnapshot.backgroundImageUrl);
  const hasAccentImage = Boolean(resolvedSnapshot.accentImageUrl);

  return {
    key,
    snapshot: resolvedSnapshot,
    role,
    isVisible: role === "base" || !hasBackgroundImage,
    isImageReady: !hasBackgroundImage,
    isAccentReady:
      !hasAccentImage ||
      hasResolvedAccentColor(resolvedSnapshot.accentImageUrl),
    hasTransitionEnded: role === "base" || !hasBackgroundImage,
  };
}

function mergeSnapshotIntoLayer(
  layer: DownloadsHeroSnapshotLayer,
  snapshot: DownloadsHeroSnapshot
) {
  const nextSnapshot = withResolvedAccentColor(snapshot);
  const hasAccentImage = Boolean(nextSnapshot.accentImageUrl);

  return {
    ...layer,
    snapshot: nextSnapshot,
    isAccentReady:
      !hasAccentImage || hasResolvedAccentColor(nextSnapshot.accentImageUrl),
  };
}

export function useDownloadsHeroDisplayState(
  snapshot: DownloadsHeroSnapshot | null | undefined
) {
  const [layers, setLayers] = useState<DownloadsHeroSnapshotLayer[]>([]);

  useEffect(() => {
    if (!snapshot) {
      setLayers([]);
      return;
    }

    const nextSignature = getSnapshotVisualSignature(snapshot);

    setLayers((currentLayers) => {
      const baseLayer =
        currentLayers.find((layer) => layer.role === "base") ?? null;
      const incomingLayer =
        currentLayers.find((layer) => layer.role === "incoming") ?? null;

      if (
        baseLayer &&
        getSnapshotVisualSignature(baseLayer.snapshot) === nextSignature
      ) {
        return currentLayers.map((layer) =>
          layer.key === baseLayer.key
            ? mergeSnapshotIntoLayer(layer, snapshot)
            : layer
        );
      }

      if (
        incomingLayer &&
        getSnapshotVisualSignature(incomingLayer.snapshot) === nextSignature
      ) {
        return currentLayers.map((layer) =>
          layer.key === incomingLayer.key
            ? mergeSnapshotIntoLayer(layer, snapshot)
            : layer
        );
      }

      const nextKey = getNextLayerKey();
      const nextLayer = createLayer(snapshot, "base", nextKey);

      if (!baseLayer) {
        return [nextLayer];
      }

      if (!nextLayer.snapshot.backgroundImageUrl) {
        return [
          {
            ...nextLayer,
            role: "base",
            isVisible: true,
            isImageReady: true,
            isAccentReady: true,
            hasTransitionEnded: true,
          },
        ];
      }

      return [
        baseLayer,
        {
          ...nextLayer,
          key: nextKey + 1,
          role: "incoming",
        },
      ];
    });
  }, [snapshot]);

  useEffect(() => {
    const pendingAccentLayers = layers.filter(
      (layer) => !layer.isAccentReady && Boolean(layer.snapshot.accentImageUrl)
    );

    if (!pendingAccentLayers.length) return;

    let isMounted = true;

    pendingAccentLayers.forEach((layer) => {
      void preloadAccentColor(layer.snapshot.accentImageUrl).then(
        (accentColor) => {
          if (!isMounted) return;

          setLayers((currentLayers) => {
            const nextLayers = currentLayers.map((candidate) => {
              if (candidate.key !== layer.key) return candidate;
              if (
                candidate.snapshot.accentImageUrl !==
                layer.snapshot.accentImageUrl
              ) {
                return candidate;
              }

              return {
                ...candidate,
                snapshot: {
                  ...candidate.snapshot,
                  accentColor,
                },
                isAccentReady: true,
              };
            });

            return promoteLayerIfReady(nextLayers, layer.key);
          });
        }
      );
    });

    return () => {
      isMounted = false;
    };
  }, [layers]);

  const showIncomingLayer = useCallback((layerKey: number) => {
    setLayers((currentLayers) => {
      return promoteLayerIfReady(
        currentLayers.map((layer) => {
          if (layer.key !== layerKey || layer.role !== "incoming") return layer;

          return {
            ...layer,
            isVisible: true,
            isImageReady: true,
          };
        }),
        layerKey
      );
    });
  }, []);

  const removeIncomingLayer = useCallback((layerKey: number) => {
    setLayers((currentLayers) => {
      return currentLayers.filter((layer) => layer.key !== layerKey);
    });
  }, []);

  const promoteIncomingLayer = useCallback((layerKey: number) => {
    setLayers((currentLayers) => {
      return promoteLayerIfReady(
        currentLayers.map((layer) => {
          if (layer.key !== layerKey || layer.role !== "incoming") return layer;

          return {
            ...layer,
            hasTransitionEnded: true,
          };
        }),
        layerKey
      );
    });
  }, []);

  const getLayerEventHandlers = useCallback(
    (layer: DownloadsHeroSnapshotLayer) => {
      const runForIncomingLayer = (run: (layerKey: number) => void) => () => {
        if (layer.role !== "incoming") return;
        run(layer.key);
      };

      return {
        onLoad: runForIncomingLayer(showIncomingLayer),
        onError: runForIncomingLayer(removeIncomingLayer),
        onTransitionEnd: runForIncomingLayer(promoteIncomingLayer),
      };
    },
    [promoteIncomingLayer, removeIncomingLayer, showIncomingLayer]
  );

  const displayedSnapshot = useMemo(() => {
    return (
      layers.find((layer) => layer.role === "base")?.snapshot ??
      snapshot ??
      null
    );
  }, [layers, snapshot]);

  return {
    displayedSnapshot,
    backgroundLayers: layers.filter((layer) =>
      Boolean(layer.snapshot.backgroundImageUrl)
    ),
    getLayerEventHandlers,
    isTransitioning: layers.some((layer) => layer.role === "incoming"),
  };
}
