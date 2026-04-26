import { useHlsVideo } from "@shared";
import { useRef } from "react";

interface VideoPlayerProps {
  videoSrc?: string;
  videoType?: string;
  poster?: string;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  style?: React.CSSProperties;
  videoRef?: (el: HTMLVideoElement | null) => void;
}

export function VideoPlayer({
  videoSrc,
  videoType,
  poster,
  autoplay = false,
  muted = true,
  loop = false,
  controls = true,
  style,
  videoRef,
}: Readonly<VideoPlayerProps>) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const isHls = videoType === "application/x-mpegURL";

  useHlsVideo(internalRef, {
    videoSrc,
    videoType,
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
        playsInline
        style={style}
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
      playsInline
      style={style}
    >
      {videoSrc && <source src={videoSrc} type={videoType} />}
      <track kind="captions" />
    </video>
  );
}
