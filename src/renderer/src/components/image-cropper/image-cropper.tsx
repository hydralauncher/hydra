import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../button/button";
import { useTranslation } from "react-i18next";
import { logger } from "@renderer/logger";
import "./image-cropper.scss";

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageCropperProps {
  imagePath: string;
  onCrop: (cropArea: CropArea) => Promise<void>;
  onCancel: () => void;
  aspectRatio?: number;
  circular?: boolean;
  minCropSize?: number;
}

export function ImageCropper({
  imagePath,
  onCrop,
  onCancel,
  aspectRatio,
  circular = false,
  minCropSize = 50,
}: Readonly<ImageCropperProps>) {
  const { t } = useTranslation("user_profile");
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const zoom = 0.5;
  const [cropArea, setCropArea] = useState<CropArea>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [cropStart, setCropStart] = useState<CropArea | null>(null);
  const [isCropping, setIsCropping] = useState(false);

  const getImageSrc = () => {
    return imagePath.startsWith("local:") ? imagePath : `local:${imagePath}`;
  };

  const calculateContainerBounds = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;

    const containerRect = container.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) return null;

    const computedStyle = globalThis.getComputedStyle(container);
    const paddingLeft = Number.parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(computedStyle.paddingRight) || 0;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;

    return {
      maxWidth: containerRect.width - paddingLeft - paddingRight,
      maxHeight: containerRect.height - paddingTop - paddingBottom,
    };
  }, []);

  const calculateDisplayDimensions = useCallback(
    (bounds: { maxWidth: number; maxHeight: number } | null) => {
      if (!imageLoaded) return { width: 0, height: 0 };

      if (!bounds) {
        return {
          width: imageSize.width * zoom,
          height: imageSize.height * zoom,
        };
      }

      const imageAspect = imageSize.width / imageSize.height;
      let displayWidth = imageSize.width * zoom;
      let displayHeight = imageSize.height * zoom;

      if (displayWidth > bounds.maxWidth) {
        displayWidth = bounds.maxWidth;
        displayHeight = displayWidth / imageAspect;
      }
      if (displayHeight > bounds.maxHeight) {
        displayHeight = bounds.maxHeight;
        displayWidth = displayHeight * imageAspect;
      }

      return { width: displayWidth, height: displayHeight };
    },
    [imageLoaded, imageSize]
  );

  const calculateInitialCropArea = useCallback(() => {
    const bounds = calculateContainerBounds();
    if (!bounds || bounds.maxWidth <= 0 || bounds.maxHeight <= 0) return;

    const { width: displayWidth, height: displayHeight } =
      calculateDisplayDimensions(bounds);

    const effectiveAspectRatio = circular ? 1 : aspectRatio;
    let cropWidth: number;
    let cropHeight: number;

    if (effectiveAspectRatio) {
      const displayAspect = displayWidth / displayHeight;
      if (displayAspect > effectiveAspectRatio) {
        cropHeight = displayHeight * 0.8;
        cropWidth = cropHeight * effectiveAspectRatio;
      } else {
        cropWidth = displayWidth * 0.8;
        cropHeight = cropWidth / effectiveAspectRatio;
      }
    } else {
      const cropSize = Math.min(displayWidth, displayHeight) * 0.8;
      cropWidth = cropSize;
      cropHeight = cropSize;
    }

    setCropArea({
      x: (displayWidth - cropWidth) / 2,
      y: (displayHeight - cropHeight) / 2,
      width: cropWidth,
      height: cropHeight,
    });
  }, [
    calculateContainerBounds,
    calculateDisplayDimensions,
    aspectRatio,
    circular,
  ]);

  const getDisplaySize = useCallback(() => {
    const bounds = calculateContainerBounds();
    return calculateDisplayDimensions(bounds);
  }, [calculateContainerBounds, calculateDisplayDimensions]);

  useEffect(() => {
    const img = new Image();
    const handleImageLoad = () => {
      setImageSize({ width: img.width, height: img.height });
      setImageLoaded(true);
    };
    const handleImageError = (error: Event | string) => {
      logger.error("Failed to load image:", { src: getImageSrc(), error });
    };
    img.onload = handleImageLoad;
    img.onerror = handleImageError;
    img.src = getImageSrc();
  }, [imagePath]);

  useEffect(() => {
    if (!imageLoaded || imageSize.width === 0 || imageSize.height === 0) return;

    const performDoubleAnimationFrame = () => {
      calculateInitialCropArea();
    };

    const handleAnimationFrame = () => {
      requestAnimationFrame(performDoubleAnimationFrame);
    };

    const calculateWithDelay = () => {
      const container = containerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      if (containerRect.width === 0 || containerRect.height === 0) return;

      requestAnimationFrame(handleAnimationFrame);
    };

    const handleResize = () => {
      calculateWithDelay();
    };

    const timeoutId = setTimeout(calculateWithDelay, 200);

    const resizeObserver = new ResizeObserver(handleResize);

    const container = containerRef.current;
    if (container) {
      resizeObserver.observe(container);
    }

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [imageLoaded, imageSize, calculateInitialCropArea]);

  const getRealCropArea = (): CropArea => {
    if (!imageLoaded || imageSize.width === 0 || imageSize.height === 0) {
      return cropArea;
    }

    const displaySize = getDisplaySize();
    if (displaySize.width === 0 || displaySize.height === 0) {
      return cropArea;
    }

    const scaleX = imageSize.width / displaySize.width;
    const scaleY = imageSize.height / displaySize.height;

    return {
      x: cropArea.x * scaleX,
      y: cropArea.y * scaleY,
      width: cropArea.width * scaleX,
      height: cropArea.height * scaleY,
    };
  };

  const enforceAspectRatio = (
    width: number,
    height: number,
    ratio: number
  ): { width: number; height: number } => {
    const currentRatio = width / height;
    if (currentRatio > ratio) {
      return { width, height: width / ratio };
    }
    return { width: height * ratio, height };
  };

  const calculateMinSize = useCallback(
    (effectiveAspectRatio: number | undefined) => {
      if (!effectiveAspectRatio) return minCropSize;
      return effectiveAspectRatio > 1
        ? minCropSize * effectiveAspectRatio
        : minCropSize / effectiveAspectRatio;
    },
    [minCropSize]
  );

  const getImageWrapperBounds = useCallback(() => {
    const imageWrapper = imageRef.current?.parentElement;
    if (!imageWrapper) return { width: 0, height: 0 };

    const rect = imageWrapper.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, []);

  const constrainCropArea = useCallback(
    (area: CropArea): CropArea => {
      const displaySize = getDisplaySize();
      const wrapperBounds = getImageWrapperBounds();
      const actualBounds = {
        width:
          wrapperBounds.width > 0 ? wrapperBounds.width : displaySize.width,
        height:
          wrapperBounds.height > 0 ? wrapperBounds.height : displaySize.height,
      };

      let { x, y, width, height } = area;
      const effectiveAspectRatio = circular ? 1 : aspectRatio;
      const minSize = calculateMinSize(effectiveAspectRatio);

      if (effectiveAspectRatio) {
        ({ width, height } = enforceAspectRatio(
          width,
          height,
          effectiveAspectRatio
        ));

        const maxWidth = Math.min(
          actualBounds.width,
          actualBounds.height * effectiveAspectRatio
        );
        const maxHeight = Math.min(
          actualBounds.height,
          actualBounds.width / effectiveAspectRatio
        );

        width = Math.max(minSize, Math.min(width, maxWidth));
        height = Math.max(minSize, Math.min(height, maxHeight));

        ({ width, height } = enforceAspectRatio(
          width,
          height,
          effectiveAspectRatio
        ));

        width = Math.min(width, actualBounds.width);
        height = Math.min(height, actualBounds.height);
        ({ width, height } = enforceAspectRatio(
          width,
          height,
          effectiveAspectRatio
        ));
      } else {
        width = Math.max(minSize, Math.min(width, actualBounds.width));
        height = Math.max(minSize, Math.min(height, actualBounds.height));
      }

      x = Math.max(0, Math.min(x, actualBounds.width - width));
      y = Math.max(0, Math.min(y, actualBounds.height - height));

      return { x, y, width, height };
    },
    [
      getDisplaySize,
      getImageWrapperBounds,
      circular,
      aspectRatio,
      calculateMinSize,
    ]
  );

  const getRelativeCoordinates = (
    e: MouseEvent | React.MouseEvent
  ): { x: number; y: number } | null => {
    const imageWrapper = imageRef.current?.parentElement;
    if (!imageWrapper) return null;

    const rect = imageWrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    return { x, y };
  };

  const handleDrag = useCallback(
    (coords: { x: number; y: number }) => {
      const newX = coords.x - dragStart.x;
      const newY = coords.y - dragStart.y;
      setCropArea((prev) => constrainCropArea({ ...prev, x: newX, y: newY }));
    },
    [dragStart, constrainCropArea]
  );

  const calculateResizeDeltas = (
    resizeHandle: string,
    coords: { x: number; y: number },
    cropStart: CropArea
  ) => {
    const handleMap: Record<
      string,
      (
        coords: { x: number; y: number },
        cropStart: CropArea
      ) => {
        deltaX: number;
        deltaY: number;
        newX: number;
        newY: number;
      }
    > = {
      "resize-se": (c, cs) => ({
        deltaX: c.x - (cs.x + cs.width),
        deltaY: c.y - (cs.y + cs.height),
        newX: cs.x,
        newY: cs.y,
      }),
      "resize-sw": (c, cs) => ({
        deltaX: cs.x - c.x,
        deltaY: c.y - (cs.y + cs.height),
        newX: c.x,
        newY: cs.y,
      }),
      "resize-ne": (c, cs) => ({
        deltaX: c.x - (cs.x + cs.width),
        deltaY: cs.y - c.y,
        newX: cs.x,
        newY: c.y,
      }),
      "resize-nw": (c, cs) => ({
        deltaX: cs.x - c.x,
        deltaY: cs.y - c.y,
        newX: c.x,
        newY: c.y,
      }),
    };

    const handler = handleMap[resizeHandle];
    if (handler) {
      return handler(coords, cropStart);
    }

    return {
      deltaX: 0,
      deltaY: 0,
      newX: cropStart.x,
      newY: cropStart.y,
    };
  };

  const adjustPositionForHandle = (
    resizeHandle: string,
    cropStart: CropArea,
    adjustedWidth: number,
    adjustedHeight: number
  ) => {
    let adjustedX = cropStart.x;
    let adjustedY = cropStart.y;

    if (resizeHandle === "resize-nw" || resizeHandle === "resize-sw") {
      adjustedX = cropStart.x + cropStart.width - adjustedWidth;
    }
    if (resizeHandle === "resize-nw" || resizeHandle === "resize-ne") {
      adjustedY = cropStart.y + cropStart.height - adjustedHeight;
    }

    return { x: adjustedX, y: adjustedY };
  };

  const applyCircularConstraint = (
    newWidth: number,
    newHeight: number,
    cropStart: CropArea,
    resizeHandle: string
  ) => {
    const size = Math.min(newWidth, newHeight);
    const deltaSize = size - Math.min(cropStart.width, cropStart.height);
    const adjustedWidth = cropStart.width + deltaSize;
    const adjustedHeight = cropStart.height + deltaSize;

    const { x, y } = adjustPositionForHandle(
      resizeHandle,
      cropStart,
      adjustedWidth,
      adjustedHeight
    );

    return { width: adjustedWidth, height: adjustedHeight, x, y };
  };

  const applyAspectRatioConstraint = (
    newWidth: number,
    newHeight: number,
    cropStart: CropArea,
    resizeHandle: string,
    aspectRatio: number
  ) => {
    const deltaX = Math.abs(newWidth - cropStart.width);
    const deltaY = Math.abs(newHeight - cropStart.height);

    let adjustedWidth: number;
    let adjustedHeight: number;

    if (deltaX > deltaY) {
      adjustedWidth = newWidth;
      adjustedHeight = newWidth / aspectRatio;
    } else {
      adjustedHeight = newHeight;
      adjustedWidth = newHeight * aspectRatio;
    }

    const wrapperBounds = getImageWrapperBounds();
    const displaySize = getDisplaySize();
    const actualBounds = {
      width: wrapperBounds.width > 0 ? wrapperBounds.width : displaySize.width,
      height:
        wrapperBounds.height > 0 ? wrapperBounds.height : displaySize.height,
    };

    const maxWidth = Math.min(
      actualBounds.width,
      actualBounds.height * aspectRatio
    );
    const maxHeight = Math.min(
      actualBounds.height,
      actualBounds.width / aspectRatio
    );

    adjustedWidth = Math.min(adjustedWidth, maxWidth);
    adjustedHeight = Math.min(adjustedHeight, maxHeight);

    const finalRatio = adjustedWidth / adjustedHeight;
    if (Math.abs(finalRatio - aspectRatio) > 0.001) {
      if (finalRatio > aspectRatio) {
        adjustedHeight = adjustedWidth / aspectRatio;
      } else {
        adjustedWidth = adjustedHeight * aspectRatio;
      }
    }

    const { x, y } = adjustPositionForHandle(
      resizeHandle,
      cropStart,
      adjustedWidth,
      adjustedHeight
    );

    return { width: adjustedWidth, height: adjustedHeight, x, y };
  };

  const handleResize = useCallback(
    (coords: { x: number; y: number }) => {
      if (!cropStart || !resizeHandle) return;

      const { deltaX, deltaY, newX, newY } = calculateResizeDeltas(
        resizeHandle,
        coords,
        cropStart
      );

      let adjustedWidth = cropStart.width + deltaX;
      let adjustedHeight = cropStart.height + deltaY;
      let adjustedX = newX;
      let adjustedY = newY;

      if (circular) {
        const constrained = applyCircularConstraint(
          adjustedWidth,
          adjustedHeight,
          cropStart,
          resizeHandle
        );
        adjustedWidth = constrained.width;
        adjustedHeight = constrained.height;
        adjustedX = constrained.x;
        adjustedY = constrained.y;
      } else if (aspectRatio) {
        const constrained = applyAspectRatioConstraint(
          adjustedWidth,
          adjustedHeight,
          cropStart,
          resizeHandle,
          aspectRatio
        );
        adjustedWidth = constrained.width;
        adjustedHeight = constrained.height;
        adjustedX = constrained.x;
        adjustedY = constrained.y;
      }

      const newCropArea = constrainCropArea({
        x: adjustedX,
        y: adjustedY,
        width: adjustedWidth,
        height: adjustedHeight,
      });
      setCropArea(newCropArea);
    },
    [cropStart, resizeHandle, circular, aspectRatio, constrainCropArea]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!imageLoaded) return;
      e.preventDefault();
      e.stopPropagation();

      const coords = getRelativeCoordinates(e);
      if (!coords) return;

      const handle = (e.target as HTMLElement)?.dataset?.handle;
      if (handle?.startsWith("resize-")) {
        setIsResizing(true);
        setResizeHandle(handle);
        setCropStart(cropArea);
      } else if (
        coords.x >= cropArea.x &&
        coords.x <= cropArea.x + cropArea.width &&
        coords.y >= cropArea.y &&
        coords.y <= cropArea.y + cropArea.height
      ) {
        setIsDragging(true);
        setDragStart({ x: coords.x - cropArea.x, y: coords.y - cropArea.y });
      }
    },
    [imageLoaded, cropArea]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!imageLoaded) return;

      const coords = getRelativeCoordinates(e);
      if (!coords) return;

      if (isDragging && cropStart === null) {
        handleDrag(coords);
      } else if (isResizing && cropStart && resizeHandle) {
        handleResize(coords);
      }
    },
    [
      imageLoaded,
      isDragging,
      isResizing,
      cropStart,
      resizeHandle,
      handleDrag,
      handleResize,
    ]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeHandle(null);
    setCropStart(null);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
    }
  }, []);

  const handleOverlayKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 1;
      const keyMap: Record<
        string,
        (area: CropArea) => { x: number; y: number }
      > = {
        ArrowLeft: (area) => ({ x: area.x - step, y: area.y }),
        ArrowRight: (area) => ({ x: area.x + step, y: area.y }),
        ArrowUp: (area) => ({ x: area.x, y: area.y - step }),
        ArrowDown: (area) => ({ x: area.x, y: area.y + step }),
      };

      const handler = keyMap[e.key];
      if (!handler) return;

      e.preventDefault();
      const { x: newX, y: newY } = handler(cropArea);
      setCropArea((prev) => constrainCropArea({ ...prev, x: newX, y: newY }));
    },
    [cropArea, constrainCropArea]
  );

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const cleanup = () => {
      globalThis.removeEventListener("mousemove", handleMouseMove);
      globalThis.removeEventListener("mouseup", handleMouseUp);
    };

    globalThis.addEventListener("mousemove", handleMouseMove);
    globalThis.addEventListener("mouseup", handleMouseUp);
    return cleanup;
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  const handleCrop = async () => {
    setIsCropping(true);
    try {
      const realCropArea = getRealCropArea();
      await onCrop(realCropArea);
    } finally {
      setIsCropping(false);
    }
  };

  const displaySize = getDisplaySize();

  return (
    <div className="image-cropper">
      <div className="image-cropper__container" ref={containerRef}>
        <div
          className="image-cropper__image-wrapper"
          style={{
            width: `${displaySize.width}px`,
            height: `${displaySize.height}px`,
            maxWidth: "100%",
            maxHeight: "100%",
          }}
        >
          {imageLoaded && (
            <img
              ref={imageRef}
              src={getImageSrc()}
              alt="Crop"
              className="image-cropper__image"
              style={{
                width: `${displaySize.width}px`,
                height: `${displaySize.height}px`,
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            />
          )}
          {imageLoaded && cropArea.width > 0 && cropArea.height > 0 && (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
            <section
              className={`image-cropper__crop-overlay ${circular ? "image-cropper__crop-overlay--circular" : ""}`}
              style={{
                left: `${cropArea.x}px`,
                top: `${cropArea.y}px`,
                width: `${cropArea.width}px`,
                height: `${cropArea.height}px`,
              }}
              aria-label={t("crop_area")}
              onMouseDown={handleMouseDown}
              onKeyDown={handleOverlayKeyDown}
            >
              {(["nw", "ne", "sw", "se"] as const).map((position) => (
                <button
                  key={position}
                  type="button"
                  className={`image-cropper__crop-handle image-cropper__crop-handle--${position}`}
                  data-handle={`resize-${position}`}
                  aria-label={t(`resize_handle_${position}`)}
                  onMouseDown={handleMouseDown}
                  onKeyDown={handleKeyDown}
                />
              ))}
            </section>
          )}
        </div>
      </div>

      <div className="image-cropper__controls">
        <div className="image-cropper__actions">
          <Button theme="outline" onClick={onCancel} disabled={isCropping}>
            {t("cancel")}
          </Button>
          <Button
            theme="primary"
            onClick={handleCrop}
            disabled={isCropping || !imageLoaded}
          >
            {isCropping ? t("cropping") : t("crop")}
          </Button>
        </div>
      </div>
    </div>
  );
}
