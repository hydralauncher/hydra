import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Grid2x2Icon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
  RotateCcwSquareIcon,
} from "lucide-react";
import { Button, Modal } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";

import "./profile-image-crop-modal.scss";

type CropVariant = "avatar" | "banner";

interface ProfileImageCropModalProps {
  visible: boolean;
  imagePath: string | null;
  variant: CropVariant;
  /** Kept for callers that annotate animated inputs. All final crop/export
   * work is handled in the main process so the renderer canvas is never tainted. */
  isAnimated?: boolean;
  onClose: () => void;
  onApply: (croppedImagePath: string) => void;
}

const CROP_OUTPUT_SIZE: Record<CropVariant, { width: number; height: number }> =
  {
    avatar: { width: 512, height: 512 },
    banner: { width: 1600, height: 400 },
  };

const MAX_ZOOM = 4;
const MIN_ZOOM = 1;
const ZOOM_STEP = 0.25;
const KEYBOARD_PAN_STEP = 10;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function ProfileImageCropModal({
  visible,
  imagePath,
  variant,
  onClose,
  onApply,
}: ProfileImageCropModalProps) {
  const { t } = useTranslation("user_profile");
  const { showErrorToast } = useToast();

  const frameRef = useRef<HTMLButtonElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const interactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [rotation, setRotation] = useState(0);
  const [isApplying, setIsApplying] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [gridPinned, setGridPinned] = useState(false);

  const showGrid = gridPinned || isInteracting;

  const outputSize = CROP_OUTPUT_SIZE[variant];

  // Width/height of the image as the user sees it after rotation: a
  // quarter turn swaps the two. All fit/pan/clamp math works in this space.
  const isQuarterTurn = rotation === 90 || rotation === 270;
  const effImageSize = useMemo(
    () => ({
      width: isQuarterTurn ? imageSize.height : imageSize.width,
      height: isQuarterTurn ? imageSize.width : imageSize.height,
    }),
    [imageSize, isQuarterTurn]
  );

  const minScale = useMemo(() => {
    if (!frameSize.width || !frameSize.height || !effImageSize.width) return 1;

    return Math.max(
      frameSize.width / effImageSize.width,
      frameSize.height / effImageSize.height
    );
  }, [frameSize, effImageSize]);

  const scale = minScale * zoom;

  const clampPosition = useCallback(
    (
      nextPosition: { x: number; y: number },
      nextScale: number
    ): { x: number; y: number } => {
      if (!frameSize.width || !frameSize.height || !effImageSize.width) {
        return nextPosition;
      }

      // Round up so sub-pixel scaling never leaves a hairline gap
      // between the image edge and the frame (checkerboard bleed).
      const renderedWidth = Math.ceil(effImageSize.width * nextScale);
      const renderedHeight = Math.ceil(effImageSize.height * nextScale);

      const minX = Math.min(frameSize.width - renderedWidth, 0);
      const minY = Math.min(frameSize.height - renderedHeight, 0);

      return {
        x: clamp(nextPosition.x, minX, 0),
        y: clamp(nextPosition.y, minY, 0),
      };
    },
    [frameSize, effImageSize]
  );

  const centerImage = useCallback(
    (nextZoom = MIN_ZOOM) => {
      const nextScale = minScale * nextZoom;
      const nextPosition = {
        x: (frameSize.width - effImageSize.width * nextScale) / 2,
        y: (frameSize.height - effImageSize.height * nextScale) / 2,
      };

      setZoom(nextZoom);
      setPosition(clampPosition(nextPosition, nextScale));
    },
    [clampPosition, frameSize, effImageSize, minScale]
  );

  const updateZoom = useCallback(
    (nextZoom: number, focalPoint?: { x: number; y: number }) => {
      const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      const nextScale = minScale * clampedZoom;
      const scaleRatio = nextScale / scale;
      const point = focalPoint ?? {
        x: frameSize.width / 2,
        y: frameSize.height / 2,
      };

      const nextPosition = {
        x: point.x - (point.x - position.x) * scaleRatio,
        y: point.y - (point.y - position.y) * scaleRatio,
      };

      setZoom(clampedZoom);
      setPosition(clampPosition(nextPosition, nextScale));
    },
    [clampPosition, frameSize, minScale, position, scale]
  );

  useEffect(() => {
    if (!visible) {
      setImageSize({ width: 0, height: 0 });
      setFrameSize({ width: 0, height: 0 });
      setPosition({ x: 0, y: 0 });
      setZoom(MIN_ZOOM);
      setRotation(0);
      setIsApplying(false);
      setIsInteracting(false);
      setGridPinned(false);
    }
  }, [visible]);

  useEffect(
    () => () => {
      if (interactionTimeoutRef.current) {
        clearTimeout(interactionTimeoutRef.current);
      }
    },
    []
  );

  const scheduleInteractionEnd = () => {
    setIsInteracting(true);

    if (interactionTimeoutRef.current) {
      clearTimeout(interactionTimeoutRef.current);
    }

    interactionTimeoutRef.current = setTimeout(
      () => setIsInteracting(false),
      400
    );
  };

  useEffect(() => {
    if (!visible || !imagePath) {
      setPreviewUrl(null);
      return;
    }

    let objectUrl: string | null = null;
    let isMounted = true;

    fetch(`local:${imagePath}`)
      .then((response) => response.blob())
      .then((blob) => {
        if (!isMounted) return;

        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (isMounted) setPreviewUrl(`local:${imagePath}`);
      });

    return () => {
      isMounted = false;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imagePath, visible]);

  useEffect(() => {
    if (!visible || !frameRef.current) return;

    const updateFrameSize = () => {
      if (!frameRef.current) return;

      // Use clientWidth/clientHeight (layout box) instead of
      // getBoundingClientRect: the latter reflects the modal's open
      // scale animation transform, which would size the image to a
      // stale, mid-animation measurement.
      setFrameSize({
        width: frameRef.current.clientWidth,
        height: frameRef.current.clientHeight,
      });
    };

    updateFrameSize();

    const observer = new ResizeObserver(updateFrameSize);
    observer.observe(frameRef.current);

    return () => observer.disconnect();
  }, [visible, variant]);

  // Re-fit and re-center whenever the frame, image, or rotation changes
  // (rotation flows through minScale/effImageSize).
  useEffect(() => {
    if (frameSize.width && effImageSize.width) {
      const nextScale = minScale * MIN_ZOOM;
      const nextPosition = {
        x: (frameSize.width - effImageSize.width * nextScale) / 2,
        y: (frameSize.height - effImageSize.height * nextScale) / 2,
      };

      setZoom(MIN_ZOOM);
      setPosition(clampPosition(nextPosition, nextScale));
    }
  }, [clampPosition, frameSize, effImageSize, minScale]);

  const handleImageLoad = () => {
    if (!imageRef.current) return;

    setImageSize({
      width: imageRef.current.naturalWidth,
      height: imageRef.current.naturalHeight,
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!frameRef.current) return;

    event.preventDefault();
    frameRef.current.setPointerCapture(event.pointerId);
    setIsInteracting(true);

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    setPosition(
      clampPosition(
        {
          x: dragState.originX + event.clientX - dragState.startX,
          y: dragState.originY + event.clientY - dragState.startY,
        },
        scale
      )
    );
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;

    dragStateRef.current = null;
    setIsInteracting(false);

    if (frameRef.current?.hasPointerCapture(event.pointerId)) {
      frameRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLButtonElement>) => {
    if (!frameRef.current) return;

    event.preventDefault();

    const rect = frameRef.current.getBoundingClientRect();
    const nextZoom = zoom - event.deltaY * 0.002;

    updateZoom(nextZoom, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });

    scheduleInteractionEnd();
  };

  const handleFrameKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (isApplying || !imageSize.width) return;

    const panStep = KEYBOARD_PAN_STEP * (event.shiftKey ? 4 : 1);
    const movement = {
      ArrowDown: { x: 0, y: panStep },
      ArrowLeft: { x: -panStep, y: 0 },
      ArrowRight: { x: panStep, y: 0 },
      ArrowUp: { x: 0, y: -panStep },
    }[event.key];

    if (!movement) return;

    event.preventDefault();

    setPosition((currentPosition) =>
      clampPosition(
        {
          x: currentPosition.x + movement.x,
          y: currentPosition.y + movement.y,
        },
        scale
      )
    );
    scheduleInteractionEnd();
  };

  const handleZoomChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    updateZoom(Number(event.target.value));
  };

  // Rotate 90° counter-clockwise; the re-fit effect recenters afterwards.
  const rotateImage = () => setRotation((current) => (current + 270) % 360);

  const handleReset = () => {
    setRotation(0);
    centerImage();
  };

  const handleApply = async () => {
    if (!imageRef.current || !imagePath) return;

    setIsApplying(true);

    try {
      // Crop rectangle in the rotated source space the user is looking at.
      const sourceX = -position.x / scale;
      const sourceY = -position.y / scale;
      const sourceWidth = frameSize.width / scale;
      const sourceHeight = frameSize.height / scale;

      const { imagePath: croppedImagePath } =
        await window.electron.cropProfileImage(imagePath, {
          left: sourceX,
          top: sourceY,
          width: sourceWidth,
          height: sourceHeight,
          outputWidth: outputSize.width,
          outputHeight: outputSize.height,
          rotation,
        });

      onApply(croppedImagePath);
    } catch (error) {
      logger.error("Failed to crop profile image", error);
      showErrorToast(t("image_process_failure"));
    } finally {
      setIsApplying(false);
    }
  };

  // The <img> keeps its natural orientation/size; rotation is applied via
  // transform around the top-left origin, with a translate that lands the
  // rotated bounding box's top-left at `position` (the value clampPosition
  // works in).
  const renderedWidth = Math.ceil(imageSize.width * scale);
  const renderedHeight = Math.ceil(imageSize.height * scale);
  let translateX = position.x;
  let translateY = position.y;
  if (rotation === 90) {
    translateX += renderedHeight;
  } else if (rotation === 180) {
    translateX += renderedWidth;
    translateY += renderedHeight;
  } else if (rotation === 270) {
    translateY += renderedWidth;
  }
  const imageTransform = `translate(${translateX}px, ${translateY}px) rotate(${rotation}deg)`;

  return (
    <Modal
      visible={visible}
      title={
        variant === "avatar"
          ? t("crop_profile_picture")
          : t("crop_profile_banner")
      }
      description={t("crop_profile_image_description")}
      onClose={onClose}
      clickOutsideToClose={false}
      large
    >
      <div className="profile-image-crop-modal">
        <div className="profile-image-crop-modal__stage">
          <button
            type="button"
            ref={frameRef}
            className={`profile-image-crop-modal__frame profile-image-crop-modal__frame--${variant}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            onKeyDown={handleFrameKeyDown}
            aria-label={t("crop_profile_image_stage")}
          >
            {previewUrl && (
              <img
                ref={imageRef}
                src={previewUrl}
                alt=""
                className="profile-image-crop-modal__image"
                style={{
                  width: renderedWidth,
                  height: renderedHeight,
                  transform: imageTransform,
                }}
                draggable={false}
                onLoad={handleImageLoad}
              />
            )}

            <div
              className={`profile-image-crop-modal__grid${
                showGrid ? " profile-image-crop-modal__grid--visible" : ""
              }`}
              aria-hidden="true"
            >
              <span className="profile-image-crop-modal__grid-line profile-image-crop-modal__grid-line--v1" />
              <span className="profile-image-crop-modal__grid-line profile-image-crop-modal__grid-line--v2" />
              <span className="profile-image-crop-modal__grid-line profile-image-crop-modal__grid-line--h1" />
              <span className="profile-image-crop-modal__grid-line profile-image-crop-modal__grid-line--h2" />
            </div>
          </button>

          <div
            className="profile-image-crop-modal__toolbar"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={`profile-image-crop-modal__icon-button${
                gridPinned
                  ? " profile-image-crop-modal__icon-button--active"
                  : ""
              }`}
              onClick={() => setGridPinned((value) => !value)}
              disabled={isApplying}
              title={t("toggle_grid")}
              aria-label={t("toggle_grid")}
              aria-pressed={gridPinned}
            >
              <Grid2x2Icon size={16} />
            </button>

            <span className="profile-image-crop-modal__toolbar-divider" />

            <button
              type="button"
              className="profile-image-crop-modal__icon-button"
              onClick={() => updateZoom(zoom - ZOOM_STEP)}
              disabled={isApplying || zoom <= MIN_ZOOM}
              title={t("zoom_out")}
              aria-label={t("zoom_out")}
            >
              <MinusIcon size={16} />
            </button>

            <input
              type="range"
              className="profile-image-crop-modal__slider"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={handleZoomChange}
              disabled={isApplying}
              aria-label={t("zoom")}
              style={
                {
                  "--fill": `${
                    ((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100
                  }%`,
                } as React.CSSProperties
              }
            />

            <button
              type="button"
              className="profile-image-crop-modal__icon-button"
              onClick={() => updateZoom(zoom + ZOOM_STEP)}
              disabled={isApplying || zoom >= MAX_ZOOM}
              title={t("zoom_in")}
              aria-label={t("zoom_in")}
            >
              <PlusIcon size={16} />
            </button>

            <span className="profile-image-crop-modal__zoom-percent">
              {Math.round(zoom * 100)}%
            </span>

            <span className="profile-image-crop-modal__toolbar-divider" />

            <button
              type="button"
              className="profile-image-crop-modal__icon-button"
              onClick={rotateImage}
              disabled={isApplying}
              title={t("rotate")}
              aria-label={t("rotate")}
            >
              <RotateCcwSquareIcon size={16} />
            </button>

            <button
              type="button"
              className="profile-image-crop-modal__icon-button"
              onClick={handleReset}
              disabled={isApplying}
              title={t("reset")}
              aria-label={t("reset")}
            >
              <RotateCcwIcon size={16} />
            </button>
          </div>
        </div>

        <div className="profile-image-crop-modal__actions">
          <Button
            type="button"
            theme="outline"
            onClick={onClose}
            disabled={isApplying}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={isApplying || !imageSize.width}
          >
            {isApplying ? t("applying_crop") : t("apply_crop")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
