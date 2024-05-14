import { toCapitalize } from "./string";

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

  const languageCode = languageCodes[repacker.toLowerCase()] || "en";

  const displayNames = new Intl.DisplayNames([userLanguage], {
    type: "language",
  });

  const language = displayNames.of(languageCode);

  return language ? toCapitalize(language) : "English";
};
