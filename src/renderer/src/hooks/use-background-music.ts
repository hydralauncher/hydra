import { useEffect, useRef } from "react";
import backgroundMusicPath from "@renderer/assets/audio/hydra-music-theme.wav";
import { useAppSelector } from "./redux";
import { logger } from "../logger";

const FADE_TIME = 3;
const FADE_STEPS = 30;

export function useBackgroundMusic() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const isGameRunning = useAppSelector((state) =>
    Boolean(state.gameRunning.gameRunning)
  );

  const enabled =
    Boolean(userPreferences?.backgroundMusicEnabled) && !isGameRunning;
  const volume = userPreferences?.backgroundMusicVolume ?? 0.15;

  const audioRef1 = useRef<HTMLAudioElement | null>(null);
  const audioRef2 = useRef<HTMLAudioElement | null>(null);
  const activeIndexRef = useRef<1 | 2>(1);
  const faderRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!audioRef1.current) {
      audioRef1.current = new Audio(backgroundMusicPath);
      audioRef2.current = new Audio(backgroundMusicPath);
      logger.info("[BackgroundMusic] Created audio elements", {
        src: backgroundMusicPath,
      });
    }

    const a1 = audioRef1.current;
    const a2 = audioRef2.current;
    if (!a1 || !a2) return;

    const handleError = (label: string) => (event: Event) => {
      const mediaError = (event.target as HTMLAudioElement).error;
      logger.error(
        `[BackgroundMusic] ${label} failed to load/decode`,
        mediaError
          ? { code: mediaError.code, message: mediaError.message }
          : event
      );
    };
    const onError1 = handleError("audio1");
    const onError2 = handleError("audio2");
    a1.addEventListener("error", onError1);
    a2.addEventListener("error", onError2);

    let isFading = false;

    const performFade = (
      activeAudio: HTMLAudioElement,
      nextAudio: HTMLAudioElement
    ) => {
      let step = 0;
      if (faderRef.current) clearInterval(faderRef.current);

      faderRef.current = setInterval(
        () => {
          step++;
          const ratio = step / FADE_STEPS;
          activeAudio.volume = Math.max(0, volume * (1 - ratio));
          nextAudio.volume = Math.min(volume, volume * ratio);

          if (step >= FADE_STEPS) {
            if (faderRef.current) clearInterval(faderRef.current);
            activeAudio.pause();
            activeAudio.currentTime = 0;
            isFading = false;
          }
        },
        (FADE_TIME * 1000) / FADE_STEPS
      );
    };

    const handleTimeUpdate = (
      activeAudio: HTMLAudioElement,
      nextAudio: HTMLAudioElement,
      activeIdx: 1 | 2
    ) => {
      if (!activeAudio.duration) return;

      if (
        activeAudio.currentTime >= activeAudio.duration - FADE_TIME &&
        !isFading &&
        enabled
      ) {
        isFading = true;
        activeIndexRef.current = activeIdx === 1 ? 2 : 1;

        nextAudio.currentTime = 0;
        nextAudio.volume = 0;
        nextAudio.play().catch(() => {});
        performFade(activeAudio, nextAudio);
      }
    };

    const onTimeUpdate1 = () => handleTimeUpdate(a1, a2, 1);
    const onTimeUpdate2 = () => handleTimeUpdate(a2, a1, 2);

    a1.addEventListener("timeupdate", onTimeUpdate1);
    a2.addEventListener("timeupdate", onTimeUpdate2);

    return () => {
      a1.removeEventListener("timeupdate", onTimeUpdate1);
      a2.removeEventListener("timeupdate", onTimeUpdate2);
      a1.removeEventListener("error", onError1);
      a2.removeEventListener("error", onError2);
    };
  }, [enabled, volume]);

  useEffect(() => {
    const a1 = audioRef1.current;
    const a2 = audioRef2.current;
    if (!a1 || !a2) return;

    if (!enabled) {
      a1.pause();
      a2.pause();
      if (faderRef.current) clearInterval(faderRef.current);
    } else {
      const activeAudio = activeIndexRef.current === 1 ? a1 : a2;
      const idleAudio = activeIndexRef.current === 1 ? a2 : a1;

      activeAudio.volume = volume;
      if (activeAudio.paused) {
        if (document.hasFocus()) {
          activeAudio
            .play()
            .catch((err) =>
              logger.warn("[BackgroundMusic] play() rejected", err)
            );
        } else {
          logger.info(
            "[BackgroundMusic] Skipped play(): window is not focused"
          );
        }
      }
      idleAudio.pause();
    }
  }, [enabled, volume]);

  useEffect(() => {
    const handleInteraction = () => {
      if (!enabled || !document.hasFocus()) return;
      const activeAudio =
        activeIndexRef.current === 1 ? audioRef1.current : audioRef2.current;
      if (activeAudio?.paused) {
        activeAudio
          .play()
          .catch((err) =>
            logger.warn("[BackgroundMusic] play() rejected on interaction", err)
          );
      }
    };

    const handleBlur = () => {
      if (audioRef1.current) audioRef1.current.pause();
      if (audioRef2.current) audioRef2.current.pause();
    };

    window.addEventListener("click", handleInteraction);
    window.addEventListener("keydown", handleInteraction);
    window.addEventListener("focus", handleInteraction);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      window.removeEventListener("focus", handleInteraction);
      window.removeEventListener("blur", handleBlur);
    };
  }, [enabled]);

  useEffect(() => {
    return () => {
      if (audioRef1.current) {
        audioRef1.current.pause();
        audioRef1.current.src = "";
        audioRef1.current = null;
      }
      if (audioRef2.current) {
        audioRef2.current.pause();
        audioRef2.current.src = "";
        audioRef2.current = null;
      }
      if (faderRef.current) clearInterval(faderRef.current);
    };
  }, []);
}
