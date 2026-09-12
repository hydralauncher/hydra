export const buildWineDllOverridesValue = (dllNames: string[]): string =>
  dllNames
    .map((name) => (name.startsWith("win") ? `${name}=n,b` : `${name}=n`))
    .join(";");

const WINEDLLOVERRIDES_TOKEN_REGEX = /\bWINEDLLOVERRIDES=\S+/i;

// umu-run only picks up WINEDLLOVERRIDES correctly when it's the first env
// token, so it always gets moved to the front after merging.
const moveWineDllOverridesToFront = (value: string): string => {
  const match = value.match(WINEDLLOVERRIDES_TOKEN_REGEX);
  if (!match || match.index === undefined) return value;

  const token = match[0];
  const rest = (
    value.slice(0, match.index) + value.slice(match.index + token.length)
  )
    .replace(/\s+/g, " ")
    .trim();

  return rest.length > 0 ? `${token} ${rest}` : token;
};

export const mergeLaunchOptionEnvVars = (
  launchOptions: string,
  envVars: Record<string, string>
): string => {
  const entries = Object.entries(envVars);
  if (entries.length === 0) return launchOptions;

  let result = launchOptions.trim();

  for (const [name, value] of entries.reverse()) {
    const rawToken = `${name}=${value}`;
    // Quote the whole "NAME=value" token when the value has whitespace
    // (e.g. a Wine prefix or Steam path) — the launch-options parser only
    // strips quotes that wrap an entire token, not ones around just the
    // value, so `NAME="a b"` would otherwise be split at the space.
    const token = /\s/.test(value) ? `"${rawToken}"` : rawToken;
    const tokenRegex = new RegExp(`"${name}=[^"]*"|\\b${name}=\\S+`, "i");

    if (tokenRegex.test(result)) {
      result = result.replace(tokenRegex, token);
    } else {
      result = result.length === 0 ? token : `${token} ${result}`;
    }
  }

  result = moveWineDllOverridesToFront(result);

  return result.includes("%command%") ? result : `${result} %command%`;
};
