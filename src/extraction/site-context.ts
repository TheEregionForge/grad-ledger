import type { ExtractionResult, PageLink, ResolvedField } from "../shared/models";
import { normalizeForComparison } from "../shared/normalization";

export interface SuggestedRelatedPage {
  url: string;
  text: string;
  score: number;
  reason: string;
}

export interface SiteProfile {
  siteKey: string;
  rootUrl: string;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
  sourceUrls: string[];
  fields: Record<string, ResolvedField<unknown>>;
  suggestedPages: SuggestedRelatedPage[];
  lastResult: ExtractionResult;
}

export interface CaptureSessionEvent {
  url: string;
  title: string;
  capturedAt: string;
  status: "captured" | "ignored" | "failed";
  reason?: string;
}

export interface CaptureSession {
  id: string;
  status: "active" | "stopped";
  siteKey: string;
  rootUrl: string;
  startedAt: string;
  updatedAt: string;
  stoppedAt?: string;
  pageCount: number;
  sourceUrls: string[];
  fields: Record<string, ResolvedField<unknown>>;
  suggestedPages: SuggestedRelatedPage[];
  events: CaptureSessionEvent[];
}

const strongNextPagePatterns: Array<{ pattern: RegExp; score: number; reason: string }> = [
  { pattern: /\b(home|about|profile|people|team|members|principal investigator|pi)\b/i, score: 90, reason: "profile/about page" },
  { pattern: /\b(contact|email)\b/i, score: 84, reason: "contact page" },
  { pattern: /\b(research|projects|publications|statement)\b/i, score: 80, reason: "research details" },
  { pattern: /\b(open positions|positions|how to apply|apply|applying|how to join|join|join us|prospective|prospectives|prospective students|students|interns|postdocs|recruiting|vacanc|opening)\b/i, score: 88, reason: "open-position page" },
  { pattern: /\b(cv|curriculum vitae|resume)\b/i, score: 72, reason: "CV page" }
];

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function originUrl(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

export function deriveSiteKey(urlValue: string): { siteKey: string; rootUrl: string } {
  const url = new URL(urlValue);
  const origin = originUrl(url);
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.hostname === "sites.google.com" && parts[0] === "view" && parts[1]) {
    const rootUrl = `${origin}/view/${parts[1]}`;
    return { siteKey: rootUrl, rootUrl };
  }

  if (url.hostname.endsWith(".github.io")) {
    return { siteKey: origin, rootUrl: origin };
  }

  const personalPath = parts.find((part) => part.startsWith("~"));
  if (personalPath) {
    const rootUrl = `${origin}/${personalPath}`;
    return { siteKey: rootUrl, rootUrl };
  }

  const profileLikeIndex = parts.findIndex((part) => /^(people|person|profile|faculty|staff|users?)$/i.test(part));
  if (profileLikeIndex >= 0 && parts[profileLikeIndex + 1]) {
    const rootUrl = `${origin}/${parts.slice(0, profileLikeIndex + 2).join("/")}`;
    return { siteKey: rootUrl, rootUrl };
  }

  return { siteKey: origin, rootUrl: origin };
}

function comparableFieldValue(field: ResolvedField<unknown> | undefined): string {
  if (!field?.value) {
    return "";
  }

  return Array.isArray(field.value)
    ? field.value.map((item) => normalizeForComparison(String(item))).join(";")
    : normalizeForComparison(String(field.value));
}

export function mergeResolvedFields(
  previous: Record<string, ResolvedField<unknown>>,
  next: Record<string, ResolvedField<unknown>>
): Record<string, ResolvedField<unknown>> {
  const merged: Record<string, ResolvedField<unknown>> = { ...previous };

  for (const [key, nextField] of Object.entries(next)) {
    const previousField = merged[key];

    if (!previousField || previousField.status === "missing") {
      merged[key] = nextField;
      continue;
    }

    if (nextField.status === "missing") {
      continue;
    }

    if (
      key === "acceptingStudents" &&
      previousField.value !== nextField.value &&
      (previousField.value === "unknown" ||
        nextField.value === "not_accepting" ||
        nextField.confidence > previousField.confidence + 4)
    ) {
      merged[key] = {
        ...nextField,
        alternatives: [previousField.evidence[0], ...nextField.alternatives].filter(Boolean).slice(0, 8)
      };
      continue;
    }

    if (
      ["researchInterests", "contactInstructions"].includes(key) &&
      Array.isArray(previousField.value) &&
      Array.isArray(nextField.value)
    ) {
      const values = unique([...previousField.value, ...nextField.value].map(String)).slice(0, 8);
      merged[key] = {
        ...previousField,
        value: values,
        confidence: Math.max(previousField.confidence, nextField.confidence),
        evidence: [...previousField.evidence, ...nextField.evidence].slice(0, 8),
        alternatives: [...previousField.alternatives, ...nextField.alternatives].slice(0, 8)
      };
      continue;
    }

    const sameValue = comparableFieldValue(previousField) === comparableFieldValue(nextField);
    if (sameValue) {
      merged[key] = {
        ...previousField,
        confidence: Math.max(previousField.confidence, nextField.confidence),
        evidence: [...previousField.evidence, ...nextField.evidence].slice(0, 8),
        alternatives: [...previousField.alternatives, ...nextField.alternatives].slice(0, 8)
      };
      continue;
    }

    if (nextField.confidence > previousField.confidence + 8) {
      merged[key] = {
        ...nextField,
        alternatives: [previousField.evidence[0], ...nextField.alternatives].filter(Boolean).slice(0, 8)
      };
    }
  }

  return merged;
}

