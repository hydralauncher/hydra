import { useRef } from "react";
import { useHlsVideo } from "@renderer/hooks";

interface VideoPlayerProps {
  videoSrc?: string;
  videoType?: string;
  poster?: string;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  tabIndex?: number;
  className?: string;
}

export function VideoPlayer({
  videoSrc,
  videoType,
  poster,
  autoplay = false,
  muted = true,
  loop = false,
  controls = true,
  tabIndex = -1,
  className,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isHls = videoType === "application/x-mpegURL";

  useHlsVideo(videoRef, {
    videoSrc,
    videoType,
    autoplay,
    muted,
    loop,
  });

  if (isHls) {
    return (
      <video
        ref={videoRef}
        controls={controls}
        className={className}
        poster={poster}
        loop={loop}
        muted={muted}
        autoPlay={autoplay}
        tabIndex={tabIndex}
      >
        <track kind="captions" />
      </video>
    );
  }

  return (
    <video
      ref={videoRef}
      controls={controls}
      className={className}
      poster={poster}
      loop={loop}
      muted={muted}
      autoPlay={autoplay}
      tabIndex={tabIndex}
    >
      {videoSrc && <source src={videoSrc} type={videoType} />}
      <track kind="captions" />
    </video>
  );
}
