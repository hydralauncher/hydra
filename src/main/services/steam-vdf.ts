export type VdfObject = { [key: string]: VdfObject | string };

/**
 * Minimal parser for Valve's text VDF format (libraryfolders.vdf,
 * appmanifest_*.acf, localconfig.vdf). Only handles quoted keys/values,
 * which is what Steam writes for these files.
 */
export const parseVdf = (content: string): VdfObject => {
  const root: VdfObject = {};
  const stack: VdfObject[] = [root];
  let pendingKey: string | null = null;

  const tokenRegex = /"((?:\\.|[^"\\])*)"|\{|\}/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(content)) !== null) {
    const token = match[0];
    const current = stack[stack.length - 1];

    if (token === "{") {
      const child: VdfObject = {};
      if (pendingKey !== null) {
        current[pendingKey] = child;
        pendingKey = null;
      }
      stack.push(child);
    } else if (token === "}") {
      if (stack.length > 1) stack.pop();
    } else {
      const value = match[1].replace(/\\(.)/g, "$1");
      if (pendingKey === null) {
        pendingKey = value;
      } else {
        current[pendingKey] = value;
        pendingKey = null;
      }
    }
  }

  return root;
};

// Steam is inconsistent about key casing across client versions
// ("Software" vs "software"), so lookups have to ignore case.
export const getVdfValue = (
  object: VdfObject | string | undefined,
  ...keys: string[]
): VdfObject | string | undefined => {
  let current: VdfObject | string | undefined = object;

  for (const key of keys) {
    if (!current || typeof current === "string") return undefined;

    const lowerKey = key.toLowerCase();
    const matchedKey = Object.keys(current).find(
      (objectKey) => objectKey.toLowerCase() === lowerKey
    );

    current = matchedKey === undefined ? undefined : current[matchedKey];
  }

  return current;
};
