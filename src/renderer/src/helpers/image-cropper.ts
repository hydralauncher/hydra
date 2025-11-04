/**
 * Crops an image using HTML5 Canvas API
 * @param imagePath - Path to the image file
 * @param cropArea - Crop area coordinates and dimensions
 * @param outputFormat - Output image format (default: 'image/png')
 * @returns Promise resolving to cropped image as Uint8Array
 */
export async function cropImage(
  imagePath: string,
  cropArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  outputFormat: string = "image/png"
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      canvas.width = cropArea.width;
      canvas.height = cropArea.height;

      ctx.drawImage(
        img,
        cropArea.x,
        cropArea.y,
        cropArea.width,
        cropArea.height,
        0,
        0,
        cropArea.width,
        cropArea.height
      );

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to create blob from canvas"));
            return;
          }

          blob.arrayBuffer().then((buffer) => {
            resolve(new Uint8Array(buffer));
          });
        },
        outputFormat,
        0.95
      );
    };

    img.onerror = () => {
      reject(new Error("Failed to load image"));
    };

    img.src = imagePath.startsWith("local:") ? imagePath : `local:${imagePath}`;
  });
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
  cropArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  outputFormat: string = "image/png"
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      const size = Math.min(cropArea.width, cropArea.height);
      canvas.width = size;
      canvas.height = size;

      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();

      ctx.drawImage(
        img,
        cropArea.x,
        cropArea.y,
        size,
        size,
        0,
        0,
        size,
        size
      );

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to create blob from canvas"));
            return;
          }

          blob.arrayBuffer().then((buffer) => {
            resolve(new Uint8Array(buffer));
          });
        },
        outputFormat,
        0.95
      );
    };

    img.onerror = () => {
      reject(new Error("Failed to load image"));
    };

    img.src = imagePath.startsWith("local:") ? imagePath : `local:${imagePath}`;
  });
}

