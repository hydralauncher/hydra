export interface RequirementRow {
  label: string | null;
  value: string;
}

const parsePlainTextRows = (value: string): RequirementRow[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map<RequirementRow | null>((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) return null;

      const label = line.slice(0, separatorIndex).trim();
      const requirement = line.slice(separatorIndex + 1).trim();

      return label && requirement ? { label, value: requirement } : null;
    })
    .filter((row): row is RequirementRow => Boolean(row));

export const parseRequirementRows = (html: string): RequirementRow[] => {
  if (!html.includes("<")) return parsePlainTextRows(html);

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const list = doc.querySelector("ul");
  if (!list) return [];

  const initialItems = list.querySelectorAll("li");
  if (initialItems.length === 1) {
    const parts = initialItems[0].innerHTML
      .split(/<br\s*\/?>/i)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length > 1) {
      list.innerHTML = parts.map((part) => `<li>${part}</li>`).join("");
    }
  }

  const items = Array.from(list.querySelectorAll("li"));

  return items
    .map((item) => {
      const strong = item.querySelector("strong");
      const itemText = item.textContent?.replace(/\s+/g, " ").trim() ?? "";

      if (strong) {
        const label = strong.textContent?.replace(/:\s*$/, "").trim() ?? "";
        const value = itemText
          .replace(strong.textContent?.trim() ?? "", "")
          .replace(/^:\s*/, "")
          .trim();

        return label && value ? { label, value } : null;
      }

      return (
        parsePlainTextRows(itemText)[0] ??
        (itemText ? { label: null, value: itemText } : null)
      );
    })
    .filter((row): row is RequirementRow => Boolean(row));
};
