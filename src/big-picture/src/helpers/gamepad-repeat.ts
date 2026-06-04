export const GAMEPAD_REPEAT_INITIAL_DELAY = 400;
export const GAMEPAD_REPEAT_WARMUP_INTERVAL = 200;
export const GAMEPAD_REPEAT_WARMUP_TICKS = 3;
export const GAMEPAD_REPEAT_ACCELERATED_START_INTERVAL = 135;
export const GAMEPAD_REPEAT_MIN_INTERVAL = 75;
export const GAMEPAD_REPEAT_ACCELERATION_STEP = 15;

export function getAcceleratedGamepadRepeatInterval(repeatCount: number) {
  if (repeatCount < GAMEPAD_REPEAT_WARMUP_TICKS) {
    return GAMEPAD_REPEAT_WARMUP_INTERVAL;
  }

  const accelerationTick = repeatCount - GAMEPAD_REPEAT_WARMUP_TICKS;
  const interval =
    GAMEPAD_REPEAT_ACCELERATED_START_INTERVAL -
    accelerationTick * GAMEPAD_REPEAT_ACCELERATION_STEP;

  return Math.max(GAMEPAD_REPEAT_MIN_INTERVAL, interval);
}
