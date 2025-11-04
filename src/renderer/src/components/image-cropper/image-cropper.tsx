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



  const calculateInitialCropArea = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) return;

    const maxWidth = containerRect.width - 40;
    const maxHeight = containerRect.height - 200;

    if (maxWidth <= 0 || maxHeight <= 0) return;

    const imageAspect = imageSize.width / imageSize.height;
    let displayWidth = imageSize.width * zoom;
    let displayHeight = imageSize.height * zoom;

    if (displayWidth > maxWidth) {
      displayWidth = maxWidth;
      displayHeight = displayWidth / imageAspect;
    }
    if (displayHeight > maxHeight) {
      displayHeight = maxHeight;
      displayWidth = displayHeight * imageAspect;
    }

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
  }, [imageSize, aspectRatio, circular]);

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

  const getDisplaySize = useCallback(() => {
    if (!imageLoaded) return { width: 0, height: 0 };

    const container = containerRef.current;
    if (!container) {
      return {
        width: imageSize.width * zoom,
        height: imageSize.height * zoom,
      };
    }

    const containerRect = container.getBoundingClientRect();
    const maxWidth = containerRect.width - 40;
    const maxHeight = containerRect.height - 200;

    const imageAspect = imageSize.width / imageSize.height;
    let displayWidth = imageSize.width * zoom;
    let displayHeight = imageSize.height * zoom;

    if (displayWidth > maxWidth) {
      displayWidth = maxWidth;
      displayHeight = displayWidth / imageAspect;
    }
    if (displayHeight > maxHeight) {
      displayHeight = maxHeight;
      displayWidth = displayHeight * imageAspect;
    }

    return {
      width: displayWidth,
      height: displayHeight,
    };
  }, [imageLoaded, imageSize]);

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

  const constrainCropArea = useCallback(
    (area: CropArea): CropArea => {
      const displaySize = getDisplaySize();
      let { x, y, width, height } = area;

      const effectiveAspectRatio = circular ? 1 : aspectRatio;

      if (effectiveAspectRatio) {
        const currentRatio = width / height;
        if (currentRatio > effectiveAspectRatio) {
          height = width / effectiveAspectRatio;
        } else {
          width = height * effectiveAspectRatio;
        }
      }

      let minSize = minCropSize;
      if (effectiveAspectRatio) {
        if (effectiveAspectRatio > 1) {
          minSize = minCropSize * effectiveAspectRatio;
        } else {
          minSize = minCropSize / effectiveAspectRatio;
        }
      }

      width = Math.max(minSize, Math.min(width, displaySize.width));
      height = Math.max(minSize, Math.min(height, displaySize.height));

      if (effectiveAspectRatio) {
        if (width / height > effectiveAspectRatio) {
          width = height * effectiveAspectRatio;
        } else {
          height = width / effectiveAspectRatio;
        }
      }

      x = Math.max(0, Math.min(x, displaySize.width - width));
      y = Math.max(0, Math.min(y, displaySize.height - height));

      return { x, y, width, height };
    },
    [getDisplaySize, circular, aspectRatio, minCropSize]
  );

  const getRelativeCoordinates = (
    e: MouseEvent | React.MouseEvent
  ): { x: number; y: number } | null => {
    const imageWrapper = imageRef.current?.parentElement;
    if (!imageWrapper) return null;

    const rect = imageWrapper.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleDrag = useCallback(
    (coords: { x: number; y: number }) => {
      const newX = coords.x - dragStart.x;
      const newY = coords.y - dragStart.y;
      setCropArea((prev) =>
        constrainCropArea({ ...prev, x: newX, y: newY })
      );
    },
    [dragStart, constrainCropArea]
  );

  const calculateResizeDeltas = (
    resizeHandle: string,
    coords: { x: number; y: number },
    cropStart: CropArea
  ) => {
    if (resizeHandle === "resize-se") {
      return {
        deltaX: coords.x - (cropStart.x + cropStart.width),
        deltaY: coords.y - (cropStart.y + cropStart.height),
        newX: cropStart.x,
        newY: cropStart.y,
      };
    }
    if (resizeHandle === "resize-sw") {
      return {
        deltaX: cropStart.x - coords.x,
        deltaY: coords.y - (cropStart.y + cropStart.height),
        newX: coords.x,
        newY: cropStart.y,
      };
    }
    if (resizeHandle === "resize-ne") {
      return {
        deltaX: coords.x - (cropStart.x + cropStart.width),
        deltaY: cropStart.y - coords.y,
        newX: cropStart.x,
        newY: coords.y,
      };
    }
    if (resizeHandle === "resize-nw") {
      return {
        deltaX: cropStart.x - coords.x,
        deltaY: cropStart.y - coords.y,
        newX: coords.x,
        newY: coords.y,
      };
    }
    return {
      deltaX: 0,
      deltaY: 0,
      newX: cropStart.x,
      newY: cropStart.y,
    };
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
    let adjustedX = cropStart.x;
    let adjustedY = cropStart.y;

    if (resizeHandle === "resize-nw" || resizeHandle === "resize-sw") {
      adjustedX = cropStart.x + cropStart.width - adjustedWidth;
    }
    if (resizeHandle === "resize-nw" || resizeHandle === "resize-ne") {
      adjustedY = cropStart.y + cropStart.height - adjustedHeight;
    }

    return {
      width: adjustedWidth,
      height: adjustedHeight,
      x: adjustedX,
      y: adjustedY,
    };
  };

  const applyAspectRatioConstraint = (
    newWidth: number,
    newHeight: number,
    cropStart: CropArea,
    resizeHandle: string,
    aspectRatio: number
  ) => {
    const currentRatio = newWidth / newHeight;
    let adjustedWidth = newWidth;
    let adjustedHeight = newHeight;

    if (currentRatio > aspectRatio) {
      adjustedHeight = newWidth / aspectRatio;
    } else {
      adjustedWidth = newHeight * aspectRatio;
    }

    let adjustedX = cropStart.x;
    let adjustedY = cropStart.y;

    if (resizeHandle === "resize-nw" || resizeHandle === "resize-sw") {
      adjustedX = cropStart.x + cropStart.width - adjustedWidth;
    }
    if (resizeHandle === "resize-nw" || resizeHandle === "resize-ne") {
      adjustedY = cropStart.y + cropStart.height - adjustedHeight;
    }

    return {
      width: adjustedWidth,
      height: adjustedHeight,
      x: adjustedX,
      y: adjustedY,
    };
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
    [imageLoaded, isDragging, isResizing, cropStart, resizeHandle, handleDrag, handleResize]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeHandle(null);
    setCropStart(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
      }
    },
    []
  );

  const handleOverlayKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 1;
      let newX = cropArea.x;
      let newY = cropArea.y;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        newX = cropArea.x - step;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        newX = cropArea.x + step;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        newY = cropArea.y - step;
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        newY = cropArea.y + step;
      } else {
        return;
      }

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
      <div
        className="image-cropper__container"
        ref={containerRef}
      >
        <div className="image-cropper__image-wrapper">
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
              <button
                type="button"
                className="image-cropper__crop-handle image-cropper__crop-handle--nw"
                data-handle="resize-nw"
                aria-label={t("resize_handle_nw")}
                onMouseDown={handleMouseDown}
                onKeyDown={handleKeyDown}
              />
              <button
                type="button"
                className="image-cropper__crop-handle image-cropper__crop-handle--ne"
                data-handle="resize-ne"
                aria-label={t("resize_handle_ne")}
                onMouseDown={handleMouseDown}
                onKeyDown={handleKeyDown}
              />
              <button
                type="button"
                className="image-cropper__crop-handle image-cropper__crop-handle--sw"
                data-handle="resize-sw"
                aria-label={t("resize_handle_sw")}
                onMouseDown={handleMouseDown}
                onKeyDown={handleKeyDown}
              />
              <button
                type="button"
                className="image-cropper__crop-handle image-cropper__crop-handle--se"
                data-handle="resize-se"
                aria-label={t("resize_handle_se")}
                onMouseDown={handleMouseDown}
                onKeyDown={handleKeyDown}
              />
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

