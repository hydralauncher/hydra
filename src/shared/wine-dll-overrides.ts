export const buildWineDllOverridesValue = (dllNames: string[]): string =>
  dllNames
    .map((name) => (name.startsWith("win") ? `${name}=n,b` : `${name}=n`))
    .join(";");

const COMMAND_PLACEHOLDER = "%command%";
const WINEDLLOVERRIDES = "WINEDLLOVERRIDES";
const ENV_ASSIGNMENT_NAME_REGEX = /^["']?([A-Za-z_]\w*)=/;

// Splits like the launch option parser, keeping quoted values in one token.
const splitLaunchOptionTokens = (value: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  if (current) tokens.push(current);
  return tokens;
};

const getEnvAssignmentName = (token: string) =>
  ENV_ASSIGNMENT_NAME_REGEX.exec(token)?.[1].toUpperCase() ?? null;

const buildEnvAssignmentToken = (name: string, value: string) => {
  const token = `${name}=${value}`;
  return /\s/.test(value) ? `"${token}"` : token;
};

const moveWineDllOverridesToFront = (tokens: string[]): string[] => {
  const index = tokens.findIndex(
    (token) => getEnvAssignmentName(token) === WINEDLLOVERRIDES
  );
  if (index <= 0) return tokens;

  return [tokens[index], ...tokens.filter((_, i) => i !== index)];
};

// The placeholder must follow the env assignments but precede any existing
// game arguments, otherwise the first argument would be run as the program.
const insertCommandPlaceholder = (tokens: string[]): string[] => {
  const firstArgumentIndex = tokens.findIndex(
    (token) => getEnvAssignmentName(token) === null
  );
  if (firstArgumentIndex === -1) return [...tokens, COMMAND_PLACEHOLDER];

  return tokens.toSpliced(firstArgumentIndex, 0, COMMAND_PLACEHOLDER);
};

const hasCommandPlaceholder = (tokens: string[]) =>
  tokens.some((token) =>
    [
      COMMAND_PLACEHOLDER,
      `"${COMMAND_PLACEHOLDER}"`,
      `'${COMMAND_PLACEHOLDER}'`,
    ].includes(token)
  );

export const mergeLaunchOptionEnvVars = (
  launchOptions: string,
  envVars: Record<string, string>
): string => {
  const entries = Object.entries(envVars);
  if (entries.length === 0) return launchOptions;

  let tokens = splitLaunchOptionTokens(launchOptions);
  const newTokens: string[] = [];

  for (const [name, value] of entries) {
    const token = buildEnvAssignmentToken(name, value);
    const existingIndex = tokens.findIndex(
      (existing) => getEnvAssignmentName(existing) === name.toUpperCase()
    );

    if (existingIndex === -1) {
      newTokens.push(token);
    } else {
      tokens = tokens.with(existingIndex, token);
    }
  }

  tokens = moveWineDllOverridesToFront([...newTokens, ...tokens]);

  if (!hasCommandPlaceholder(tokens)) {
    tokens = insertCommandPlaceholder(tokens);
  }

  return tokens.join(" ");
};
