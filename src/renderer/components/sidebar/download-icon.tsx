import { useRef } from "react";
import Lottie from "lottie-react";

import downloadingAnimation from "@renderer/assets/lottie/downloading.json";

export interface DownloadIconProps {
  isDownloading: boolean;
}

export function DownloadIcon({ isDownloading }: DownloadIconProps) {
  const lottieRef = useRef(null);

  return (
    <Lottie
      lottieRef={lottieRef}
      animationData={downloadingAnimation}
      loop={isDownloading}
      autoplay={isDownloading}
      style={{ width: 16 }}
    />
  );
}
