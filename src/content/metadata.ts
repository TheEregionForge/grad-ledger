import type { PageMetadata } from "../shared/models";

function metaContent(selector: string): string | undefined {
  return document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || undefined;
}

export function collectMetadata(): PageMetadata {
  const favicon =
    document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href ||
    document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]')?.href ||
    undefined;

  return {
    description: metaContent('meta[name="description"]'),
    author: metaContent('meta[name="author"]'),
    ogTitle: metaContent('meta[property="og:title"]'),
    ogDescription: metaContent('meta[property="og:description"]'),
    ogSiteName: metaContent('meta[property="og:site_name"]'),
    twitterTitle: metaContent('meta[name="twitter:title"]'),
    faviconUrl: favicon
  };
}

export function collectCanonicalUrl(): string | undefined {
  return document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || undefined;
}
