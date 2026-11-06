export const envVariableNameRegex = /^[A-Za-z_]\w*$/;

export const unquoteEnvValue = (value: string) => {
  const quote = value[0];

  if (
    value.length >= 2 &&
    (quote === '"' || quote === "'") &&
    value.endsWith(quote)
  ) {
    return value.slice(1, -1);
  }

  return value;
};

export const parseCompatibilityEnvironmentVariables = (
  rawVariables: string | null | undefined
): Record<string, string> => {
  if (!rawVariables) {
    return {};
  }

  const environmentVariables: Record<string, string> = {};

  for (const rawLine of rawVariables.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const name = line.slice(0, equalsIndex).trim();
    const value = unquoteEnvValue(line.slice(equalsIndex + 1).trim());

    if (!envVariableNameRegex.test(name)) {
      continue;
    }

    environmentVariables[name] = value;
  }

  return environmentVariables;
};
