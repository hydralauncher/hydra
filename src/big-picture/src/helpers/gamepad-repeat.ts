export const GAMEPAD_REPEAT_INITIAL_DELAY = 400;
export const GAMEPAD_REPEAT_INTERVAL = 81;

// Held directions repeat at a single steady rate: there is no warm-up ramp, so
// the first repeat is already as fast as every one after it.
export function getGamepadRepeatInterval() {
  return GAMEPAD_REPEAT_INTERVAL;
}
