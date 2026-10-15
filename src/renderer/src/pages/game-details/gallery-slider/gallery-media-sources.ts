import type { SteamMovie, SteamVideoSource } from "@types";
import type { GalleryVideoSource } from "./gallery-slider";

export const HLS_VIDEO_TYPE = "application/x-mpegURL";
const DASH_VIDEO_TYPE = "application/dash+xml";
const MP4_VIDEO_TYPE = "video/mp4";
const WEBM_VIDEO_TYPE = "video/webm";

export interface SteamMovieSource {
  videoSrc: string;
  videoType: string;
  sources?: GalleryVideoSource[];
}

const toHttps = (url: string) =>
  url.startsWith("http://") ? url.replace("http://", "https://") : url;

const buildProgressiveSources = (
  source: SteamVideoSource,
  type: string
): GalleryVideoSource[] => {
  const sources: GalleryVideoSource[] = [];
  if (source.max) sources.push({ label: "HD", src: toHttps(source.max), type });
  if (source["480"] && source["480"] !== source.max) {
    sources.push({ label: "480p", src: toHttps(source["480"]), type });
  }
  return sources;
};

export const getSteamMovieSource = (
  movie: SteamMovie
): SteamMovieSource | null => {
  if (movie.hls_h264) {
    return { videoSrc: toHttps(movie.hls_h264), videoType: HLS_VIDEO_TYPE };
  }

  const dashSrc = movie.dash_h264 || movie.dash_av1;
  if (dashSrc) {
    return { videoSrc: toHttps(dashSrc), videoType: DASH_VIDEO_TYPE };
  }

  if (movie.mp4?.max) {
    return {
      videoSrc: toHttps(movie.mp4.max),
      videoType: MP4_VIDEO_TYPE,
      sources: buildProgressiveSources(movie.mp4, MP4_VIDEO_TYPE),
    };
  }

  if (movie.webm?.max) {
    return {
      videoSrc: toHttps(movie.webm.max),
      videoType: WEBM_VIDEO_TYPE,
      sources: buildProgressiveSources(movie.webm, WEBM_VIDEO_TYPE),
    };
  }

  return null;
};
