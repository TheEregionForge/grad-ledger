import {
  addCaptureSessionEvent,
  createCaptureSession,
  isSameCaptureSite,
  mergeResultIntoCaptureSession,
  type CaptureSession
} from "../extraction/site-context";
import type { ExtractionResult, PageType } from "../shared/models";
import { toCsvCell } from "../shared/normalization";

const activeCaptureSessionStorageKey = "gradpath.activeCaptureSession.v1";
const captureSessionHistoryStorageKey = "gradpath.captureSessionHistory.v1";
const captureReportsStorageKey = "gradpath.captureReports.v1";

export interface SavedCaptureReport {
  id: string;
  savedAt: string;
  reportType: PageType;
  notes: string;
  capture: ReturnType<typeof captureSessionSummary>;
}

function chromeGet<T>(key: string): Promise<T | undefined> {
  return chrome.storage.local.get(key).then((result) => result[key] as T | undefined);
}

function chromeSet(value: Record<string, unknown>): Promise<void> {
  return chrome.storage.local.set(value);
}

export async function getActiveCaptureSession(): Promise<CaptureSession | null> {
  return (await chromeGet<CaptureSession>(activeCaptureSessionStorageKey)) ?? null;
}

export async function startCaptureSession(result: ExtractionResult): Promise<CaptureSession> {
  const session = mergeResultIntoCaptureSession(createCaptureSession(result), result);
  await chromeSet({ [activeCaptureSessionStorageKey]: session });
  return session;
}

export async function stopCaptureSession(): Promise<CaptureSession | null> {
  const session = await getActiveCaptureSession();
  if (!session) {
    return null;
  }

  const stopped: CaptureSession = {
    ...session,
    status: "stopped",
    stoppedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const history = (await chromeGet<CaptureSession[]>(captureSessionHistoryStorageKey)) ?? [];

  await chromeSet({
    [activeCaptureSessionStorageKey]: null,
    [captureSessionHistoryStorageKey]: [stopped, ...history].slice(0, 25)
  });

  return stopped;
}

export async function mergeResultIntoActiveCapture(result: ExtractionResult): Promise<CaptureSession | null> {
  const session = await getActiveCaptureSession();
  if (!session || session.status !== "active") {
    return null;
  }

  if (!isSameCaptureSite(session, result.snapshot.url)) {
    return session;
  }

  const nextSession = mergeResultIntoCaptureSession(session, result);
  await chromeSet({ [activeCaptureSessionStorageKey]: nextSession });
  return nextSession;
}

export async function recordIgnoredCaptureUrl(url: string, title: string, reason: string): Promise<CaptureSession | null> {
  const session = await getActiveCaptureSession();
  if (!session || session.status !== "active") {
    return null;
  }

  const nextSession = addCaptureSessionEvent(session, {
    url,
    title,
    status: "ignored",
    reason
  });

  await chromeSet({ [activeCaptureSessionStorageKey]: nextSession });
  return nextSession;
}

export async function recordFailedCaptureUrl(url: string, title: string, reason: string): Promise<CaptureSession | null> {
  const session = await getActiveCaptureSession();
  if (!session || session.status !== "active") {
    return null;
  }

  const nextSession = addCaptureSessionEvent(session, {
    url,
    title,
    status: "failed",
    reason
  });

  await chromeSet({ [activeCaptureSessionStorageKey]: nextSession });
  return nextSession;
}

function fieldValue(session: CaptureSession, key: string): unknown {
  return session.fields[key]?.value ?? "";
}

function fieldText(value: unknown): string {
  return Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
}

export function captureSessionSummary(session: CaptureSession) {
  return {
    id: session.id,
    status: session.status,
    siteKey: session.siteKey,
    rootUrl: session.rootUrl,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    updatedAt: session.updatedAt,
    pageCount: session.pageCount,
    sourceUrls: session.sourceUrls,
    fields: session.fields,
    summary: {
      name: fieldValue(session, "name"),
      academicTitle: fieldValue(session, "academicTitle"),
      university: fieldValue(session, "university"),
      department: fieldValue(session, "department"),
      country: fieldValue(session, "country"),
      email: fieldValue(session, "email"),
      researchInterests: fieldValue(session, "researchInterests"),
      openPositionStatus: fieldValue(session, "acceptingStudents"),
      labUrl: fieldValue(session, "labUrl"),
      contactInstructions: fieldValue(session, "contactInstructions"),
      emailSubjectHint: fieldValue(session, "emailSubjectHint"),
      contactRestriction: fieldValue(session, "contactRestriction")
    }
  };
}

function captureReportRow(report: SavedCaptureReport): unknown[] {
  const summary = report.capture.summary;
  return [
    report.reportType,
    summary.name,
    summary.academicTitle,
    summary.university,
    summary.department,
    summary.country,
    summary.email,
    fieldText(summary.researchInterests),
    summary.openPositionStatus,
    summary.labUrl,
    fieldText(summary.contactInstructions),
    summary.emailSubjectHint,
    summary.contactRestriction,
    report.capture.rootUrl,
    report.capture.pageCount,
    report.capture.sourceUrls.join("; "),
    report.notes,
    report.savedAt
  ];
}

function captureReportHeaders(): string[] {
  return [
    "Report type",
    "Name",
    "Academic title",
    "University",
    "Department",
    "Country",
    "Email",
    "Research interests",
    "Open position status",
    "Lab URL",
    "Contact instructions",
    "Email subject",
    "Contact restriction",
    "Root URL",
    "Captured pages",
    "Source URLs",
    "Notes",
    "Saved at"
  ];
}

export function exportCaptureSessionCsv(session: CaptureSession, reportType: PageType = "unknown", notes = ""): string {
  const report: SavedCaptureReport = {
    id: session.id,
    savedAt: new Date().toISOString(),
    reportType,
    notes,
    capture: captureSessionSummary(session)
  };

  return [captureReportHeaders(), captureReportRow(report)].map((cells) => cells.map(toCsvCell).join(",")).join("\n");
}

export function exportCaptureReportsCsv(reports: SavedCaptureReport[]): string {
  return [captureReportHeaders(), ...reports.map(captureReportRow)]
    .map((cells) => cells.map(toCsvCell).join(","))
    .join("\n");
}

export async function listCaptureReports(): Promise<SavedCaptureReport[]> {
  return (await chromeGet<SavedCaptureReport[]>(captureReportsStorageKey)) ?? [];
}

export async function saveCaptureReport(
  session: CaptureSession,
  reportType: PageType,
  notes: string
): Promise<SavedCaptureReport> {
  const reports = await listCaptureReports();
  const report: SavedCaptureReport = {
    id: `report_${Date.now().toString(36)}`,
    savedAt: new Date().toISOString(),
    reportType,
    notes,
    capture: captureSessionSummary(session)
  };
  await chromeSet({ [captureReportsStorageKey]: [report, ...reports].slice(0, 500) });
  return report;
}
