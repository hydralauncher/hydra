import type { UserPreferences } from "@types";

export type BigPictureAudioOperation =
  | { type: "restore" }
  | { type: "set"; deviceId: string };

export type SessionOperationQueue = {
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>;
};

export const createSessionOperationQueue = (
  onPreviousOperationError: (error: unknown) => void
): SessionOperationQueue => {
  let pendingOperation: Promise<void> = Promise.resolve();

  return {
    enqueue: <T>(operation: () => Promise<T>) => {
      const operationPromise = pendingOperation
        .catch(onPreviousOperationError)
        .then(operation);

      pendingOperation = operationPromise.then(
        () => undefined,
        () => undefined
      );

      return operationPromise;
    },
  };
};

export function getBigPictureAudioOperation(
  userPreferences: Pick<
    UserPreferences,
    "bigPictureAudioDeviceId" | "bigPictureSoundsEnabled"
  >
): BigPictureAudioOperation {
  if (
    userPreferences.bigPictureSoundsEnabled === false ||
    !userPreferences.bigPictureAudioDeviceId
  ) {
    return { type: "restore" };
  }

  return { type: "set", deviceId: userPreferences.bigPictureAudioDeviceId };
}
