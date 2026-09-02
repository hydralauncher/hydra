import "./styles.scss";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

import {
  Backdrop,
  FocusItem,
  NavigationLayer,
  VerticalFocusGroup,
} from "../../../common";
import { FocusRegionContext } from "../../../context";

const SOUVENIR_VIEWER_REGION_ID = "game-achievements-souvenir-viewer";
const SOUVENIR_VIEWER_ITEM_ID = "game-achievements-souvenir-viewer-image";

interface ViewerImageSize {
  width: number;
  height: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

const VIEWPORT_FILL_RATIO = 0.86;

const getViewportSize = (): ViewportSize => ({
  width: globalThis.window.innerWidth,
  height: globalThis.window.innerHeight,
});

const getViewerImageSize = (
  naturalSize: ViewerImageSize | null,
  viewportSize: ViewportSize
): ViewerImageSize | null => {
  if (!naturalSize?.width || !naturalSize.height) return null;

  const scale = Math.min(
    (viewportSize.width * VIEWPORT_FILL_RATIO) / naturalSize.width,
    (viewportSize.height * VIEWPORT_FILL_RATIO) / naturalSize.height
  );

  return {
    width: naturalSize.width * scale,
    height: naturalSize.height * scale,
  };
};

export interface GameAchievementsSouvenirViewerProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export function GameAchievementsSouvenirViewer({
  src,
  alt,
  onClose,
}: Readonly<GameAchievementsSouvenirViewerProps>) {
  const [naturalSize, setNaturalSize] = useState<ViewerImageSize | null>(null);
  const [viewportSize, setViewportSize] = useState(getViewportSize);

  useEffect(() => {
    setNaturalSize(null);
  }, [src]);

  useEffect(() => {
    const handleResize = () => setViewportSize(getViewportSize());

    globalThis.window.addEventListener("resize", handleResize);

    return () => globalThis.window.removeEventListener("resize", handleResize);
  }, []);

  const imageSize = getViewerImageSize(naturalSize, viewportSize);

  const portalTarget =
    document.getElementById("big-picture") ??
    document.getElementById("root") ??
    document.body;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <Backdrop className="game-achievements-souvenir-viewer__backdrop">
        <div
          className="game-achievements-souvenir-viewer__overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <NavigationLayer
            rootRegionId={SOUVENIR_VIEWER_REGION_ID}
            initialFocusId={SOUVENIR_VIEWER_ITEM_ID}
            restoreFocusOnUnmount
          >
            <VerticalFocusGroup regionId={SOUVENIR_VIEWER_REGION_ID} asChild>
              <div className="game-achievements-souvenir-viewer__stage">
                <FocusItem
                  id={SOUVENIR_VIEWER_ITEM_ID}
                  actions={{ primary: "off" }}
                  asChild
                >
                  <div
                    className="game-achievements-souvenir-viewer__frame"
                    style={imageSize ?? undefined}
                  >
                    <img
                      className="game-achievements-souvenir-viewer__image"
                      src={src}
                      alt={alt}
                      draggable={false}
                      onLoad={(event) =>
                        setNaturalSize({
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight,
                        })
                      }
                    />
                  </div>
                </FocusItem>
              </div>
            </VerticalFocusGroup>
          </NavigationLayer>
        </div>
      </Backdrop>
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
