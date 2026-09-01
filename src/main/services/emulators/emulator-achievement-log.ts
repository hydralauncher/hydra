import type { EmulatorSessionSystem } from "./emulator-session-tracker";

export interface EmulatorAchievementLogFormat {
  pattern: RegExp;
  titleFirst: boolean;
}

const LOG_FORMATS: Partial<
  Record<EmulatorSessionSystem, EmulatorAchievementLogFormat>
> = {
  ps1: {
    pattern: /Achievement (\d+) \((.*?)\) for game \d+ unlocked/,
    titleFirst: false,
  },
  ps2: {
    pattern: /Achievements: Achievement (.*?) \((\d+)\) for game \d+ unlocked/,
    titleFirst: true,
  },
  psp: {
    pattern: /Achievement unlocked: '(.*)' \((\d+)\)/,
    titleFirst: true,
  },
  dolphin: {
    pattern: /Awarding achievement (\d+): (.+)$/,
    titleFirst: false,
  },
};

export const getEmulatorAchievementLogFormat = (
  system: EmulatorSessionSystem
) => LOG_FORMATS[system] ?? null;

export const parseEmulatorAchievementLogLine = (
  system: EmulatorSessionSystem,
  line: string
) => {
  const format = getEmulatorAchievementLogFormat(system);
  if (!format) return null;

  const match = format.pattern.exec(line);
  if (!match) return null;

  return {
    id: format.titleFirst ? match[2] : match[1],
    title: format.titleFirst ? match[1] : match[2],
  };
};
