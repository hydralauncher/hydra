import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlayIcon } from "@primer/octicons-react";
import { useHlsVideo } from "@shared";

const PLAY_ICON_SIZE = 24;

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
  loadOnDemand?: boolean;
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
  loadOnDemand = false,
}: Readonly<VideoPlayerProps>) {
  const { t } = useTranslation("game_details");
  const videoRef = useRef<HTMLVideoElement>(null);
  const isHls = videoType === "application/x-mpegURL";

  const [started, setStarted] = useState(!loadOnDemand);

  useEffect(() => {
    setStarted(!loadOnDemand);
  }, [loadOnDemand]);

  useHlsVideo(videoRef, {
    videoSrc,
    videoType,
    load: started,
    autoplay: autoplay || (loadOnDemand && started),
    muted,
    loop,
  });

  const handleManualStart = () => {
    setStarted(true);

    if (!isHls) {
      videoRef.current?.play().catch(() => {});
    }
  };

  const showOverlay = loadOnDemand && !started;

  const video = isHls ? (
    <video
      ref={videoRef}
      controls={controls}
      className={className}
      poster={poster}
      loop={loop}
      muted={muted}
      autoPlay={autoplay}
      preload={started ? "auto" : "none"}
      tabIndex={tabIndex}
    >
      <track kind="captions" />
    </video>
  ) : (
    <video
      ref={videoRef}
      controls={controls}
      className={className}
      poster={poster}
      loop={loop}
      muted={muted}
      autoPlay={autoplay}
      preload={started ? "auto" : "none"}
      tabIndex={tabIndex}
    >
      {videoSrc && <source src={videoSrc} type={videoType} />}
      <track kind="captions" />
    </video>
  );

  return (
    <div className="gallery-slider__video-wrapper">
      {video}

      {showOverlay && (
        <button
          type="button"
          className="gallery-slider__video-play-button"
          onClick={handleManualStart}
          aria-label={t("play")}
        >
          <div className="gallery-slider__video-play-icon">
            <PlayIcon size={PLAY_ICON_SIZE} />
          </div>
        </button>
      )}
    </div>
  );
}
