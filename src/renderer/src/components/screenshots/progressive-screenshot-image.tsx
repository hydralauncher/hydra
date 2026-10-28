import { useCallback, useLayoutEffect, useRef, useState } from "react";
import cn from "classnames";

import "./progressive-screenshot-image.scss";

type LayerState = "loaded" | "instant" | "failed";

export type ProgressiveScreenshotImageFit = "cover" | "contain";

export interface ProgressiveScreenshotImageProps {
  placeholder?: string | null;
  sources: (string | null | undefined)[];
  alt: string;
  fit?: ProgressiveScreenshotImageFit;
  className?: string;
  loading?: "lazy" | "eager";
  onError?: () => void;
  onBestLayerLoad?: (image: HTMLImageElement) => void;
  onDoubleClick?: () => void;
}

const PLACEHOLDER_LEVEL = 0;

const uniqueSources = (sources: (string | null | undefined)[]) =>
  sources.filter(
    (source, index): source is string =>
      Boolean(source) && sources.indexOf(source) === index
  );

const getStateKey = (level: number, source: string) => `${level}:${source}`;

interface MountedLayer {
  level: number;
  image: HTMLImageElement;
}

const isImageReady = (image: HTMLImageElement | null) =>
  Boolean(image?.complete && image.naturalWidth > 0);

export function ProgressiveScreenshotImage({
  placeholder,
  sources,
  alt,
  fit = "cover",
  className,
  loading,
  onError,
  onBestLayerLoad,
  onDoubleClick,
}: Readonly<ProgressiveScreenshotImageProps>) {
  const layers = uniqueSources(sources);
  const layersKey = [placeholder ?? "", ...layers].join("\n");
  const [states, setStates] = useState<Record<string, LayerState>>({});
  const mountedLayersRef = useRef<Map<string, MountedLayer>>(new Map());
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

  const markLayer = useCallback(
    (stateKey: string, state: LayerState) =>
      setStates((current) =>
        current[stateKey] ? current : { ...current, [stateKey]: state }
      ),
    []
  );

  useLayoutEffect(() => {
    mountedLayersRef.current.forEach(({ level, image }, stateKey) => {
      if (!isImageReady(image)) return;
      markLayer(stateKey, "instant");
      reportLoad(level, image);
    });
  }, [layersKey, markLayer, reportLoad]);

  const bindImage =
    (stateKey: string, level: number) => (image: HTMLImageElement | null) => {
      if (image) mountedLayersRef.current.set(stateKey, { level, image });
      else mountedLayersRef.current.delete(stateKey);
    };

  const handleLoad = (
    level: number,
    stateKey: string,
    image: HTMLImageElement
  ) => {
    markLayer(stateKey, "loaded");
    reportLoad(level, image);
  };

  const placeholderKey = placeholder
    ? getStateKey(PLACEHOLDER_LEVEL, placeholder)
    : null;

  const getLayerClassName = (stateKey: string) => {
    const state = states[stateKey];
    return {
      "progressive-screenshot-image__layer--visible":
        state === "loaded" || state === "instant",
      "progressive-screenshot-image__layer--instant": state === "instant",
    };
  };

  return (
    <span
      className={cn(
        "progressive-screenshot-image",
        `progressive-screenshot-image--${fit}`,
        className
      )}
      onDoubleClick={onDoubleClick}
    >
      {placeholder && placeholderKey ? (
        <img
          key={placeholderKey}
          ref={bindImage(placeholderKey, PLACEHOLDER_LEVEL)}
          className={cn(
            "progressive-screenshot-image__layer",
            "progressive-screenshot-image__layer--placeholder",
            getLayerClassName(placeholderKey)
          )}
          src={placeholder}
          alt=""
          aria-hidden="true"
          draggable={false}
          onLoad={(event) =>
            handleLoad(PLACEHOLDER_LEVEL, placeholderKey, event.currentTarget)
          }
          onError={() => markLayer(placeholderKey, "failed")}
        />
      ) : null}

      {layers.map((source, index) => {
        const level = index + 1;
        const stateKey = getStateKey(level, source);
        const isTopLayer = index === layers.length - 1;

        return (
          <img
            key={stateKey}
            ref={bindImage(stateKey, level)}
            className={cn(
              "progressive-screenshot-image__layer",
              getLayerClassName(stateKey)
            )}
            src={source}
            alt={isTopLayer ? alt : ""}
            aria-hidden={isTopLayer ? undefined : "true"}
            loading={loading}
            draggable={false}
            onLoad={(event) => handleLoad(level, stateKey, event.currentTarget)}
            onError={() => {
              markLayer(stateKey, "failed");
              if (isTopLayer) onError?.();
            }}
          />
        );
      })}
    </span>
  );
}
