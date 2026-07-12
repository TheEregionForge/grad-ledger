import { describe, expect, it } from "vitest";
import { createCaptureSession, deriveSiteKey, isSameCaptureSite, mergeResolvedFields } from "../../src/extraction/site-context";
import type { ExtractionResult } from "../../src/shared/models";
import type { ResolvedField } from "../../src/shared/models";

function field(value: string, confidence: number): ResolvedField<string> {
  return {
    value,
    confidence,
    alternatives: [],
    evidence: [],
    status: confidence >= 90 ? "confirmed" : "suggested"
  };
}

describe("site context", () => {
  it("groups Google Sites subpages by /view/site-name", () => {
    expect(
      deriveSiteKey("https://sites.google.com/view/jaejunyoo/call-for-students-interns?authuser=0")
    ).toEqual({
      siteKey: "https://sites.google.com/view/jaejunyoo",
      rootUrl: "https://sites.google.com/view/jaejunyoo"
    });
  });

  it("keeps stronger field evidence while merging pages", () => {
    const merged = mergeResolvedFields(
      { email: field("old@example.edu", 60) },
      { email: field("strong@example.edu", 95) }
    );

    expect(merged.email.value).toBe("strong@example.edu");
  });

  it("replaces unknown open-position status with later evidence", () => {
    const merged = mergeResolvedFields(
      {
        acceptingStudents: {
          value: "unknown",
          confidence: 100,
          alternatives: [],
          evidence: [],
          status: "confirmed"
        }
      },
      { acceptingStudents: field("not_accepting", 98) }
    );

    expect(merged.acceptingStudents.value).toBe("not_accepting");
  });

  it("keeps capture sessions inside the initial Google Site", () => {
    const result: ExtractionResult = {
      pageType: "professor",
      confidence: 0,
      classification: [],
      snapshot: {
        url: "https://sites.google.com/view/jaejunyoo/call-for-students-interns?authuser=0",
        title: "Call",
        domain: "sites.google.com",
        metadata: {},
        jsonLd: [],
        breadcrumbs: [],
        headings: [],
        contentBlocks: [],
        links: [],
        emails: [],
        tables: []
      },
      fields: {},
      createdAt: "2026-07-12T00:00:00.000Z",
      extractionVersion: "test",
      warnings: []
    };
    const session = createCaptureSession(result);

    expect(isSameCaptureSite(session, "https://sites.google.com/view/jaejunyoo/research")).toBe(true);
    expect(isSameCaptureSite(session, "https://sites.google.com/view/another-lab/research")).toBe(false);
  });
});
