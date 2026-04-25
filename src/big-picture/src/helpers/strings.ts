export const toSlug = (name: string) => {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^a-z0-9\s-]/g, "")
    .trim()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/-+/g, "-");
};

export const normalizeRequirementsHtml = (html: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const list = doc.querySelector("ul");
  if (!list) return html;

  const items = list.querySelectorAll("li");

  if (items.length === 1) {
    const singleItem = items[0];
    const parts = singleItem.innerHTML
      .split(/<br\s*\/?>/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length > 1) {
      list.innerHTML = parts.map((part) => `<li>${part}</li>`).join("");
    }
  }

  const firstLi = list.querySelector("li");
  if (firstLi && !firstLi.querySelector("strong")) {
    firstLi.remove();
  }

  return list.outerHTML;
};
