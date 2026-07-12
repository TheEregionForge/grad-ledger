import type { EmailCandidate, JsonLdObject } from "../shared/models";
import { normalizeWhitespace } from "../shared/normalization";
import { buildSelectorFingerprint } from "./selector-fingerprint";
import { isLowValueElement, isVisible } from "./visibility";

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function deobfuscateEmailText(value: string): string {
  return value
    .replace(/\s*(\[|\(|\{)\s*(at|ät)\s*(\]|\)|\})\s*/gi, "@")
    .replace(/\s+(at|AT)\s+/g, "@")
    .replace(/\s*(\[|\(|\{)\s*(dot|period)\s*(\]|\)|\})\s*/gi, ".")
    .replace(/\s+(dot|DOT|period)\s+/g, ".")
    .replace(/\s+/g, " ");
}

function isPlaceholderEmail(value: string, context = ""): boolean {
  const normalized = `${value} ${context}`.toLowerCase();
  return (
    /\b(first|last|family|given|director|your|user)[_\s.-]*(name|surname)\b/.test(normalized) ||
    /\b(firstname|lastname|familyname|yourname|username)\b/.test(normalized) ||
    /\b(example|domain|email|name)@(?:example|domain)\./.test(normalized) ||
    /\[(?:director|first|last|family|name|surname)[^\]]*\]/.test(normalized)
  );
}

function pushUnique(candidates: EmailCandidate[], candidate: EmailCandidate): void {
  const normalized = candidate.value.toLowerCase();
  if (isPlaceholderEmail(candidate.value, candidate.textContext)) {
    return;
  }

  if (!candidates.some((item) => item.value.toLowerCase() === normalized && item.source === candidate.source)) {
    candidates.push(candidate);
  }
}

export function collectEmails(jsonLd: JsonLdObject[]): EmailCandidate[] {
  const candidates: EmailCandidate[] = [];

  Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]')).forEach((link) => {
    const raw = link.href.replace(/^mailto:/i, "").split("?")[0];
    const matches = raw.match(emailPattern) ?? [];
    for (const match of matches) {
      pushUnique(candidates, {
        value: match,
        source: "mailto",
        textContext: normalizeWhitespace(link.closest("section,article,div,p,li,address")?.textContent ?? link.textContent ?? ""),
        selectorFingerprint: buildSelectorFingerprint(link)
      });
    }
  });

  Array.from(document.querySelectorAll<HTMLElement>("[data-email],[data-mail]"))
    .filter((element) => isVisible(element) && !isLowValueElement(element))
    .forEach((element) => {
      const raw = element.getAttribute("data-email") || element.getAttribute("data-mail") || "";
      for (const match of raw.matchAll(emailPattern)) {
        pushUnique(candidates, {
          value: match[0],
          source: "attribute",
          textContext: normalizeWhitespace(element.textContent ?? ""),
          selectorFingerprint: buildSelectorFingerprint(element)
        });
      }
    });

  const visibleText = deobfuscateEmailText(document.body.innerText || "");
  for (const match of visibleText.matchAll(emailPattern)) {
    pushUnique(candidates, {
      value: match[0],
      source: "visible-text",
      textContext: visibleText.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80)
    });
  }

  jsonLd.forEach((object) => {
    const email = object.email;
    if (typeof email === "string") {
      for (const match of email.matchAll(emailPattern)) {
        pushUnique(candidates, { value: match[0], source: "jsonld" });
      }
    }
  });

  return candidates.slice(0, 50);
}
