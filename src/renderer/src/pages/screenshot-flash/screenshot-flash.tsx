import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getAchievementSoundUrl,
  getAchievementSoundVolume,
} from "@renderer/helpers";
import { logger } from "@renderer/logger";

import "./screenshot-flash.scss";

const TRANSPARENT_ELEMENT_SELECTORS = ["html", "body", "#root"];

const playCaptureSound = async () => {
  try {
    const [soundUrl, volume] = await Promise.all([
      getAchievementSoundUrl(),
      getAchievementSoundVolume(),
    ]);
    const audio = new Audio(soundUrl);
    audio.volume = volume;
    await audio.play();
  } catch (error) {
    logger.error("Failed to play the screenshot capture sound", error);
  }
};

const useTransparentDocument = () => {
  useEffect(() => {
    const elements = TRANSPARENT_ELEMENT_SELECTORS.map((selector) =>
      document.querySelector<HTMLElement>(selector)
    ).filter((element): element is HTMLElement => element !== null);

    const previousBackgrounds = elements.map(
      (element) => element.style.background
    );

    for (const element of elements) {
      element.style.background = "transparent";
    }

    return () => {
      elements.forEach((element, index) => {
        element.style.background = previousBackgrounds[index];
      });
    };
  }, []);
};

export function ScreenshotFlash() {
  const [searchParams] = useSearchParams();
  const isPrimary = searchParams.get("primary") === "1";
  const [flashKey, setFlashKey] = useState(0);

  useTransparentDocument();

  useEffect(() => {
    const unsubscribe = window.electron.onScreenshotFeedback(
      ({ flash, playSound }) => {
        if (flash) setFlashKey((current) => current + 1);
        if (playSound && isPrimary) void playCaptureSound();
      }
    );
    window.electron.screenshotFlashReady().catch((error) => {
      logger.error("Failed to report the screenshot flash window ready", error);
    });
    return unsubscribe;
  }, [isPrimary]);

  return (
    <div className="screenshot-flash" aria-hidden="true">
      {flashKey > 0 && (
        <div key={flashKey} className="screenshot-flash__glow" />
      )}
    </div>
  );
}
