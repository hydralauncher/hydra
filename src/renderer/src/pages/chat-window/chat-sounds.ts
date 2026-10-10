import messageSoundUrl from "../../../../big-picture/src/assets/audio/Favorite Sound.wav";

const MESSAGE_SOUND_VOLUME = 0.35;

export async function playMessageSound() {
  const audio = new Audio(messageSoundUrl);
  audio.volume = MESSAGE_SOUND_VOLUME;
  await audio.play().catch(() => {});
}
