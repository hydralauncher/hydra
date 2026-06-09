import { useEffect, useRef } from "react";
import Hls from "hls.js";

interface UseHlsVideoOptions {
  videoSrc: string | undefined;
  videoType: string | undefined;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
}

interface HlsVideoLogger {
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const defaultLogger: HlsVideoLogger = {
  warn: console.warn,
  error: console.error,
};

export function useHlsVideo(
  videoRef: React.RefObject<HTMLVideoElement>,
  { videoSrc, videoType, autoplay, muted, loop }: UseHlsVideoOptions,
  log: HlsVideoLogger = defaultLogger
) {
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

    const isHls = videoType === "application/x-mpegURL";

    if (!isHls) {
      return undefined;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });

      hlsRef.current = hls;

      hls.loadSource(videoSrc);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoplay) {
          video.play().catch((err) => {
            log.warn("Failed to autoplay HLS video:", err);
          });
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              log.error("HLS network error, trying to recover");
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              log.error("HLS media error, trying to recover");
              hls.recoverMediaError();
              break;
            default:
              log.error("HLS fatal error, destroying instance");
              hls.destroy();
              break;
          }
        }
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = videoSrc;
      video.load();
      if (autoplay) {
        video.play().catch((err) => {
          log.warn("Failed to autoplay HLS video:", err);
        });
      }

      return () => {
        video.src = "";
      };
    }

    log.warn("HLS playback is not supported in this browser");
    return undefined;
  }, [videoRef, videoSrc, videoType, autoplay, muted, loop, log]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (muted !== undefined) {
      video.muted = muted;
    }
    if (loop !== undefined) {
      video.loop = loop;
    }
  }, [videoRef, muted, loop]);

  return hlsRef.current;
}
