let pendingActivation: Promise<void> = Promise.resolve();

// Queue completion and provider preparation must claim the same active slot.
export function withDownloadActivation<T>(
  activate: () => Promise<T>
): Promise<T> {
  const activation = pendingActivation.then(activate);
  pendingActivation = activation.then(
    () => undefined,
    () => undefined
  );
  return activation;
}
