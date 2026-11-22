import { parseLaunchOptions } from "../events/helpers/parse-launch-options.js";
import path from "node:path";

const commandPlaceholder = "%command%";
const envVariableNameRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ResolveLaunchCommandOptions {
  baseCommand: string;
  baseArgs?: string[];
  launchOptions?: string | null;
  wrapperCommand?: string | null;
  wrapperCommands?: string[];
}

export interface ResolvedLaunchCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const unquoteEnvValue = (value: string) => {
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

const extractLeadingEnvAssignments = (tokens: string[]) => {
  const env: Record<string, string> = {};
  let tokenIndex = 0;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex];
    const separatorIndex = token.indexOf("=");

    if (separatorIndex <= 0) {
      break;
    }

    const name = token.slice(0, separatorIndex);
    if (!envVariableNameRegex.test(name)) {
      break;
    }

    env[name] = unquoteEnvValue(token.slice(separatorIndex + 1));
    tokenIndex += 1;
  }

  return {
    env,
    remainingTokens: tokens.slice(tokenIndex),
  };
};

export const resolveLaunchCommand = ({
  baseCommand,
  baseArgs = [],
  launchOptions,
  wrapperCommand,
  wrapperCommands,
}: ResolveLaunchCommandOptions): ResolvedLaunchCommand => {
  let wrappers: string[];

  if (wrapperCommands && wrapperCommands.length > 0) {
    wrappers = wrapperCommands;
  } else if (wrapperCommand) {
    wrappers = [wrapperCommand];
  } else {
    wrappers = [];
  }

  wrappers = wrappers.filter(Boolean);

  const applyWrappers = (
    resolved: ResolvedLaunchCommand
  ): ResolvedLaunchCommand => {
    if (wrappers.length === 0) {
      return resolved;
    }

    return wrappers.reduceRight<ResolvedLaunchCommand>((current, wrapper) => {
      if (
        path.basename(current.command).toLowerCase() === wrapper.toLowerCase()
      ) {
        return current;
      }

      return {
        command: wrapper,
        args: [current.command, ...current.args],
        env: current.env,
      };
    }, resolved);
  };

  const launchOptionTokens = parseLaunchOptions(launchOptions);

  if (launchOptionTokens.length === 0) {
    const resolved = {
      command: baseCommand,
      args: [...baseArgs],
      env: {},
    };

    return applyWrappers(resolved);
  }

  if (!launchOptionTokens.includes(commandPlaceholder)) {
    const resolved = {
      command: baseCommand,
      args: [...baseArgs, ...launchOptionTokens],
      env: {},
    };

    return applyWrappers(resolved);
  }

  const expandedTokens = launchOptionTokens.flatMap((token) =>
    token === commandPlaceholder ? [baseCommand, ...baseArgs] : [token]
  );

  const { env, remainingTokens } = extractLeadingEnvAssignments(expandedTokens);

  if (remainingTokens.length === 0) {
    const resolved = {
      command: baseCommand,
      args: [...baseArgs],
      env,
    };

    return applyWrappers(resolved);
  }

  const resolved = {
    command: remainingTokens[0],
    args: remainingTokens.slice(1),
    env,
  };

  return applyWrappers(resolved);
};
