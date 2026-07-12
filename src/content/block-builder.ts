import type { ContentBlock, HeadingBlock, PageLink, TextBlock } from "../shared/models";
import { normalizeWhitespace, stableBlockKey } from "../shared/normalization";
import { buildSelectorFingerprint } from "./selector-fingerprint";
import { isLowValueElement, isVisible } from "./visibility";

const contentSelector = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "dt",
  "dd",
  "address",
  "section",
  "article",
  "[class*='card']",
  "[class*='profile']",
  "[class*='contact']"
].join(",");

function scoreContainer(element: HTMLElement): number {
  const text = normalizeWhitespace(element.innerText ?? "");
  const paragraphCount = element.querySelectorAll("p,li,dd").length;
  const linkText = Array.from(element.querySelectorAll("a"))
    .map((link) => link.textContent ?? "")
    .join(" ");
  const linkDensity = text.length ? normalizeWhitespace(linkText).length / text.length : 0;
  const rect = element.getBoundingClientRect();
  const semanticBonus = /^(main|article)$/i.test(element.tagName) || element.getAttribute("role") === "main" ? 300 : 0;
  const h1Bonus = element.querySelector("h1") ? 150 : 0;
  const centralBonus = rect.left >= 0 && rect.top < window.innerHeight * 1.2 ? 75 : 0;
  const formPenalty = element.querySelectorAll("input,select,textarea,button").length * 20;

  return text.length + paragraphCount * 45 + semanticBonus + h1Bonus + centralBonus - linkDensity * 500 - formPenalty;
}

function choosePrimaryContainer(): HTMLElement {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("main, article, [role='main'], body"));
  return candidates.filter(isVisible).sort((a, b) => scoreContainer(b) - scoreContainer(a))[0] ?? document.body;
}

function collectHeadingPath(headings: HeadingBlock[], level: number, elementTop: number): string[] {
  const stack: HeadingBlock[] = [];
  const precedingHeadings = headings.filter((heading) => heading.top <= elementTop);

  for (const heading of precedingHeadings) {
    if (heading.level >= level) {
      continue;
    }

    while (stack.length && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    stack.push(heading);
  }

  return stack.map((heading) => heading.text).slice(-6);
}

function elementAttributes(element: Element): Record<string, string> {
  const allowed = ["itemprop", "aria-label", "role", "data-email", "data-mail"];
  const entries = allowed
    .map((name) => [name, element.getAttribute(name)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));

  return Object.fromEntries(entries);
}

function linkDensity(element: HTMLElement, textLength: number): number {
  if (!textLength) {
    return 0;
  }

  const linkText = Array.from(element.querySelectorAll("a"))
    .map((link) => link.textContent ?? "")
    .join(" ");
  return normalizeWhitespace(linkText).length / textLength;
}

export function collectHeadings(root: ParentNode = document): HeadingBlock[] {
  const headings: HeadingBlock[] = [];
  const stack: HeadingBlock[] = [];

  Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")).forEach((element, index) => {
    if (!isVisible(element) || isLowValueElement(element)) {
      return;
    }

    const text = normalizeWhitespace(element.textContent ?? "");
    if (!text) {
      return;
    }

    const level = Number(element.tagName.slice(1));
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    const heading: HeadingBlock = {
      id: `heading-${index + 1}`,
      text,
      level,
      headingPath: [...stack.map((item) => item.text), text],
      top: element.getBoundingClientRect().top + window.scrollY,
      selectorFingerprint: buildSelectorFingerprint(element)
    };

    headings.push(heading);
    stack.push(heading);
  });

  return headings;
}

export function collectContentBlocks(): ContentBlock[] {
  const primary = choosePrimaryContainer();
  const headings = collectHeadings(document);
  const seen = new Set<string>();
  const blocks: ContentBlock[] = [];

  Array.from(primary.querySelectorAll<HTMLElement>(contentSelector)).forEach((element) => {
    if (!isVisible(element) || isLowValueElement(element)) {
      return;
    }

    const text = normalizeWhitespace(element.innerText || element.textContent || "");
    if (text.length < 3 || text.length > 2500) {
      return;
    }

    const key = stableBlockKey(text);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const elementTop = rect.top + window.scrollY;
    const level = /^h[1-6]$/i.test(element.tagName) ? Number(element.tagName.slice(1)) : 7;
    const headingPath = collectHeadingPath(headings, level, elementTop);

    blocks.push({
      id: `block-${blocks.length + 1}`,
      text,
      tagName: element.tagName.toLowerCase(),
      headingPath,
      nearbyHeading: headingPath[headingPath.length - 1],
      selectorFingerprint: buildSelectorFingerprint(element),
      top: elementTop,
      fontSize: Number.parseFloat(style.fontSize) || 0,
      fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
      linkDensity: linkDensity(element, text.length),
      textLength: text.length,
      visible: true,
      attributes: elementAttributes(element)
    });
  });

  return blocks.slice(0, 500);
}

export function collectLinks(): PageLink[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .filter((link) => isVisible(link) && !isLowValueElement(link))
    .map((link) => ({
      text: normalizeWhitespace(link.textContent ?? ""),
      href: link.href,
      isMailto: link.href.toLowerCase().startsWith("mailto:"),
      selectorFingerprint: buildSelectorFingerprint(link)
    }))
    .filter((link) => link.href && (link.text || link.isMailto))
    .slice(0, 500);
}

export function collectBreadcrumbs(): TextBlock[] {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('[aria-label*="breadcrumb" i], nav.breadcrumb, .breadcrumb, [class*="breadcrumb"]')
  );

  return candidates
    .filter((element) => isVisible(element) && !isLowValueElement(element))
    .flatMap((element, navIndex) =>
      Array.from(element.querySelectorAll<HTMLElement>("a,span,li"))
        .map((item, itemIndex) => ({
          id: `breadcrumb-${navIndex + 1}-${itemIndex + 1}`,
          text: normalizeWhitespace(item.textContent ?? ""),
          selectorFingerprint: buildSelectorFingerprint(item)
        }))
        .filter((item) => item.text.length > 0)
    )
    .slice(0, 30);
}
