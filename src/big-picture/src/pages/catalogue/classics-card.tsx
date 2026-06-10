import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import { QuestionIcon } from "@phosphor-icons/react";
import { CatalogueCardShell, type CatalogueCardProps } from "./card-shell";

const DEFAULT_CLASSICS_COVER_RATIO = 2 / 3;
const CLASSICS_COVER_RATIO_EPSILON = 0.001;

interface Size {
  width: number;
  height: number;
}

function getStageContentSize(element: HTMLElement): Size {
  const computedStyle = globalThis.getComputedStyle(element);
  const paddingInline =
    parseFloat(computedStyle.paddingLeft) +
    parseFloat(computedStyle.paddingRight);
  const paddingBlock =
    parseFloat(computedStyle.paddingTop) +
    parseFloat(computedStyle.paddingBottom);

  return {
    width: Math.max(0, element.clientWidth - paddingInline),
    height: Math.max(0, element.clientHeight - paddingBlock),
  };
}

export function CatalogueClassicsCard({
  game,
  navigationOverrides,
}: Readonly<CatalogueCardProps>) {
  const [stageElement, setStageElement] = useState<HTMLSpanElement | null>(
    null
  );
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
  const [imageRatio, setImageRatio] = useState<number | null>(null);

  const updateStageSize = useCallback((element: HTMLElement | null) => {
    if (!element) return;

    const nextSize = getStageContentSize(element);

    setStageSize((currentSize) => {
      if (
        currentSize.width === nextSize.width &&
        currentSize.height === nextSize.height
      ) {
        return currentSize;
      }

      return nextSize;
    });
  }, []);

  const updateImageRatio = useCallback((element: HTMLImageElement | null) => {
    if (!element?.naturalWidth || !element.naturalHeight) return;

    const nextRatio = element.naturalWidth / element.naturalHeight;

    setImageRatio((currentRatio) => {
      if (
        currentRatio !== null &&
        Math.abs(currentRatio - nextRatio) < CLASSICS_COVER_RATIO_EPSILON
      ) {
        return currentRatio;
      }

      return nextRatio;
    });
  }, []);

  const handleStageRef = useCallback(
    (element: HTMLSpanElement | null) => {
      setStageElement(element);
      updateStageSize(element);
    },
    [updateStageSize]
  );

  const handleCoverImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      updateImageRatio(event.currentTarget);
    },
    [updateImageRatio]
  );

  const handleCoverImageRef = useCallback(
    (element: HTMLImageElement | null) => {
      updateImageRatio(element);
    },
    [updateImageRatio]
  );

  useEffect(() => {
    setImageRatio(null);
  }, [game.libraryImageUrl]);

  useLayoutEffect(() => {
    if (!stageElement) return;

    updateStageSize(stageElement);

    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => {
      updateStageSize(stageElement);
    });

    resizeObserver.observe(stageElement);

    return () => resizeObserver.disconnect();
  }, [stageElement, updateStageSize]);

  const coverStyle = useMemo<CSSProperties | undefined>(() => {
    if (stageSize.width <= 0 || stageSize.height <= 0) {
      return {
        height: "100%",
        aspectRatio: `${DEFAULT_CLASSICS_COVER_RATIO}`,
      };
    }

    const ratio = imageRatio ?? DEFAULT_CLASSICS_COVER_RATIO;
    const widthFromHeight = stageSize.height * ratio;

    if (widthFromHeight <= stageSize.width) {
      return {
        width: `${widthFromHeight}px`,
        height: `${stageSize.height}px`,
      };
    }

    return {
      width: `${stageSize.width}px`,
      height: `${stageSize.width / ratio}px`,
    };
  }, [imageRatio, stageSize.height, stageSize.width]);

  return (
    <CatalogueCardShell
      game={game}
      navigationOverrides={navigationOverrides}
      className="catalogue-card--classics-cover"
      imageClassName="catalogue-card__image--classics-cover"
      downloadSourcesClassName="catalogue-card__download-sources--classics-cover"
      renderEmptyDownloadSources
      imageContent={
        game.libraryImageUrl ? (
          <>
            <img
              className="catalogue-card__cover-backdrop"
              src={game.libraryImageUrl}
              alt=""
              aria-hidden
              loading="lazy"
            />

            <span ref={handleStageRef} className="catalogue-card__cover-stage">
              <span className="catalogue-card__cover-case" style={coverStyle}>
                <span className="catalogue-card__cover-case-front">
                  <img
                    ref={handleCoverImageRef}
                    src={game.libraryImageUrl}
                    alt={game.title}
                    loading="lazy"
                    onLoad={handleCoverImageLoad}
                  />
                </span>
                <span
                  className="catalogue-card__cover-case-spine"
                  style={{ backgroundImage: `url(${game.libraryImageUrl})` }}
                  aria-hidden
                />
                <span className="catalogue-card__cover-case-edge" aria-hidden />
              </span>
            </span>
          </>
        ) : (
          <span className="catalogue-card__cover-stage">
            <div className="catalogue-card__cover-placeholder">
              <QuestionIcon size={28} />
            </div>
          </span>
        )
      }
    />
  );
}
