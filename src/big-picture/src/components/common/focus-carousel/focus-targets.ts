export function getDirectionBiasedFocusIndexes(visibleIndexes: number[]) {
  if (visibleIndexes.length === 0) {
    return {
      previous: null,
      next: null,
    };
  }

  const leftMiddlePosition = Math.floor((visibleIndexes.length - 1) / 2);
  const rightMiddlePosition = Math.ceil((visibleIndexes.length - 1) / 2);

  return {
    previous: visibleIndexes[rightMiddlePosition] ?? visibleIndexes.at(-1)!,
    next: visibleIndexes[leftMiddlePosition] ?? visibleIndexes[0]!,
  };
}
