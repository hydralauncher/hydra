import fs from "node:fs";
import path from "node:path";

import type { RecompilationRomMeta } from "@types";

type PortPath = string | Partial<Record<"win32" | "linux", string>>;
type OnlineMeta = NonNullable<
  NonNullable<RecompilationRomMeta["path"]>["online"]
>;

export const pickPortFile = (file: PortPath) =>
  typeof file === "string"
    ? file
    : (file[process.platform as "win32" | "linux"] ?? null);

const INI_LINE = /^\s*([^#;=\s][^=]*?)\s*=(.*)$/;

export const readIniValue = (contents: string, key: string) => {
  for (const line of contents.split(/\r?\n/)) {
    const match = INI_LINE.exec(line);
    if (match?.[1] === key) return match[2].trim();
  }
  return null;
};

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

export const isValidPortName = (name: string, reserved: string[]) =>
  name.length >= NAME_MIN_LENGTH &&
  name.length <= NAME_MAX_LENGTH &&
  NAME_CHARACTERS.test(name) &&
  !reserved.includes(name.toLowerCase());

export const toPortName = (displayName: string, reserved: string[]) => {
  const name = displayName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, NAME_MAX_LENGTH);
  return isValidPortName(name, reserved) ? name : null;
};

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
