export const GAMEPAD_REPEAT_INITIAL_DELAY = 400;
export const GAMEPAD_REPEAT_WARMUP_INTERVAL = 200;
export const GAMEPAD_REPEAT_WARMUP_TICKS = 2;
export const GAMEPAD_REPEAT_INTERVAL = 150;

export function getAcceleratedGamepadRepeatInterval(repeatCount: number) {
  if (repeatCount < GAMEPAD_REPEAT_WARMUP_TICKS) {
    return GAMEPAD_REPEAT_WARMUP_INTERVAL;
  }

  return GAMEPAD_REPEAT_INTERVAL;
}
