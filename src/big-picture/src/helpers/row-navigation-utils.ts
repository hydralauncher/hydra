export const ROW_TOLERANCE_PX = 24;

export function groupItemsIntoRows<T extends { top: number; left: number }>(
  items: T[]
): T[][] {
  const sortedItems = [...items].sort((a, b) => {
    if (Math.abs(a.top - b.top) > ROW_TOLERANCE_PX) {
      return a.top - b.top;
    }

    return a.left - b.left;
  });

  return sortedItems.reduce<T[][]>((rows, item) => {
    const lastRow = rows.at(-1);

    if (!lastRow || Math.abs(lastRow[0].top - item.top) > ROW_TOLERANCE_PX) {
      rows.push([item]);
      return rows;
    }

    lastRow.push(item);
    lastRow.sort((leftItem, rightItem) => leftItem.left - rightItem.left);
    return rows;
  }, []);
}

export function getClosestItemByCenterX<T extends { centerX: number }>(
  items: T[] | undefined,
  centerX: number
): T | null {
  if (!items?.length) return null;

  return [...items].sort((a, b) => {
    return Math.abs(a.centerX - centerX) - Math.abs(b.centerX - centerX);
  })[0];
}
