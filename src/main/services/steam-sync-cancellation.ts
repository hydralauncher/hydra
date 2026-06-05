export const SteamSyncCancellation = {
  achievements: false,
  library: false,

  request(type: "achievements" | "library") {
    this[type] = true;
  },

  reset(type: "achievements" | "library") {
    this[type] = false;
  },

  isRequested(type: "achievements" | "library") {
    return this[type];
  },
};
