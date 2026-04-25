import { useEffect, useRef } from "react";
import Hls from "hls.js";

interface UseHlsVideoOptions {
  videoSrc: string | undefined;
  videoType: string | undefined;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
}

export function useHlsVideo(
  videoRef: React.RefObject<HTMLVideoElement>,
  { videoSrc, videoType, autoplay, muted, loop }: UseHlsVideoOptions
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
          video.play().catch(() => {});
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
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
        video.play().catch(() => {});
      }

      return () => {
        video.src = "";
      };
    }

    return undefined;
  }, [videoRef, videoSrc, videoType, autoplay, muted, loop]);

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
