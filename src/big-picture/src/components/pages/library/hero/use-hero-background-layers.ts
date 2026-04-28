import { useCallback, useEffect, useState } from "react";

export interface HeroBackgroundLayer {
  key: number;
  imageUrl: string;
  role: "base" | "incoming";
  isVisible: boolean;
}

function getNextLayerKey() {
  return Date.now();
}

export function useHeroBackgroundLayers(imageUrl: string | null | undefined) {
  const [backgroundLayers, setBackgroundLayers] = useState<
    HeroBackgroundLayer[]
  >([]);

  useEffect(() => {
    const nextImageUrl = imageUrl ?? "";

    if (!nextImageUrl) {
      setBackgroundLayers([]);
      return;
    }

    setBackgroundLayers((currentLayers) => {
      const baseLayer =
        currentLayers.find((layer) => layer.role === "base") ?? null;
      const incomingLayer =
        currentLayers.find((layer) => layer.role === "incoming") ?? null;

      if (
        baseLayer?.imageUrl === nextImageUrl ||
        incomingLayer?.imageUrl === nextImageUrl
      ) {
        return currentLayers;
      }

      const nextLayer = {
        key: getNextLayerKey(),
        imageUrl: nextImageUrl,
        role: "base" as const,
        isVisible: true,
      };

      if (!baseLayer) return [nextLayer];

      return [
        baseLayer,
        {
          ...nextLayer,
          key: nextLayer.key + 1,
          role: "incoming" as const,
          isVisible: false,
        },
      ];
    });
  }, [imageUrl]);

  const showIncomingLayer = useCallback((layerKey: number) => {
    setBackgroundLayers((currentLayers) => {
      return currentLayers.map((layer) => {
        if (layer.key !== layerKey || layer.role !== "incoming") return layer;

        return {
          ...layer,
          isVisible: true,
        };
      });
    });
  }, []);

  const removeIncomingLayer = useCallback((layerKey: number) => {
    setBackgroundLayers((currentLayers) => {
      return currentLayers.filter((layer) => layer.key !== layerKey);
    });
  }, []);

  const promoteIncomingLayer = useCallback((layerKey: number) => {
    setBackgroundLayers((currentLayers) => {
      const incomingLayer = currentLayers.find(
        (layer) => layer.key === layerKey && layer.role === "incoming"
      );

      if (!incomingLayer?.isVisible) return currentLayers;

      return currentLayers
        .filter((layer) => layer.key === layerKey)
        .map((layer) => ({
          ...layer,
          role: "base" as const,
          isVisible: true,
        }));
    });
  }, []);

  const getLayerEventHandlers = useCallback(
    (layer: HeroBackgroundLayer) => {
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

  return {
    backgroundLayers,
    getLayerEventHandlers,
  };
}
