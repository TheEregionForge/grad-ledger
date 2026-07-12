import type { SelectorFingerprint } from "../shared/models";
import { normalizeWhitespace } from "../shared/normalization";

const generatedClassPattern = /(^css-|^sc-|[a-f0-9]{6,}|component-\d+|module__)/i;

function semanticClasses(element: Element): string[] {
  return Array.from(element.classList)
    .filter((token) => !generatedClassPattern.test(token))
    .filter((token) => /(profile|person|faculty|bio|contact|research|department|title|email|main|content|card)/i.test(token))
    .slice(0, 5);
}

export function findNearestHeading(element: Element): string | undefined {
  let previous = element.previousElementSibling;

  while (previous) {
    if (/^h[1-6]$/i.test(previous.tagName)) {
      return normalizeWhitespace(previous.textContent ?? "");
    }

    previous = previous.previousElementSibling;
  }

  const parent = element.parentElement;
  const parentHeading = parent?.querySelector("h1,h2,h3,h4,h5,h6");
  return parentHeading ? normalizeWhitespace(parentHeading.textContent ?? "") : undefined;
}

export function buildSelectorFingerprint(element: Element): SelectorFingerprint {
  const siblings = element.parentElement
    ? Array.from(element.parentElement.children).filter((sibling) => sibling.tagName === element.tagName)
    : [element];

  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    role: element.getAttribute("role") || undefined,
    itemprop: element.getAttribute("itemprop") || undefined,
    ariaLabel: element.getAttribute("aria-label") || undefined,
    semanticClasses: semanticClasses(element),
    nearestHeading: findNearestHeading(element),
    relativeIndex: Math.max(0, siblings.indexOf(element))
  };
}
