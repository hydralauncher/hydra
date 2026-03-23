import { useEffect, useState } from "react";

export function useDominantColor(imageUrl: string | undefined): string {
  const [color, setColor] = useState("rgba(255, 255, 255, 0.3)");

  useEffect(() => {
    if (!imageUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = 16;
      canvas.height = 16;
      ctx.drawImage(img, 0, 0, 16, 16);

      const data = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0,
        g = 0,
        b = 0,
        count = 0;

      for (let i = 0; i < data.length; i += 4) {
        const brightness = data[i] + data[i + 1] + data[i + 2];
        if (brightness > 80 && brightness < 700) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
      }

      if (count > 0) {
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        setColor(`rgba(${r}, ${g}, ${b}, 0.9)`);
      }
    };
  }, [imageUrl]);

  return color;
}
