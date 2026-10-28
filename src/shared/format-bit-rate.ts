const BIT_RATE_UNITS = ["bps", "Kbps", "Mbps", "Gbps"];

export const formatBitRate = (bytesPerSecond: number): string => {
  const bitsPerSecond =
    Number.isFinite(bytesPerSecond) && bytesPerSecond > 0
      ? bytesPerSecond * 8
      : 0;

  const unitIndex =
    bitsPerSecond < 1000
      ? 0
      : Math.min(
          Math.floor(Math.log10(bitsPerSecond) / 3),
          BIT_RATE_UNITS.length - 1
        );

  const value = bitsPerSecond / 1000 ** unitIndex;

  return `${Math.trunc(value * 10) / 10} ${BIT_RATE_UNITS[unitIndex]}`;
};
