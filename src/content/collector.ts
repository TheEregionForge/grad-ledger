import type { PageSnapshot } from "../shared/models";
import { isExtensionMessage, type MessageResponse } from "../shared/messages";
import { collectContentBlocks, collectBreadcrumbs, collectHeadings, collectLinks } from "./block-builder";
import { collectEmails } from "./emails";
import { collectJsonLd } from "./jsonld";
import { collectCanonicalUrl, collectMetadata } from "./metadata";
import { collectTables } from "./tables";

function collectPageSnapshot(): PageSnapshot {
  const jsonLd = collectJsonLd();
  const url = window.location.href;

  return {
    url,
    canonicalUrl: collectCanonicalUrl(),
    title: document.title,
    language: document.documentElement.lang || undefined,
    domain: window.location.hostname,
    metadata: collectMetadata(),
    jsonLd,
    breadcrumbs: collectBreadcrumbs(),
    headings: collectHeadings(),
    contentBlocks: collectContentBlocks(),
    links: collectLinks(),
    emails: collectEmails(jsonLd),
    tables: collectTables()
  };
}

const globalState = globalThis as typeof globalThis & { __gradPathCollectorInstalled?: boolean };

if (!globalState.__gradPathCollectorInstalled) {
  globalState.__gradPathCollectorInstalled = true;

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (response: MessageResponse) => void) => {
    if (!isExtensionMessage(message) || message.type !== "COLLECT_PAGE_SNAPSHOT") {
      return false;
    }

    try {
      sendResponse({ ok: true, data: collectPageSnapshot() });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Page snapshot collection failed."
      });
    }

    return true;
  });
}
