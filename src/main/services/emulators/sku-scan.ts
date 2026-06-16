export const BOOT_SKU_RE =
  /BOOT2?\s*=\s*cdrom0?:\\?([A-Z]{4}[_\-.\s]?\d{2,3}[_\-.\s]?\d{2,3})/i;
export const ISO_FILENAME_SKU_RE = /([A-Z]{4})_(\d{2,3})\.(\d{2,3});1/;
export const TAIL_BYTES = 128;

export const scanBuffersForRawSku = (chunks: Buffer[]): string | null => {
  let tail = "";
  let isoFallback: string | null = null;

  for (const chunk of chunks) {
    const text = tail + chunk.toString("latin1");

    const match = BOOT_SKU_RE.exec(text);
    if (match) return match[1];

    if (isoFallback === null) {
      const fileMatch = ISO_FILENAME_SKU_RE.exec(text);
      if (fileMatch) {
        isoFallback = `${fileMatch[1]}_${fileMatch[2]}.${fileMatch[3]}`;
      }
    }

    tail = text.slice(-TAIL_BYTES);
  }

  return isoFallback;
};
