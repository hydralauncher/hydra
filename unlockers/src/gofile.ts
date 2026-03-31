module.exports = {
  id: "gofile",
  downloader: "Gofile",

  /**
   * @param {{ url?: unknown }} input
   */
  async unlock(input) {
    const sourceUrl = String(input?.url ?? "").trim();
    if (!sourceUrl) {
      throw new Error("Missing source URL");
    }

    throw new Error(
      "GoFile OTA unlocker is disabled. The built-in GoFile resolver handles token generation directly from gofile.io."
    );
  },
};
