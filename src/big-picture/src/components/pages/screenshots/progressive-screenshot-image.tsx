import "./progressive-screenshot-image.scss";

import cn from "classnames";
import { getScreenshotThumbHashUrl } from "@shared";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";

type LayerState = "pending" | "cached" | "loaded" | "failed";

export type ProgressiveScreenshotImageFit = "cover" | "contain";

export interface ProgressiveScreenshotImageProps {
  sources: string[];
  thumbHash?: string | null;
  alt: string;
  className?: string;
  fit?: ProgressiveScreenshotImageFit;
  loading?: "eager" | "lazy";
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError?: (source: string) => void;
  onPlaceholderLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
}

interface ProgressiveLayerProps {
  source: string;
  alt: string;
  isTop: boolean;
  isPlain: boolean;
  loading?: "eager" | "lazy";
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError?: (source: string) => void;
}

function ProgressiveLayer({
  source,
  alt,
  isTop,
  isPlain,
  loading,
  onLoad,
  onError,
}: Readonly<ProgressiveLayerProps>) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [displayedSource, setDisplayedSource] = useState(source);
  const [state, setState] = useState<LayerState>("pending");
  const isVisible = isPlain || state === "loaded" || state === "cached";

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) setState("cached");
  }, []);

  useEffect(() => {
    if (source === displayedSource) return;

    if (!isVisible) {
      setState("pending");
      setDisplayedSource(source);
      return;
    }

    let isCurrent = true;
    const preload = new Image();
    const swap = () => {
      if (isCurrent) setDisplayedSource(source);
    };
    preload.addEventListener("load", swap);
    preload.addEventListener("error", swap);
    preload.src = source;

    return () => {
      isCurrent = false;
      preload.removeEventListener("load", swap);
      preload.removeEventListener("error", swap);
    };
  }, [displayedSource, isVisible, source]);

  return (
    <img
      ref={imageRef}
      className={cn("progressive-screenshot-image__layer", {
        "progressive-screenshot-image__layer--visible": isVisible,
        "progressive-screenshot-image__layer--instant":
          isPlain || state === "cached",
      })}
      src={displayedSource}
      alt={isTop ? alt : ""}
      aria-hidden={isTop ? undefined : true}
      draggable={false}
      loading={loading}
      onLoad={(event) => {
        setState((current) => (current === "cached" ? current : "loaded"));
        onLoad?.(event);
      }}
      onError={() => {
        setState("failed");
        onError?.(displayedSource);
      }}
    />
  );
}

export function ProgressiveScreenshotImage({
  sources,
  thumbHash,
  alt,
  className,
  fit = "cover",
  loading,
  onLoad,
  onError,
  onPlaceholderLoad,
}: Readonly<ProgressiveScreenshotImageProps>) {
  const placeholder = useMemo(
    () => getScreenshotThumbHashUrl(thumbHash),
    [thumbHash]
  );
  const [failedPlaceholder, setFailedPlaceholder] = useState<string | null>(
    null
  );
  const hasPlaceholder = Boolean(
    placeholder && placeholder !== failedPlaceholder
  );
  const uniqueSources = sources.filter(
    (source, position) => source && sources.indexOf(source) === position
  );
  const layers = hasPlaceholder ? uniqueSources : uniqueSources.slice(-1);

  return (
    <div
      className={cn(
        "progressive-screenshot-image",
        `progressive-screenshot-image--${fit}`,
        className
      )}
    >
      {hasPlaceholder ? (
        <img
          className="progressive-screenshot-image__placeholder"
          src={placeholder ?? undefined}
          alt=""
          aria-hidden
          draggable={false}
          onLoad={onPlaceholderLoad}
          onError={() => setFailedPlaceholder(placeholder ?? null)}
        />
      ) : null}
      {layers.map((source, position) => (
        <ProgressiveLayer
          key={`level-${position}`}
          source={source}
          alt={alt}
          isTop={position === layers.length - 1}
          isPlain={!hasPlaceholder}
          loading={loading}
          onLoad={onLoad}
          onError={onError}
        />
      ))}
    </div>
  );
}
