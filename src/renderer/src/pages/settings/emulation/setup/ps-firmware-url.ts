const PS_FIRMWARE_LOCALES: Record<string, string> = {
  "pt-BR": "pt-br",
  "pt-PT": "pt-pt",
  es: "es-es",
  ru: "ru-ru",
};

export const firmwarePageUrl = (language: string): string => {
  const segment = PS_FIRMWARE_LOCALES[language] ?? "en-us";
  return `https://www.playstation.com/${segment}/support/hardware/ps3/system-software/`;
};
