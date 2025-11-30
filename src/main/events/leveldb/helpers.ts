import { db } from "@main/level";

const sublevelCache = new Map<
  string,
  ReturnType<typeof db.sublevel<string, unknown>>
>();

/**
 * Gets a sublevel by name, creating it if it doesn't exist.
 * All sublevels use "json" encoding by default.
 * @param sublevelName - The name of the sublevel to get or create
 * @returns The sublevel instance
 */
export const getSublevelByName = (
  sublevelName: string
): ReturnType<typeof db.sublevel<string, unknown>> => {
  if (sublevelCache.has(sublevelName)) {
    return sublevelCache.get(sublevelName)!;
  }

  // All sublevels use "json" encoding - this cannot be changed per sublevel
  const sublevel = db.sublevel<string, unknown>(sublevelName, {
    valueEncoding: "json",
  });
  sublevelCache.set(sublevelName, sublevel);
  return sublevel;
};
