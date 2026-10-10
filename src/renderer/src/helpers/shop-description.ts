import DOMPurify from "dompurify";
import { marked } from "marked";

export const formatShopDescription = (description: string, shop: string) => {
  const html =
    shop === "epic" ? marked.parse(description, { async: false }) : description;
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["video", "source"],
    ADD_ATTR: ["controls", "poster", "loading"],
  });
};
