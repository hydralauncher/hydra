import backSoundUrl from "../assets/audio/Back sound effect.wav";
import launchSoundUrl from "../assets/audio/Launch Sound.wav";
import scrollSoundUrl from "../assets/audio/Scroll Sound.wav";
import selectSoundUrl from "../assets/audio/Select Sound.wav";

export type NavigationAudioCue = "back" | "launch" | "scroll" | "select";

const NAVIGATION_AUDIO_VOLUME = 0.25;

const NAVIGATION_AUDIO_URLS: Record<NavigationAudioCue, string> = {
  back: backSoundUrl,
  launch: launchSoundUrl,
  scroll: scrollSoundUrl,
  select: selectSoundUrl,
};

export class NavigationAudioService {
  private static instance: NavigationAudioService;

  private readonly audioByCue = new Map<NavigationAudioCue, HTMLAudioElement>();
  private enabled = true;

  public static getInstance() {
    if (!NavigationAudioService.instance) {
      NavigationAudioService.instance = new NavigationAudioService();
    }

    return NavigationAudioService.instance;
  }

  public play(cue: NavigationAudioCue) {
    if (!this.enabled) {
      return;
    }

    const audio = this.getAudio(cue);

    if (!audio) return;

    try {
      audio.currentTime = 0;
    } catch {
      // Some browsers may reject seeking before metadata is ready.
    }

    audio.play().catch(() => {});
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;

    if (enabled) {
      return;
    }

    for (const audio of this.audioByCue.values()) {
      audio.pause();

      try {
        audio.currentTime = 0;
      } catch {
        // Some browsers may reject seeking before metadata is ready.
      }
    }
  }

  private getAudio(cue: NavigationAudioCue) {
    if (typeof Audio === "undefined") {
      return null;
    }

    const cachedAudio = this.audioByCue.get(cue);

    if (cachedAudio) {
      return cachedAudio;
    }

    const audio = new Audio(NAVIGATION_AUDIO_URLS[cue]);
    audio.preload = "auto";
    audio.volume = NAVIGATION_AUDIO_VOLUME;

    this.audioByCue.set(cue, audio);

    return audio;
  }
}
