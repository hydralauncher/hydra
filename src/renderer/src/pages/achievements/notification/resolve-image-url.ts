const IMAGE_PREPARATION_TIMEOUT = 2_000;

export const resolveImageUrl = (
  source: string,
  fallbackUrl: string,
  preparationTimeout = IMAGE_PREPARATION_TIMEOUT
): Promise<string> => {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    let loadTimeout: ReturnType<typeof setTimeout> | null = null;
    let decodeTimeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (url: string) => {
      if (settled) return;
      settled = true;
      if (loadTimeout !== null) clearTimeout(loadTimeout);
      if (decodeTimeout !== null) clearTimeout(decodeTimeout);
      image.onload = null;
      image.onerror = null;
      resolve(url);
    };

    loadTimeout = setTimeout(() => finish(fallbackUrl), preparationTimeout);

    image.onload = () => {
      clearTimeout(loadTimeout);

      if (typeof image.decode !== "function") {
        finish(source);
        return;
      }

      decodeTimeout = setTimeout(() => finish(source), preparationTimeout);
      void image.decode().then(
        () => finish(source),
        () => finish(source)
      );
    };
    image.onerror = () => finish(fallbackUrl);
    image.src = source;
  });
};
