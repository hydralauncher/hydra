/**
 * Errors from the mod manager cross the main/renderer boundary as plain
 * strings, so they carry a stable code instead of English text. The renderer
 * turns the code into a translated message.
 */
export const MODS_ERROR_CODES = [
  "no_executable",
  "no_community",
  "unsupported_loader",
  "package_not_found",
  "extract_failed",
  "unsafe_path",
  "no_game_dir",
  "loader_cannot_disable",
  "missing_dependencies",
] as const;

export type ModsErrorCode = (typeof MODS_ERROR_CODES)[number];

export type ModsErrorParams = Record<string, string>;

const PREFIX = "mods:";
const PATTERN = /mods:([a-z_]+)(?:\|(\{[^\n]*\}))?/;

export const encodeModsError = (
  code: ModsErrorCode,
  params?: ModsErrorParams
): string => `${PREFIX}${code}${params ? `|${JSON.stringify(params)}` : ""}`;

/**
 * Finds an encoded error anywhere in a message. Electron wraps errors thrown in
 * the main process ("Error invoking remote method ..."), so the code is
 * searched for rather than matched at the start.
 */
export const parseModsError = (
  message: string
): { code: ModsErrorCode; params: ModsErrorParams } | null => {
  const match = PATTERN.exec(message);
  if (!match) return null;

  const code = match[1] as ModsErrorCode;
  if (!MODS_ERROR_CODES.includes(code)) return null;

  let params: ModsErrorParams = {};
  if (match[2]) {
    try {
      params = JSON.parse(match[2]) as ModsErrorParams;
    } catch {
      params = {};
    }
  }
  return { code, params };
};

/** Strips Electron's IPC wrapper so an unknown error reads cleanly. */
export const stripIpcErrorPrefix = (message: string): string =>
  message.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, "");
