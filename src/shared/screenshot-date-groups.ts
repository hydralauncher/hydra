export const CAPTURE_DAY_MS = 24 * 60 * 60 * 1000;

export interface CaptureDayGroup<Item> {
  key: string;
  dayStart: number;
  items: Item[];
}

export const getCaptureDayStart = (timestamp: number) => {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
};

export const groupByCaptureDay = <Item>(
  items: Item[],
  getCapturedAt: (item: Item) => number
): CaptureDayGroup<Item>[] => {
  const groups = new Map<number, Item[]>();
  const sorted = items.toSorted(
    (left, right) => getCapturedAt(right) - getCapturedAt(left)
  );

  for (const item of sorted) {
    const dayStart = getCaptureDayStart(getCapturedAt(item));
    const group = groups.get(dayStart);
    if (group) group.push(item);
    else groups.set(dayStart, [item]);
  }

  return [...groups.entries()].map(([dayStart, groupItems]) => ({
    key: String(dayStart),
    dayStart,
    items: groupItems,
  }));
};
