import "./styles.scss";

import { motion, type HTMLMotionProps } from "framer-motion";
import { useCallback, useEffect, useRef } from "react";

export interface AnimatedHeroImageProps
  extends Omit<HTMLMotionProps<"img">, "src"> {
  imageUrl: string;
}

const FALLBACK_BACKGROUND_COLOR = "rgba(8, 8, 8, 1)";

const RGBA_WITH_ALPHA =
  /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+\s*\)$/;

function getBackgroundColor(element: HTMLElement) {
  const elementStyles = globalThis.getComputedStyle(element);
  const rootStyles = globalThis.getComputedStyle(
    globalThis.document.documentElement
  );

  return (
    elementStyles.getPropertyValue("--background").trim() ||
    rootStyles.getPropertyValue("--background").trim() ||
    elementStyles.backgroundColor ||
    FALLBACK_BACKGROUND_COLOR
  );
}

function withAlpha(color: string, alpha: number) {
  const normalizedAlpha = Math.max(0, Math.min(1, alpha));

  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${normalizedAlpha})`);
  }

  const rgbaMatch = RGBA_WITH_ALPHA.exec(color);

  if (rgbaMatch) {
    return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${normalizedAlpha})`;
  }

  return FALLBACK_BACKGROUND_COLOR;
}

function getCoverCrop(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number
) {
  const imageAspectRatio = imageWidth / imageHeight;
  const containerAspectRatio = containerWidth / containerHeight;

  if (imageAspectRatio > containerAspectRatio) {
    const cropWidth = imageHeight * containerAspectRatio;

    return {
      sourceX: (imageWidth - cropWidth) / 2,
      sourceY: 0,
      sourceWidth: cropWidth,
      sourceHeight: imageHeight,
    };
  }

  const cropHeight = imageWidth / containerAspectRatio;

  return {
    sourceX: 0,
    sourceY: (imageHeight - cropHeight) / 2,
    sourceWidth: imageWidth,
    sourceHeight: cropHeight,
  };
}

function createLayer(width: number, height: number, devicePixelRatio: number) {
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);

  const context = canvas.getContext("2d");

  if (!context) return null;

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

  return { canvas, context };
}

