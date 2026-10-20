import type { EmulatorSessionSystem } from "./emulator-session-tracker";

interface EmulatorAchievementLogFormat {
  pattern: RegExp;
  titleFirst: boolean;
}

const RCHEEVOS_AWARD_FORMAT: EmulatorAchievementLogFormat = {
  pattern: /Awarding achievement (\d+): (.+)$/,
  titleFirst: false,
};

const LOG_FORMATS: Record<
  EmulatorSessionSystem,
  EmulatorAchievementLogFormat | null
> = {
  ps1: {
    pattern: /Achievement (\d+) \((.*?)\) for game \d+ unlocked/,
    titleFirst: false,
  },
  ps2: {
    pattern: /Achievements: Achievement (.*?) \((\d+)\) for game \d+ unlocked/,
    titleFirst: true,
  },
  ps3: null,
  psp: {
    pattern: /Achievement unlocked: '(.*)' \((\d+)\)/,
    titleFirst: true,
  },
  dolphin: RCHEEVOS_AWARD_FORMAT,
  nes: RCHEEVOS_AWARD_FORMAT,
  snes: RCHEEVOS_AWARD_FORMAT,
  n64: RCHEEVOS_AWARD_FORMAT,
  gb: RCHEEVOS_AWARD_FORMAT,
  gbc: RCHEEVOS_AWARD_FORMAT,
  gba: RCHEEVOS_AWARD_FORMAT,
};

export const getEmulatorAchievementLogFormat = (
  system: EmulatorSessionSystem
) => LOG_FORMATS[system] ?? null;

export const parseEmulatorAchievementLogLine = (
  line: string,
  format: EmulatorAchievementLogFormat
) => {
  const match = format.pattern.exec(line);
  if (!match) return null;

  return {
    id: format.titleFirst ? match[2] : match[1],
    title: (format.titleFirst ? match[1] : match[2]).trim(),
  };
};
