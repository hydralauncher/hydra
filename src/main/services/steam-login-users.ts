import fs from "node:fs";
import path from "node:path";

type VdfValue = string | VdfObject;
interface VdfObject {
  [key: string]: VdfValue;
}

const STEAM_ID_64_PATTERN = /^\d{17}$/;

const tokenizeVdf = (content: string): string[] | null => {
  const tokens: string[] = [];
  let index = 0;

  while (index < content.length) {
    const character = content[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "{" || character === "}") {
      tokens.push(character);
      index += 1;
      continue;
    }
    if (character !== '"') return null;

    index += 1;
    let value = "";
    let closed = false;
    while (index < content.length) {
      const current = content[index];
      index += 1;
      if (current === '"') {
        closed = true;
        break;
      }
      if (current === "\\" && index < content.length) {
        value += content[index];
        index += 1;
      } else {
        value += current;
      }
    }
    if (!closed) return null;
    tokens.push(value);
  }

  return tokens;
};

const parseVdfObject = (
  tokens: string[],
  start: number,
  nested: boolean
): { value: VdfObject; next: number } | null => {
  const value: VdfObject = {};
  let index = start;

  while (index < tokens.length) {
    if (tokens[index] === "}") {
      return nested ? { value, next: index + 1 } : null;
    }

    const key = tokens[index];
    if (key === "{") return null;
    index += 1;
    if (index >= tokens.length) return null;

    if (tokens[index] === "{") {
      const child = parseVdfObject(tokens, index + 1, true);
      if (!child) return null;
      value[key] = child.value;
      index = child.next;
      continue;
    }
    if (tokens[index] === "}") return null;

    value[key] = tokens[index];
    index += 1;
  }

  return nested ? null : { value, next: index };
};

const asObject = (value: VdfValue | undefined): VdfObject | null =>
  value && typeof value === "object" ? value : null;

const getCaseInsensitive = (object: VdfObject, key: string) => {
  const entry = Object.entries(object).find(
    ([candidate]) => candidate.toLowerCase() === key.toLowerCase()
  );
  return entry?.[1];
};

export const parseActiveSteamUserId = (content: string): string | undefined => {
  const tokens = tokenizeVdf(content);
  if (!tokens) return undefined;

  const parsed = parseVdfObject(tokens, 0, false);
  if (!parsed || parsed.next !== tokens.length) return undefined;

  const users = asObject(getCaseInsensitive(parsed.value, "users"));
  if (!users) return undefined;

  const candidates = Object.entries(users).filter(
    ([steamId, details]) =>
      STEAM_ID_64_PATTERN.test(steamId) && asObject(details) !== null
  );
  const mostRecent = candidates.filter(([, details]) => {
    const value = getCaseInsensitive(asObject(details)!, "MostRecent");
    return value === "1";
  });

  if (mostRecent.length === 1) return mostRecent[0][0];
  if (mostRecent.length > 1) return undefined;
  return candidates.length === 1 ? candidates[0][0] : undefined;
};

export const getActiveSteamUserId = async (
  steamPath: string
): Promise<string | undefined> => {
  const loginUsersPath = path.join(steamPath, "config", "loginusers.vdf");
  const content = await fs.promises
    .readFile(loginUsersPath, "utf8")
    .catch(() => null);

  return content === null ? undefined : parseActiveSteamUserId(content);
};
