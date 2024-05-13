export const isMultiplayerRepack = (title: string) => {
  const toLower = title.toLowerCase();

  return (
    toLower.includes("multiplayer") ||
    toLower.includes("onlinefix") ||
    toLower.includes("online fix")
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
