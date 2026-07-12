import type { JsonLdObject } from "../shared/models";

const supportedTypes = new Set([
  "Person",
  "Organization",
  "CollegeOrUniversity",
  "EducationalOrganization",
  "EducationalOccupationalProgram",
  "Course",
  "Scholarship",
  "WebPage",
  "BreadcrumbList"
]);

function typeMatches(value: unknown): boolean {
  if (typeof value === "string") {
    return supportedTypes.has(value);
  }

  if (Array.isArray(value)) {
    return value.some(typeMatches);
  }

  return false;
}

function flattenJsonLd(value: unknown): JsonLdObject[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLd);
  }

  const object = value as JsonLdObject;
  const graph = object["@graph"];
  const current = typeMatches(object["@type"]) ? [object] : [];
  const children = Array.isArray(graph) ? graph.flatMap(flattenJsonLd) : [];

  return [...current, ...children];
}

export function collectJsonLd(): JsonLdObject[] {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'));
  const objects: JsonLdObject[] = [];

  for (const script of scripts) {
    try {
      objects.push(...flattenJsonLd(JSON.parse(script.textContent ?? "")));
    } catch {
      // Invalid JSON-LD is common on real university pages; skip it without blocking analysis.
    }
  }

  return objects.slice(0, 50);
}
