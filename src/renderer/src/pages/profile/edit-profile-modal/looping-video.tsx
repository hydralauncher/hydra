import { useEffect, useRef } from "react";

/**
 * A muted, looping video. Chromium pauses autoplay while the window is
 * hidden (also when it is covered on Windows) and may not resume it, so it
 * plays again whenever the page becomes visible.
 */
export function LoopingVideo({ src }: Readonly<{ src: string }>) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const play = () => {
      if (document.visibilityState === "visible" && video.paused) {
        video.play().catch(() => {});
      }
    };

    play();
    document.addEventListener("visibilitychange", play);
    return () => document.removeEventListener("visibilitychange", play);
  }, [src]);

  return <video ref={videoRef} src={src} autoPlay loop muted playsInline />;
}
