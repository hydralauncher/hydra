import { registerEvent } from "../register-event";
import { logger } from "@main/services";

function stripTags(html: string, tags: string[]): string {
  let result = html;
  for (const tag of tags) {
    if (tag.startsWith(".") || tag.startsWith("[")) {
      continue;
    }
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    result = result.replace(regex, "");
  }
  return result;
}

function extractBySelector(html: string, selectors: string[]): string | null {
  for (const selector of selectors) {
    if (
      selector.includes(".") ||
      selector.includes("[") ||
      selector.includes(" ")
    ) {
      continue;
    }

    const regex = new RegExp(
      `<${selector}[^>]*>([\\s\\S]*?)<\\/${selector}>`,
      "i"
    );
    const match = html.match(regex);
    if (match && match[1] && match[1].trim().length > 200) {
      return match[1];
    }
  }
  return null;
}

const scrapeArticle = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return null;
    }

    const html = await response.text();

    const cleaned = stripTags(html, [
      "script",
      "style",
      "noscript",
      "nav",
      "footer",
      "aside",
    ]);

    const content = extractBySelector(cleaned, ["article", "main"]);

    if (content && content.trim().length > 200) {
      return { content: content.trim() };
    }

    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      let body = bodyMatch[1];
      body = body.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
      body = body.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");

      if (body.trim().length > 200) {
        return { content: body.trim() };
      }
    }

    return null;
  } catch (error) {
    logger.error("Failed to scrape article:", error);
    return null;
  }
};

registerEvent("scrapeArticle", scrapeArticle);
