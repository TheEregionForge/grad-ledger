import { describe, expect, it } from "vitest";
import { exportCaptureReportsCsv, exportCaptureSessionCsv } from "../../src/storage/capture-sessions";
import type { CaptureSession } from "../../src/extraction/site-context";
import type { ResolvedField } from "../../src/shared/models";

function field(value: unknown): ResolvedField<unknown> {
  return {
    value,
    confidence: 95,
    alternatives: [],
    evidence: [],
    status: "confirmed"
  };
}

function session(): CaptureSession {
  return {
    id: "capture_test",
    status: "active",
    siteKey: "https://example.edu/~prof",
    rootUrl: "https://example.edu/~prof",
    startedAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:01:00.000Z",
    pageCount: 2,
    sourceUrls: ["https://example.edu/~prof", "https://example.edu/~prof/research"],
    suggestedPages: [],
    events: [],
    fields: {
      name: field("Jane Smith"),
      university: field("Example University"),
      country: field("Canada"),
      acceptingStudents: field("not_accepting"),
      researchInterests: field(["Software Engineering", "Program Analysis"])
    }
  };
}

describe("capture export", () => {
  it("exports a single-row CSV summary", () => {
    const csv = exportCaptureSessionCsv(session(), "professor", "Good fit");

    expect(csv).toContain("Report type");
    expect(csv).toContain("Open position status");
    expect(csv).toContain("not_accepting");
    expect(csv).toContain("Good fit");
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("exports saved reports together as one CSV table", () => {
    const csv = exportCaptureReportsCsv([
      {
        id: "report_1",
        savedAt: "2026-07-12T00:02:00.000Z",
        reportType: "professor",
        notes: "",
        capture: {
          id: "capture_test",
          status: "active",
          siteKey: "https://example.edu/~prof",
          rootUrl: "https://example.edu/~prof",
          startedAt: "2026-07-12T00:00:00.000Z",
          stoppedAt: undefined,
          updatedAt: "2026-07-12T00:01:00.000Z",
          pageCount: 2,
          sourceUrls: ["https://example.edu/~prof"],
          fields: session().fields,
          summary: {
            name: "Jane Smith",
            academicTitle: "",
            university: "Example University",
            department: "",
            country: "Canada",
            email: "",
            researchInterests: ["Software Engineering"],
            openPositionStatus: "not_accepting",
            labUrl: "",
            contactInstructions: "",
            emailSubjectHint: "",
            contactRestriction: ""
          }
        }
      }
    ]);

    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain("Jane Smith");
  });
});
