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

// const languageCode = 'en';
// const displayNames = new Intl.DisplayNames([languageCode], { type: 'language' });
// const englishLanguage = displayNames.of(languageCode);

// console.log(englishLanguage); // Output: "English"

export const getRepackLanguageBasedOnRepacker = (repacker: string) => {
  const languageCodes = {
    xatab: "ru",
  };

  const languageCode = languageCodes[repacker.toLowerCase()] || "en";

  const displayNames = new Intl.DisplayNames([languageCode], {
    type: "language",
  });

  return displayNames.of(languageCode);
};
