const IMAGE_PREPARATION_TIMEOUT = 2_000;

export const resolveImageUrl = (
  source: string,
  fallbackUrl: string,
  preparationTimeout = IMAGE_PREPARATION_TIMEOUT
): Promise<string> => {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;

    const finish = (url: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(url);
    };

    const timeout = setTimeout(() => finish(fallbackUrl), preparationTimeout);

    image.onload = () => {
      if (typeof image.decode !== "function") {
        finish(source);
        return;
      }

      void image.decode().then(
        () => finish(source),
        () => finish(source)
      );
    };
    image.onerror = () => finish(fallbackUrl);
    image.src = source;
  });
};
