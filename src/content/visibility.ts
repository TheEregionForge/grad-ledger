export function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) > 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    element.getAttribute("aria-hidden") !== "true"
  );
}

export function isLowValueElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  const lowValueTags = new Set(["script", "style", "noscript", "svg", "canvas", "footer", "aside"]);

  if (lowValueTags.has(tagName)) {
    return true;
  }

  const combined = `${element.id} ${element.className} ${element.getAttribute("aria-label") ?? ""}`.toLowerCase();
  return /(cookie|consent|social|share|newsletter|subscribe|breadcrumb__separator)/.test(combined);
}
