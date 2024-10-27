import Lottie from "lottie-react";

import downloadingAnimation from "@renderer/assets/lottie/downloading.json";

export interface DownloadIconProps {
  isDownloading: boolean;
}

export function DownloadIcon({ isDownloading }: DownloadIconProps) {
  return (
    <Lottie
      animationData={downloadingAnimation}
      loop={isDownloading}
      autoplay={isDownloading}
      style={{ width: 16 }}
    />
  );
}
