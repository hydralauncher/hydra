import { useEffect, useState } from "react";
import { playIntroSound } from "@renderer/helpers";
import "./splash-screen.scss";

export function SplashScreen() {
  const [isVisible, setIsVisible] = useState(true);
  const [isRendered, setIsRendered] = useState(true);

  useEffect(() => {
    playIntroSound();

    const fadeTimer = setTimeout(() => {
      setIsVisible(false);
    }, 1400);

    const unmountTimer = setTimeout(() => {
      setIsRendered(false);
    }, 1900);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(unmountTimer);
    };
  }, []);

  if (!isRendered) return null;

  return (
    <div
      className={`app-splash-screen ${
        !isVisible ? "app-splash-screen--hidden" : ""
      }`}
    >
      <div className="app-splash-screen__content">
        <svg
          className="app-splash-screen__logo"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="50" cy="50" r="45" stroke="#7c3aed" strokeWidth="6" />
          <path d="M30 65L50 30L70 65L50 52L30 65Z" fill="#a78bfa" />
        </svg>
        <span className="app-splash-screen__title">Hydra</span>
        <div className="app-splash-screen__loader">
          <div className="app-splash-screen__loader-bar" />
        </div>
      </div>
    </div>
  );
}
