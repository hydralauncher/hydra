export const isMultiplayerRepack = (title: string, repacker: string) => {
  const titleToLower = title.toLowerCase();
  const repackerToLower = repacker.toLowerCase();

  return (
    titleToLower.includes("multiplayer") ||
    titleToLower.includes("onlinefix") ||
    titleToLower.includes("online fix") ||
    repackerToLower.includes("onlinefix") ||
    repackerToLower.includes("online fix")
  );
};

export const supportMultiLanguage = (title: string) => {
  const multiFollowedByDigitsRegex = /multi\d+/;

  return multiFollowedByDigitsRegex.test(title.toLowerCase());
};

export const getRepackLanguageBasedOnRepacker = (
  repacker: string,
  userLanguage: string
) => {
  const languageCodes = {
    xatab: "ru",
  };

  const languageCode = languageCodes[repacker.toLowerCase()] || userLanguage;

  const displayNames = new Intl.DisplayNames([userLanguage.slice(0, 2)], {
    type: "language",
  });

  return displayNames.of(languageCode);
};