export function AnimatedHeroImage({
  imageUrl,
  alt = "",
  className = "",
  onLoad,
  onError,
  ...props
}: Readonly<AnimatedHeroImageProps>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const blendCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const clearBlendCanvas = useCallback(() => {
    const canvas = blendCanvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const renderBlend = useCallback(() => {
    const container = containerRef.current;
    const image = imageRef.current;
    const canvas = blendCanvasRef.current;

    if (
      !container ||
      !image ||
      !canvas ||
      !image.complete ||
      !image.naturalWidth
    ) {
      clearBlendCanvas();
      return;
    }

    const bounds = container.getBoundingClientRect();
    const width = bounds.width;
    const height = bounds.height;

    if (width <= 0 || height <= 0) {
      clearBlendCanvas();
      return;
    }

    const devicePixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const expectedWidth = Math.round(width * devicePixelRatio);
    const expectedHeight = Math.round(height * devicePixelRatio);

    if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
      canvas.width = expectedWidth;
      canvas.height = expectedHeight;
    }

    const context = canvas.getContext("2d");

    if (!context) return;

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const backgroundColor = getBackgroundColor(container);
    const { sourceX, sourceY, sourceWidth, sourceHeight } = getCoverCrop(
      image.naturalWidth,
      image.naturalHeight,
      width,
      height
    );

    const bottomLayer = createLayer(width, height, devicePixelRatio);
    const leftLayer = createLayer(width, height, devicePixelRatio);
    const rightLayer = createLayer(width, height, devicePixelRatio);
    if (!bottomLayer || !leftLayer || !rightLayer) return;

    const bottomSourceHeight = sourceHeight * 0.34;
    const sideSourceWidth = sourceWidth * 0.075;

    bottomLayer.context.save();
    bottomLayer.context.filter = `blur(${Math.max(32, height * 0.08)}px) saturate(1.08)`;
    bottomLayer.context.globalAlpha = 0.56;
    bottomLayer.context.drawImage(
      image,
      sourceX,
      sourceY + sourceHeight - bottomSourceHeight,
      sourceWidth,
      bottomSourceHeight,
      -width * 0.03,
      height * 0.28,
      width * 1.06,
      height * 0.9
    );
    bottomLayer.context.filter = `blur(${Math.max(64, height * 0.13)}px)`;
    bottomLayer.context.globalAlpha = 0.28;
    bottomLayer.context.drawImage(
      image,
      sourceX,
      sourceY + sourceHeight - bottomSourceHeight * 0.8,
      sourceWidth,
      bottomSourceHeight * 0.8,
      -width * 0.06,
      height * 0.36,
      width * 1.12,
      height * 0.84
    );
    bottomLayer.context.restore();

    bottomLayer.context.globalCompositeOperation = "destination-in";
    const bottomMask = bottomLayer.context.createLinearGradient(
      0,
      0,
      0,
      height
    );
    bottomMask.addColorStop(0, "rgba(0, 0, 0, 0)");
    bottomMask.addColorStop(0.22, "rgba(0, 0, 0, 0)");
    bottomMask.addColorStop(0.42, "rgba(0, 0, 0, 0.03)");
    bottomMask.addColorStop(0.62, "rgba(0, 0, 0, 0.16)");
    bottomMask.addColorStop(0.78, "rgba(0, 0, 0, 0.42)");
    bottomMask.addColorStop(0.92, "rgba(0, 0, 0, 0.72)");
    bottomMask.addColorStop(1, "rgba(0, 0, 0, 1)");
    bottomLayer.context.fillStyle = bottomMask;
    bottomLayer.context.fillRect(0, 0, width, height);
    bottomLayer.context.globalCompositeOperation = "destination-out";

    const seamSoftener = bottomLayer.context.createLinearGradient(
      0,
      height * 0.2,
      0,
      height * 0.58
    );
    seamSoftener.addColorStop(0, "rgba(0, 0, 0, 1)");
    seamSoftener.addColorStop(0.38, "rgba(0, 0, 0, 0.4)");
    seamSoftener.addColorStop(1, "rgba(0, 0, 0, 0)");
    bottomLayer.context.fillStyle = seamSoftener;
    bottomLayer.context.fillRect(0, height * 0.2, width, height * 0.38);
    bottomLayer.context.globalCompositeOperation = "source-over";

    leftLayer.context.save();
    leftLayer.context.filter = `blur(${Math.max(28, width * 0.035)}px) saturate(1.02)`;
    leftLayer.context.globalAlpha = 0.78;
    leftLayer.context.drawImage(
      image,
      sourceX,
      sourceY,
      sideSourceWidth,
      sourceHeight,
      0,
      -height * 0.02,
      width * 0.16,
      height * 1.04
    );
    leftLayer.context.restore();

    leftLayer.context.globalCompositeOperation = "destination-in";
    const leftMask = leftLayer.context.createLinearGradient(
      0,
      0,
      width * 0.2,
      0
    );
    leftMask.addColorStop(0, "rgba(0, 0, 0, 1)");
    leftMask.addColorStop(0.52, "rgba(0, 0, 0, 0.9)");
    leftMask.addColorStop(1, "rgba(0, 0, 0, 0)");
    leftLayer.context.fillStyle = leftMask;
    leftLayer.context.fillRect(0, 0, width * 0.2, height);
    leftLayer.context.globalCompositeOperation = "source-over";

    rightLayer.context.save();
    rightLayer.context.filter = `blur(${Math.max(28, width * 0.035)}px) saturate(1.02)`;
    rightLayer.context.globalAlpha = 0.78;
    rightLayer.context.drawImage(
      image,
      sourceX + sourceWidth - sideSourceWidth,
      sourceY,
      sideSourceWidth,
      sourceHeight,
      width * 0.84,
      -height * 0.02,
      width * 0.16,
      height * 1.04
    );
    rightLayer.context.restore();

    rightLayer.context.globalCompositeOperation = "destination-in";
    const rightMask = rightLayer.context.createLinearGradient(
      width,
      0,
      width * 0.8,
      0
    );
    rightMask.addColorStop(0, "rgba(0, 0, 0, 1)");
    rightMask.addColorStop(0.52, "rgba(0, 0, 0, 0.9)");
    rightMask.addColorStop(1, "rgba(0, 0, 0, 0)");
    rightLayer.context.fillStyle = rightMask;
    rightLayer.context.fillRect(width * 0.8, 0, width * 0.2, height);
    rightLayer.context.globalCompositeOperation = "source-over";

    context.drawImage(bottomLayer.canvas, 0, 0, width, height);
    context.drawImage(leftLayer.canvas, 0, 0, width, height);
    context.drawImage(rightLayer.canvas, 0, 0, width, height);

    const verticalFade = context.createLinearGradient(
      0,
      height * 0.32,
      0,
      height
    );
    verticalFade.addColorStop(0, withAlpha(backgroundColor, 0));
    verticalFade.addColorStop(0.14, withAlpha(backgroundColor, 0.02));
    verticalFade.addColorStop(0.32, withAlpha(backgroundColor, 0.08));
    verticalFade.addColorStop(0.54, withAlpha(backgroundColor, 0.18));
    verticalFade.addColorStop(0.72, withAlpha(backgroundColor, 0.38));
    verticalFade.addColorStop(0.86, withAlpha(backgroundColor, 0.68));
    verticalFade.addColorStop(0.94, withAlpha(backgroundColor, 0.9));
    verticalFade.addColorStop(1, backgroundColor);
    context.fillStyle = verticalFade;
    context.fillRect(0, height * 0.32, width, height * 0.68);

    const leftFade = context.createLinearGradient(0, 0, width * 0.12, 0);
    leftFade.addColorStop(0, backgroundColor);
    leftFade.addColorStop(0.26, withAlpha(backgroundColor, 0.58));
    leftFade.addColorStop(1, withAlpha(backgroundColor, 0));
    context.fillStyle = leftFade;
    context.fillRect(0, 0, width * 0.12, height);

    const rightFade = context.createLinearGradient(width, 0, width * 0.88, 0);
    rightFade.addColorStop(0, backgroundColor);
    rightFade.addColorStop(0.26, withAlpha(backgroundColor, 0.58));
    rightFade.addColorStop(1, withAlpha(backgroundColor, 0));
    context.fillStyle = rightFade;
    context.fillRect(width * 0.88, 0, width * 0.12, height);
  }, [clearBlendCanvas]);

  const scheduleRender = useCallback(() => {
    if (frameRef.current != null) {
      globalThis.cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = globalThis.requestAnimationFrame(() => {
      renderBlend();
      frameRef.current = null;
    });
  }, [renderBlend]);

  useEffect(() => {
    if (!imageUrl) {
      clearBlendCanvas();
      return;
    }

    const container = containerRef.current;

    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      scheduleRender();
    });

    resizeObserver.observe(container);
    scheduleRender();

    return () => {
      resizeObserver.disconnect();

      if (frameRef.current != null) {
        globalThis.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [clearBlendCanvas, imageUrl, scheduleRender]);

  return (
    <div
      ref={containerRef}
      className={`animated-hero-image ${className}`.trim()}
    >
      {imageUrl ? (
        <motion.img
          ref={imageRef}
          src={imageUrl}
          alt={alt}
          className="animated-hero-image__main"
          initial={{ scale: 1, x: 0, y: 0 }}
          animate={{
            scale: 1.1,
            x: -10,
            y: -10,
          }}
          transition={{
            duration: 20,
            ease: "easeInOut",
            repeat: Infinity,
            repeatType: "mirror",
          }}
          onLoad={(event) => {
            scheduleRender();
            onLoad?.(event);
          }}
          onError={(event) => {
            clearBlendCanvas();
            onError?.(event);
          }}
          {...props}
        />
      ) : null}

      <div className="animated-hero-image__blend-wrap" aria-hidden="true">
        <canvas ref={blendCanvasRef} className="animated-hero-image__blend" />
      </div>
    </div>
  );
}
