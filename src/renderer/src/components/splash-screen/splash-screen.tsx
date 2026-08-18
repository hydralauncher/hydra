import { useEffect, useState } from "react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import "./splash-screen.scss";

type SplashStage =
  | "initial"
  | "fading-in"
  | "holding"
  | "fading-out"
  | "finished";

function playCinematicIntroSound() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const audioCtx = new AudioCtx();
    const now = audioCtx.currentTime;

    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.2, now + 0.1);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 4.5);
    masterGain.connect(audioCtx.destination);

    // Deep Cinematic Sub Impact
    const baseFreq = 55;
    const hitFilter = audioCtx.createBiquadFilter();
    hitFilter.type = "lowpass";
    hitFilter.frequency.setValueAtTime(0, now);
    hitFilter.frequency.linearRampToValueAtTime(1000, now + 0.1);
    hitFilter.frequency.exponentialRampToValueAtTime(100, now + 4.5);
    hitFilter.connect(masterGain);

    [baseFreq, baseFreq * 2, baseFreq * 3].forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      osc.type = idx === 0 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, now);
      osc.connect(hitFilter);
      osc.start(now);
      osc.stop(now + 4.5);
    });

    // Shimmering Airy Tail (PlayStation Dust Effect)
    const shimmerGain = audioCtx.createGain();
    shimmerGain.gain.setValueAtTime(0, now);
    shimmerGain.gain.linearRampToValueAtTime(0.04, now + 0.5);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);
    shimmerGain.connect(masterGain);

    [2500, 2750, 3100, 3450, 3800].forEach((freq) => {
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq / 2, now + 3.0);
      osc.connect(shimmerGain);
      osc.start(now);
      osc.stop(now + 3.0);
    });

    setTimeout(() => {
      audioCtx.close().catch(() => {});
    }, 5000);
  } catch {
    // Ignore audio error
  }
}

interface SplashScreenProps {
  onFinish?: () => void;
}

export function SplashScreen({ onFinish }: Readonly<SplashScreenProps>) {
  const [stage, setStage] = useState<SplashStage>("initial");

  useEffect(() => {
    const t1 = setTimeout(() => {
      setStage("fading-in");
      playCinematicIntroSound();
    }, 100);

    const t2 = setTimeout(() => {
      setStage("holding");
    }, 1500);

    const t3 = setTimeout(() => {
      setStage("fading-out");
    }, 3000);

    const t4 = setTimeout(() => {
      setStage("finished");
      onFinish?.();
    }, 3800);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [onFinish]);

  if (stage === "finished") return null;

  return (
    <div className={`splash-screen splash-screen--${stage}`}>
      <div className="splash-screen__logo-container">
        <HydraIcon className="splash-screen__logo" />
      </div>
      <div className="splash-screen__glass-effect" />
    </div>
  );
}
