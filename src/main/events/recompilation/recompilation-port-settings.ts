import fs from "node:fs";
import path from "node:path";

import type { RecompilationRomMeta } from "@types";

type PortPath = string | Partial<Record<"win32" | "linux", string>>;
type OnlineMeta = NonNullable<
  NonNullable<RecompilationRomMeta["path"]>["online"]
>;

/** The file a port keeps on this system, or null when it has none here. */
export const pickPortFile = (file: PortPath) =>
  typeof file === "string"
    ? file
    : (file[process.platform as "win32" | "linux"] ?? null);

const INI_LINE = /^\s*([^#;=\s][^=]*?)\s*=(.*)$/;

/** The value of `key=value` in an INI text, or null. */
export const readIniValue = (contents: string, key: string) => {
  for (const line of contents.split(/\r?\n/)) {
    const match = INI_LINE.exec(line);
    if (match?.[1] === key) return match[2].trim();
  }
  return null;
};

/** The INI text with these `key=value` lines replaced, or added at the end. */
export const setIniValues = (
  contents: string,
  values: Record<string, string>
) => {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const pending = new Map(Object.entries(values));
  const lines = contents === "" ? [] : contents.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const updated = lines.map((line) => {
    const key = INI_LINE.exec(line)?.[1];
    if (key === undefined || !pending.has(key)) return line;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of pending) updated.push(`${key}=${value}`);
  return updated.join(newline) + newline;
};

export const writeIniValues = async (
  file: string,
  values: Record<string, string>
) => {
  const contents = await fs.promises.readFile(file, "utf-8").catch(() => "");
  const updated = setIniValues(contents, values);
  if (updated === contents) return;
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, updated);
};

const NAME_MIN_LENGTH = 3;
const NAME_MAX_LENGTH = 16;
const NAME_CHARACTERS = /^[A-Za-z0-9_-]+$/;

/** A name the port accepts: 3 to 16 ASCII letters, digits, _ or -, not reserved. */
export const isValidPortName = (name: string, reserved: string[]) =>
  name.length >= NAME_MIN_LENGTH &&
  name.length <= NAME_MAX_LENGTH &&
  NAME_CHARACTERS.test(name) &&
  !reserved.includes(name.toLowerCase());

/**
 * The Hydra name made into one the port accepts: accents become plain
 * letters, other characters go, and it is cut to 16. Null when what is left
 * is too short or reserved.
 */
export const toPortName = (displayName: string, reserved: string[]) => {
  const name = displayName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, NAME_MAX_LENGTH);
  return isValidPortName(name, reserved) ? name : null;
};

/**
 * The environment for a port's online play. Signed in: online, as the name
 * the player set in the port or else the Hydra name. Signed out, or with no
 * usable name: offline.
 */
export const getOnlineLaunchEnv = async (
  online: OnlineMeta,
  resolvePath: (template: string) => string,
  account: { displayName: string } | null
): Promise<Record<string, string>> => {
  const offline = { [online.enabledEnv]: "0" };
  if (!account) return offline;

  const template = pickPortFile(online.nameConfig.file);
  const contents = template
    ? await fs.promises.readFile(resolvePath(template), "utf-8").catch(() => "")
    : "";
  const ownName = online.nameConfig.keys
    .map((key) => readIniValue(contents, key))
    .find((value) => value !== null && value !== "");
  if (ownName && isValidPortName(ownName, online.reservedNames)) {
    return { [online.enabledEnv]: "1" };
  }

  const name = toPortName(account.displayName, online.reservedNames);
  return name ? { [online.enabledEnv]: "1", [online.nameEnv]: name } : offline;
};
