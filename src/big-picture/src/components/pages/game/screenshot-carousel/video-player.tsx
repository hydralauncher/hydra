import { useHlsVideo } from "@shared";
import { useRef } from "react";

interface VideoPlayerProps {
  videoSrc?: string;
  videoType?: string;
  poster?: string;
  autoplay?: boolean;
  load?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  style?: React.CSSProperties;
  videoRef?: (el: HTMLVideoElement | null) => void;
  onPlay?: () => void;
  onPause?: () => void;
}

export function VideoPlayer({
  videoSrc,
  videoType,
  poster,
  autoplay = false,
  load = true,
  muted = true,
  loop = false,
  controls = true,
  style,
  videoRef,
  onPlay,
  onPause,
}: Readonly<VideoPlayerProps>) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const isHls = videoType === "application/x-mpegURL";

  useHlsVideo(internalRef, {
    videoSrc,
    videoType,
    load,
    autoplay,
    muted,
    loop,
  });

  const setRef = (el: HTMLVideoElement | null) => {
    (internalRef as React.MutableRefObject<HTMLVideoElement | null>).current =
      el;
    videoRef?.(el);
  };

  if (isHls) {
    return (
      <video
        ref={setRef}
        controls={controls}
        poster={poster}
        loop={loop}
        muted={muted}
        autoPlay={autoplay}
        preload={load ? "auto" : "none"}
        playsInline
        style={style}
        onPlay={onPlay}
        onPause={onPause}
      >
        <track kind="captions" />
      </video>
    );
  }

  return (
    <video
      ref={setRef}
      controls={controls}
      poster={poster}
      loop={loop}
      muted={muted}
      autoPlay={autoplay}
      preload={load ? "auto" : "none"}
      playsInline
      style={style}
      onPlay={onPlay}
      onPause={onPause}
    >
      {videoSrc && <source src={videoSrc} type={videoType} />}
      <track kind="captions" />
    </video>
  );
}
