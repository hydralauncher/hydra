import { parseLaunchOptions } from "@main/events/helpers/parse-launch-options";
import path from "node:path";

const commandPlaceholder = "%command%";
const envVariableNameRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ResolveLaunchCommandOptions {
  baseCommand: string;
  baseArgs?: string[];
  launchOptions?: string | null;
  wrapperCommand?: string | null;
}

export interface ResolvedLaunchCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

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

    env[name] = token.slice(separatorIndex + 1);
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
}: ResolveLaunchCommandOptions): ResolvedLaunchCommand => {
  const launchOptionTokens = parseLaunchOptions(launchOptions);

  if (launchOptionTokens.length === 0) {
    const resolved = {
      command: baseCommand,
      args: [...baseArgs],
      env: {},
    };

    if (!wrapperCommand) {
      return resolved;
    }

    return {
      command: wrapperCommand,
      args: [resolved.command, ...resolved.args],
      env: resolved.env,
    };
  }

  if (!launchOptionTokens.includes(commandPlaceholder)) {
    const resolved = {
      command: baseCommand,
      args: [...baseArgs, ...launchOptionTokens],
      env: {},
    };

    if (!wrapperCommand) {
      return resolved;
    }

    return {
      command: wrapperCommand,
      args: [resolved.command, ...resolved.args],
      env: resolved.env,
    };
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

    if (!wrapperCommand) {
      return resolved;
    }

    return {
      command: wrapperCommand,
      args: [resolved.command, ...resolved.args],
      env: resolved.env,
    };
  }

  const resolved = {
    command: remainingTokens[0],
    args: remainingTokens.slice(1),
    env,
  };

  if (!wrapperCommand) {
    return resolved;
  }

  if (
    path.basename(resolved.command).toLowerCase() ===
    wrapperCommand.toLowerCase()
  ) {
    return resolved;
  }

  return {
    command: wrapperCommand,
    args: [resolved.command, ...resolved.args],
    env: resolved.env,
  };
};