function linkIsSameSite(link: PageLink, rootUrl: string): boolean {
  try {
    const linkUrl = new URL(link.href);
    return linkUrl.href.startsWith(rootUrl);
  } catch {
    return false;
  }
}

export function rankSuggestedRelatedPages(result: ExtractionResult, rootUrl: string): SuggestedRelatedPage[] {
  const currentUrl = result.snapshot.url.replace(/#.*$/, "");
  const suggestions = new Map<string, SuggestedRelatedPage>();

  for (const link of result.snapshot.links) {
    if (!link.href || link.isMailto || !linkIsSameSite(link, rootUrl)) {
      continue;
    }

    const cleanUrl = link.href.replace(/#.*$/, "");
    if (cleanUrl === currentUrl) {
      continue;
    }

    const searchable = `${link.text} ${cleanUrl}`;
    const match = strongNextPagePatterns.find((item) => item.pattern.test(searchable));
    if (!match) {
      continue;
    }

    const existing = suggestions.get(cleanUrl);
    const score = match.score + (link.text ? 4 : 0);
    if (!existing || score > existing.score) {
      suggestions.set(cleanUrl, {
        url: cleanUrl,
        text: link.text || cleanUrl,
        score,
        reason: match.reason
      });
    }
  }

  return Array.from(suggestions.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export function mergeSiteProfile(previous: SiteProfile | undefined, result: ExtractionResult): SiteProfile {
  const { siteKey, rootUrl } = deriveSiteKey(result.snapshot.url);
  const now = new Date().toISOString();
  const sourceUrls = unique([...(previous?.sourceUrls ?? []), result.snapshot.url]);
  const suggestedPages = uniqueSuggestions([
    ...(previous?.suggestedPages ?? []),
    ...rankSuggestedRelatedPages(result, rootUrl)
  ]);

  return {
    siteKey,
    rootUrl,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    pageCount: sourceUrls.length,
    sourceUrls,
    fields: mergeResolvedFields(previous?.fields ?? {}, result.fields),
    suggestedPages,
    lastResult: result
  };
}

export function isSameCaptureSite(session: CaptureSession, url: string): boolean {
  try {
    return deriveSiteKey(url).siteKey === session.siteKey;
  } catch {
    return false;
  }
}

export function createCaptureSession(result: ExtractionResult): CaptureSession {
  const { siteKey, rootUrl } = deriveSiteKey(result.snapshot.url);
  const now = new Date().toISOString();

  return {
    id: `capture_${Date.now().toString(36)}`,
    status: "active",
    siteKey,
    rootUrl,
    startedAt: now,
    updatedAt: now,
    pageCount: 0,
    sourceUrls: [],
    fields: {},
    suggestedPages: [],
    events: []
  };
}

export function mergeResultIntoCaptureSession(session: CaptureSession, result: ExtractionResult): CaptureSession {
  const now = new Date().toISOString();
  const sourceUrls = unique([...session.sourceUrls, result.snapshot.url]);
  const suggestedPages = uniqueSuggestions([
    ...session.suggestedPages,
    ...rankSuggestedRelatedPages(result, session.rootUrl)
  ]);
  const alreadyCaptured = session.sourceUrls.includes(result.snapshot.url);
  const capturedEvent: CaptureSessionEvent = {
    url: result.snapshot.url,
    title: result.snapshot.title,
    capturedAt: now,
    status: "captured"
  };

  return {
    ...session,
    updatedAt: now,
    pageCount: sourceUrls.length,
    sourceUrls,
    fields: mergeResolvedFields(session.fields, result.fields),
    suggestedPages,
    events: alreadyCaptured
      ? session.events
      : [capturedEvent, ...session.events].slice(0, 100)
  };
}

export function addCaptureSessionEvent(
  session: CaptureSession,
  event: Omit<CaptureSessionEvent, "capturedAt">
): CaptureSession {
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    events: [{ ...event, capturedAt: new Date().toISOString() }, ...session.events].slice(0, 100)
  };
}

function uniqueSuggestions(suggestions: SuggestedRelatedPage[]): SuggestedRelatedPage[] {
  const byUrl = new Map<string, SuggestedRelatedPage>();
  for (const suggestion of suggestions) {
    const existing = byUrl.get(suggestion.url);
    if (!existing || suggestion.score > existing.score) {
      byUrl.set(suggestion.url, suggestion);
    }
  }

  return Array.from(byUrl.values()).sort((a, b) => b.score - a.score).slice(0, 12);
}
