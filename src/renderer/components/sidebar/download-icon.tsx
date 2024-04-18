import { useRef } from "react";
import Lottie from "lottie-react";

import downloadingAnimation from "@renderer/assets/lottie/downloading.json";
import * as styles from "./download-icon.css";

export interface DownloadIconProps {
  isDownloading: boolean;
}

export function DownloadIcon({ isDownloading }: DownloadIconProps) {
  const lottieRef = useRef(null);

  return (
    <div className={styles.downloadIconWrapper}>
      <Lottie
        lottieRef={lottieRef}
        animationData={downloadingAnimation}
        loop={isDownloading}
        autoplay={isDownloading}
        className={styles.downloadIcon}
        onDOMLoaded={() => lottieRef.current?.setSpeed(1.7)}
      />
    </div>
  );
}
