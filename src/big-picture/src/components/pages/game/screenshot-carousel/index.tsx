import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { SteamMovie, SteamScreenshot } from "@types";
import { FocusItem, HorizontalFocusGroup } from "../../../common";
import { VideoPlayer } from "./video-player";

interface ScreenshotCarouselProps {
  screenshots: SteamScreenshot[];
  videos: SteamMovie[];
}

type MediaItem = {
  id: string;
  type: "video" | "image";
  src?: string;
  poster?: string;
  videoSrc?: string;
  videoType?: string;
};

export function ScreenshotCarousel({
  screenshots,
  videos,
}: Readonly<ScreenshotCarouselProps>) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);

  const scrollPrev = () => emblaApi?.scrollPrev();
  const scrollNext = () => emblaApi?.scrollNext();

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    const index = emblaApi.selectedScrollSnap();
    setSelectedIndex(index);

    videoRefs.current.forEach((video, idx) => {
      if (!video) return;
      if (idx === index) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    onSelect();
  }, [emblaApi, onSelect]);

  const mediaItems: MediaItem[] = useMemo(() => {
    const items: MediaItem[] = [];

    videos.forEach((video) => {
      let videoSrc: string | undefined;
      let videoType: string | undefined;

      if (video.hls_h264) {
        videoSrc = video.hls_h264;
        videoType = "application/x-mpegURL";
      } else if (video.dash_h264) {
        videoSrc = video.dash_h264;
        videoType = "application/dash+xml";
      } else if (video.dash_av1) {
        videoSrc = video.dash_av1;
        videoType = "application/dash+xml";
      } else if (video.mp4?.max) {
        videoSrc = video.mp4.max;
        videoType = "video/mp4";
      } else if (video.webm?.max) {
        videoSrc = video.webm.max;
        videoType = "video/webm";
      }

      if (videoSrc) {
        items.push({
          id: `video-${video.id}`,
          type: "video",
          poster: video.thumbnail,
          videoSrc: videoSrc.startsWith("http://")
            ? videoSrc.replace("http://", "https://")
            : videoSrc,
          videoType,
        });
      }
    });

    screenshots.forEach((image) => {
      items.push({
        id: `screenshot-${image.id}`,
        type: "image",
        src: image.path_full,
      });
    });

    return items;
  }, [videos, screenshots]);

  const isVisible = (index: number) => Math.abs(index - selectedIndex) <= 1;

  const renderSlideContent = (item: MediaItem, idx: number) => {
    if (!isVisible(idx)) {
      return (
        <div
          style={{
            width: "100%",
            aspectRatio: "16 / 9",
            backgroundColor: "#111",
            borderRadius: 8,
          }}
        />
      );
    }

    if (item.type === "video") {
      return (
        <VideoPlayer
          videoSrc={item.videoSrc}
          videoType={item.videoType}
          poster={item.poster}
          muted
          loop
          controls
          style={{
            width: "100%",
            borderRadius: 8,
            objectFit: "cover",
            aspectRatio: "16 / 9",
          }}
          videoRef={(el) => {
            videoRefs.current[idx] = el;
          }}
        />
      );
    }

    return (
      <img
        src={item.src}
        alt={`Screenshot ${idx + 1}`}
        loading="lazy"
        style={{
          width: "100%",
          borderRadius: 8,
          objectFit: "cover",
          aspectRatio: "16 / 9",
        }}
      />
    );
  };

  return (
    <div style={{ overflow: "hidden", width: "100%", marginBottom: 32 }}>
      <div className="embla" ref={emblaRef} style={{ overflow: "hidden" }}>
        <div
          className="embla__container"
          style={{
            display: "flex",
            gap: 16,
          }}
        >
          {mediaItems.map((item, idx) => (
            <div
              key={item.id}
              className="embla__slide"
              style={{ flex: "0 0 80%", maxWidth: "80%" }}
            >
              {renderSlideContent(item, idx)}
            </div>
          ))}
        </div>
      </div>

      <HorizontalFocusGroup regionId="screenshot-carousel-dots" asChild>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 16,
            marginTop: 8,
          }}
        >
          <FocusItem asChild>
            <button
              onClick={scrollPrev}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
              }}
              aria-label="Previous slide"
            >
              <CaretLeftIcon size={24} color="#fff" />
            </button>
          </FocusItem>

          <div style={{ display: "flex", gap: 8 }}>
            {mediaItems.map((item, i) => (
              <button
                key={`dot-${item.id}`}
                onClick={() => emblaApi?.scrollTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                style={{
                  display: "inline-block",
                  width: i === selectedIndex ? 24 : 10,
                  height: 10,
                  borderRadius: 9999,
                  backgroundColor: i === selectedIndex ? "#fff" : "#555",
                  transition: "all 0.3s ease",
                  cursor: "pointer",
                  border: "none",
                  padding: 0,
                }}
              />
            ))}
          </div>

          <FocusItem asChild>
            <button
              onClick={scrollNext}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
              }}
              aria-label="Next slide"
            >
              <CaretRightIcon size={24} color="#fff" />
            </button>
          </FocusItem>
        </div>
      </HorizontalFocusGroup>
    </div>
  );
}
