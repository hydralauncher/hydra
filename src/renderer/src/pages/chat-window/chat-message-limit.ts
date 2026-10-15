/** The API rejects longer messages (CHAT_MESSAGE_MAX_LENGTH in hydra-api). */
export const CHAT_MESSAGE_MAX_LENGTH = 2_000;

/** The length counter shows from this share of the limit. */
const COUNTER_THRESHOLD = 0.9;

/** Length the API checks: it trims the message first. */
export const getMessageLength = (draft: string) => draft.trim().length;

export const shouldShowLengthCounter = (length: number) =>
  length >= CHAT_MESSAGE_MAX_LENGTH * COUNTER_THRESHOLD;

/** The part of `draft` past the limit, as [start, end) offsets; null if none. */
export const getOverflowRange = (draft: string): [number, number] | null => {
  const length = getMessageLength(draft);
  if (length <= CHAT_MESSAGE_MAX_LENGTH) return null;

  const leading = draft.length - draft.trimStart().length;
  return [leading + CHAT_MESSAGE_MAX_LENGTH, leading + length];
};
