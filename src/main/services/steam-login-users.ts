import fs from "node:fs";
import path from "node:path";

import type { KnownStoreAccount, StoreUserContext } from "@types";

type VdfValue = string | VdfObject;
interface VdfObject {
  [key: string]: VdfValue;
}

const STEAM_ID_64_PATTERN = /^\d{17}$/;
const STEAM_INDIVIDUAL_ACCOUNT_BASE = 76561197960265728n;
const MAX_ACCOUNT_ID_32 = 4294967295n;

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

const parseUsers = (content: string) => {
  const tokens = tokenizeVdf(content);
  if (!tokens) return null;

  const parsed = parseVdfObject(tokens, 0, false);
  if (!parsed || parsed.next !== tokens.length) return null;

  return asObject(getCaseInsensitive(parsed.value, "users"));
};

const toSteamAccount = (
  steamId64: string,
  source: KnownStoreAccount["source"]
): KnownStoreAccount | null => {
  if (!STEAM_ID_64_PATTERN.test(steamId64)) return null;
  try {
    const parsed = BigInt(steamId64);
    const accountId = parsed - STEAM_INDIVIDUAL_ACCOUNT_BASE;
    if (accountId < 0n || accountId > MAX_ACCOUNT_ID_32) return null;
    return {
      store: "steam",
      steamId64,
      accountId32: accountId.toString(),
      source,
    };
  } catch {
    return null;
  }
};

const toSteamAccountFromAccountId = (
  accountId32: string
): KnownStoreAccount | null => {
  if (!/^\d{1,10}$/.test(accountId32) || /^0\d/.test(accountId32)) return null;
  try {
    const parsed = BigInt(accountId32);
    if (parsed < 0n || parsed > MAX_ACCOUNT_ID_32) return null;
    return {
      store: "steam",
      steamId64: (STEAM_INDIVIDUAL_ACCOUNT_BASE + parsed).toString(),
      accountId32,
      source: "userdata-folder",
    };
  } catch {
    return null;
  }
};

export const parseSteamStoreUserContext = (
  content: string
): StoreUserContext => {
  const users = parseUsers(content);
  if (!users) return { known: [] };

  const parsedUsers = Object.entries(users).flatMap(([steamId64, details]) => {
    const object = asObject(details);
    const account = object ? toSteamAccount(steamId64, "known-login") : null;
    return account ? [{ account, details: object! }] : [];
  });
  const mostRecent = parsedUsers.filter(
    ({ details }) => getCaseInsensitive(details, "MostRecent") === "1"
  );
  const activeCandidate =
    mostRecent.length === 1
      ? mostRecent[0]
      : mostRecent.length === 0 && parsedUsers.length === 1
        ? parsedUsers[0]
        : null;
  const active = activeCandidate
    ? { ...activeCandidate.account, source: "active-login" as const }
    : undefined;
  const known = parsedUsers.map(({ account }) =>
    account.steamId64 === active?.steamId64 ? active! : account
  );

  return { active, known };
};

export const parseActiveSteamUserId = (content: string): string | undefined => {
  return parseSteamStoreUserContext(content).active?.steamId64;
};

export const getSteamStoreUserContext = async (
  steamPath: string
): Promise<StoreUserContext> => {
  const loginUsersPath = path.join(steamPath, "config", "loginusers.vdf");
  const content = await fs.promises
    .readFile(loginUsersPath, "utf8")
    .catch(() => null);
  const context = content
    ? parseSteamStoreUserContext(content)
    : ({ known: [] } satisfies StoreUserContext);
  const userdataPath = path.join(steamPath, "userdata");
  const entries = await fs.promises
    .readdir(userdataPath, { withFileTypes: true })
    .catch(() => []);
  const knownBySteamId = new Map(
    context.known.flatMap((account) =>
      account.steamId64 ? [[account.steamId64, account] as const] : []
    )
  );
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const account = toSteamAccountFromAccountId(entry.name);
    if (account && !knownBySteamId.has(account.steamId64!)) {
      knownBySteamId.set(account.steamId64!, account);
    }
  }

  return {
    active: context.active,
    known: Array.from(knownBySteamId.values()).sort((left, right) =>
      left.steamId64!.localeCompare(right.steamId64!)
    ),
  };
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
