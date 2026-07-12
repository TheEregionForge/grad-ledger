import type { SavedRecord } from "../shared/models";
import { toCsvCell } from "../shared/normalization";

function fieldValue(record: SavedRecord, key: string): unknown {
  return record.fields[key]?.value ?? "";
}

export function exportJson(records: SavedRecord[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: "GradLedger",
      version: 1,
      records
    },
    null,
    2
  );
}

export function parseJsonImport(value: string): SavedRecord[] {
  const parsed = JSON.parse(value) as unknown;

  if (Array.isArray(parsed)) {
    return parsed as SavedRecord[];
  }

  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records)) {
    return (parsed as { records: SavedRecord[] }).records;
  }

  throw new Error("Import file does not contain saved records.");
}

export function exportProfessorCsv(records: SavedRecord[]): string {
  const headers = [
    "Name",
    "Academic title",
    "University",
    "Department",
    "Email",
    "Research interests",
    "Accepting students",
    "Country",
    "Google Scholar",
    "ORCID",
    "CV",
    "Lab",
    "Open positions",
    "Contact instructions",
    "Email subject",
    "Contact restriction",
    "Profile URL",
    "Status",
    "Notes",
    "Date saved"
  ];

  const rows = records.map((record) => [
    fieldValue(record, "name"),
    fieldValue(record, "academicTitle"),
    fieldValue(record, "university"),
    fieldValue(record, "department"),
    fieldValue(record, "email"),
    Array.isArray(fieldValue(record, "researchInterests")) ? (fieldValue(record, "researchInterests") as string[]).join("; ") : fieldValue(record, "researchInterests"),
    fieldValue(record, "acceptingStudents"),
    fieldValue(record, "country"),
    fieldValue(record, "googleScholarUrl"),
    fieldValue(record, "orcidUrl"),
    fieldValue(record, "cvUrl"),
    fieldValue(record, "labUrl"),
    fieldValue(record, "openPositionsUrl"),
    Array.isArray(fieldValue(record, "contactInstructions")) ? (fieldValue(record, "contactInstructions") as string[]).join("; ") : fieldValue(record, "contactInstructions"),
    fieldValue(record, "emailSubjectHint"),
    fieldValue(record, "contactRestriction"),
    record.canonicalUrl,
    record.workflow?.status ?? "saved",
    record.notes,
    record.createdAt
  ]);

  return [headers, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n");
}
