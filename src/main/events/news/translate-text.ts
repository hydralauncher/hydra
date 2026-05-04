import { registerEvent } from "../register-event";
import { logger } from "@main/services";

const translateText = async (
  _event: Electron.IpcMainInvokeEvent,
  text: string,
  targetLang: string
) => {
  try {
    if (!text?.trim()) {
      return { translatedText: text, detectedLanguage: null };
    }

    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "auto");
    url.searchParams.set("tl", targetLang);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", text);

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      return { translatedText: text, detectedLanguage: null };
    }

    const data = await response.json();

    const translatedText = data[0]
      .filter((segment: unknown[]) => segment[0])
      .map((segment: [string]) => segment[0])
      .join("");

    const detectedLanguage: string | null = data[2] || null;

    return { translatedText, detectedLanguage };
  } catch (error) {
    logger.error("Failed to translate text:", error);
    return { translatedText: text, detectedLanguage: null };
  }
};

registerEvent("translateText", translateText);
