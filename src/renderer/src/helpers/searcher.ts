export const isMultiplayerRepack = (title: string) => {
  const toLower = title.toLowerCase();

  return toLower.includes("multiplayer") || toLower.includes("onlinefix") || toLower.includes("online fix")
}

export const supportMultiLanguage = (title: string) => {
  const multiFollowedByDigitsRegex = /multi\d+/;

  return multiFollowedByDigitsRegex.test(title.toLowerCase());
}

export const getRepackLanguageBasedOnRepacker = (repacker: string) => {
  const repackMap = {
    'xatab': 'ru',
  }

  return repackMap[repacker.toLowerCase()] || 'en';
}
