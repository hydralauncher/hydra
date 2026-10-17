export const buildWineDllOverridesValue = (dllNames: string[]): string =>
  dllNames
    .map((name) => (name.startsWith("win") ? `${name}=n,b` : `${name}=n`))
    .join(";");

const WINEDLLOVERRIDES_TOKEN_REGEX = /\bWINEDLLOVERRIDES=\S+/i;

const moveWineDllOverridesToFront = (value: string): string => {
  const match = WINEDLLOVERRIDES_TOKEN_REGEX.exec(value);
  if (match?.index === undefined) return value;

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

  const reversedEntries = entries.toReversed();

  for (const [name, value] of reversedEntries) {
    const rawToken = `${name}=${value}`;
    const token = /\s/.test(value) ? `"${rawToken}"` : rawToken;
    const tokenRegex = new RegExp(
      String.raw`"${name}=[^"]*"|\b${name}=\S+`,
      "i"
    );

    if (tokenRegex.test(result)) {
      result = result.replace(tokenRegex, token);
    } else {
      result = result.length === 0 ? token : `${token} ${result}`;
    }
  }

  result = moveWineDllOverridesToFront(result);

  return result.includes("%command%") ? result : `${result} %command%`;
};
