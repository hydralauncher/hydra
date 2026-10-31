import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import cn from "classnames";
import { getScreenshotThumbHashUrl } from "@shared";

import "./progressive-screenshot-image.scss";

type LayerState = "loaded" | "instant" | "failed";

export type ProgressiveScreenshotImageFit = "cover" | "contain";

export interface ProgressiveScreenshotImageProps {
  thumbHash?: string | null;
  sources: (string | null | undefined)[];
  alt: string;
  fit?: ProgressiveScreenshotImageFit;
  className?: string;
  loading?: "lazy" | "eager";
  onError?: (hasLoadedLowerSource: boolean) => void;
  onBestLayerLoad?: (image: HTMLImageElement) => void;
  onDoubleClick?: () => void;
}

const PLACEHOLDER_LEVEL = 0;

const uniqueSources = (sources: (string | null | undefined)[]) =>
  sources.filter(
    (source, index): source is string =>
      Boolean(source) && sources.indexOf(source) === index
  );

const isImageReady = (image: HTMLImageElement | null) =>
  Boolean(image?.complete && image.naturalWidth > 0);

const isVisibleState = (state: LayerState | undefined) =>
  state === "loaded" || state === "instant";

const getNextLayerState = (
  current: LayerState | undefined,
  next: LayerState
) => {
  if (next === "failed") return next;
  return isVisibleState(current) ? current : next;
};

const pickPresentLevels = (
  states: Record<number, LayerState>,
  presentLevels: number[]
) => {
  const entries = Object.entries(states).filter(([level]) =>
    presentLevels.includes(Number(level))
  );
  if (entries.length === Object.keys(states).length) return states;
  return Object.fromEntries(entries) as Record<number, LayerState>;
};

export function ProgressiveScreenshotImage({
  thumbHash,
  sources,
  alt,
  fit = "cover",
  className,
  loading,
  onError,
  onBestLayerLoad,
  onDoubleClick,
}: Readonly<ProgressiveScreenshotImageProps>) {
  const placeholder = useMemo(
    () => getScreenshotThumbHashUrl(thumbHash),
    [thumbHash]
  );
  const layers = uniqueSources(sources);
  const layersKey = [placeholder ?? "", ...layers].join("\n");
  const [states, setStates] = useState<Record<number, LayerState>>({});
  const mountedLayersRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const bestLevelRef = useRef({ key: layersKey, level: -1 });
  const onBestLayerLoadRef = useRef(onBestLayerLoad);
  onBestLayerLoadRef.current = onBestLayerLoad;

  const reportLoad = useCallback(
    (level: number, image: HTMLImageElement) => {
      if (bestLevelRef.current.key !== layersKey) {
        bestLevelRef.current = { key: layersKey, level: -1 };
      }
      if (level <= bestLevelRef.current.level) return;
      bestLevelRef.current.level = level;
      onBestLayerLoadRef.current?.(image);
    },
    [layersKey]
  );

  const markLayer = useCallback((level: number, state: LayerState) => {
    setStates((current) => {
      const nextState = getNextLayerState(current[level], state);
      return current[level] === nextState
        ? current
        : { ...current, [level]: nextState };
    });
  }, []);

  useLayoutEffect(() => {
    const presentLevels = [...mountedLayersRef.current.keys()];
    setStates((current) => pickPresentLevels(current, presentLevels));
    mountedLayersRef.current.forEach((image, level) => {
      if (!isImageReady(image)) return;
      markLayer(level, "instant");
      reportLoad(level, image);
    });
  }, [layersKey, markLayer, reportLoad]);

  const bindImage = (level: number) => (image: HTMLImageElement | null) => {
    if (image) mountedLayersRef.current.set(level, image);
    else mountedLayersRef.current.delete(level);
  };

  const handleLoad = (level: number, image: HTMLImageElement) => {
    markLayer(level, "loaded");
    reportLoad(level, image);
  };

  const hasLoadedSourceBelow = (level: number) =>
    layers.some((_source, index) => {
      const lowerLevel = index + 1;
      return lowerLevel < level && isVisibleState(states[lowerLevel]);
    });

  const getLayerClassName = (level: number) => ({
    "progressive-screenshot-image__layer--visible": isVisibleState(
      states[level]
    ),
    "progressive-screenshot-image__layer--instant": states[level] === "instant",
  });

  return (
    <span
      className={cn(
        "progressive-screenshot-image",
        `progressive-screenshot-image--${fit}`,
        className
      )}
      onDoubleClick={onDoubleClick}
    >
      {placeholder ? (
        <img
          key={PLACEHOLDER_LEVEL}
          ref={bindImage(PLACEHOLDER_LEVEL)}
          className={cn(
            "progressive-screenshot-image__layer",
            "progressive-screenshot-image__layer--placeholder",
            getLayerClassName(PLACEHOLDER_LEVEL)
          )}
          src={placeholder}
          alt=""
          aria-hidden="true"
          draggable={false}
          onLoad={(event) => handleLoad(PLACEHOLDER_LEVEL, event.currentTarget)}
          onError={() => markLayer(PLACEHOLDER_LEVEL, "failed")}
        />
      ) : null}

      {layers.map((source, index) => {
        const level = index + 1;
        const isTopLayer = index === layers.length - 1;

        return (
          <img
            key={level}
            ref={bindImage(level)}
            className={cn(
              "progressive-screenshot-image__layer",
              getLayerClassName(level)
            )}
            src={source}
            alt={isTopLayer ? alt : ""}
            aria-hidden={isTopLayer ? undefined : "true"}
            loading={loading}
            draggable={false}
            onLoad={(event) => handleLoad(level, event.currentTarget)}
            onError={() => {
              markLayer(level, "failed");
              if (isTopLayer) onError?.(hasLoadedSourceBelow(level));
            }}
          />
        );
      })}
    </span>
  );
}
