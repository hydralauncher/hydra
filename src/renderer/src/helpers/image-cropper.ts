import type { CropArea } from "@renderer/components";

type DrawImageCallback = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cropArea: CropArea
) => void;

const loadImageAndProcess = async (
  imagePath: string,
  cropArea: CropArea,
  outputFormat: string,
  drawCallback: DrawImageCallback
): Promise<Uint8Array> => {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      drawCallback(ctx, img, cropArea);

      const convertBlobToUint8Array = async (
        blob: Blob
      ): Promise<Uint8Array> => {
        const buffer = await blob.arrayBuffer();
        return new Uint8Array(buffer);
      };

      const handleBlob = (blob: Blob | null) => {
        if (!blob) {
          reject(new Error("Failed to create blob from canvas"));
          return;
        }

        convertBlobToUint8Array(blob).then(resolve).catch(reject);
      };

      canvas.toBlob(handleBlob, outputFormat, 0.95);
    };

    img.onerror = () => {
      reject(new Error("Failed to load image"));
    };

    img.src = imagePath.startsWith("local:") ? imagePath : `local:${imagePath}`;
  });
};

const setCanvasDimensions = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): void => {
  canvas.width = width;
  canvas.height = height;
};

type DrawImageParams = {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  destWidth: number;
  destHeight: number;
};

const drawCroppedImage = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  params: DrawImageParams
): void => {
  ctx.drawImage(
    img,
    params.sourceX,
    params.sourceY,
    params.sourceWidth,
    params.sourceHeight,
    0,
    0,
    params.destWidth,
    params.destHeight
  );
};

/**
 * Crops an image using HTML5 Canvas API
 * @param imagePath - Path to the image file
 * @param cropArea - Crop area coordinates and dimensions
 * @param outputFormat - Output image format (default: 'image/png')
 * @returns Promise resolving to cropped image as Uint8Array
 */
export async function cropImage(
  imagePath: string,
  cropArea: CropArea,
  outputFormat: string = "image/png"
): Promise<Uint8Array> {
  return loadImageAndProcess(
    imagePath,
    cropArea,
    outputFormat,
    (ctx, img, area) => {
      const canvas = ctx.canvas;
      setCanvasDimensions(canvas, area.width, area.height);
      drawCroppedImage(ctx, img, {
        sourceX: area.x,
        sourceY: area.y,
        sourceWidth: area.width,
        sourceHeight: area.height,
        destWidth: area.width,
        destHeight: area.height,
      });
    }
  );
}

/**
 * Crops an image to a circular shape
 * @param imagePath - Path to the image file
 * @param cropArea - Crop area coordinates and dimensions (should be square for circle)
 * @param outputFormat - Output image format (default: 'image/png')
 * @returns Promise resolving to cropped circular image as Uint8Array
 */
export async function cropImageToCircle(
  imagePath: string,
  cropArea: CropArea,
  outputFormat: string = "image/png"
): Promise<Uint8Array> {
  return loadImageAndProcess(
    imagePath,
    cropArea,
    outputFormat,
    (ctx, img, area) => {
      const size = Math.min(area.width, area.height);
      const canvas = ctx.canvas;
      setCanvasDimensions(canvas, size, size);

      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();

      drawCroppedImage(ctx, img, {
        sourceX: area.x,
        sourceY: area.y,
        sourceWidth: size,
        sourceHeight: size,
        destWidth: size,
        destHeight: size,
      });
    }
  );
}
