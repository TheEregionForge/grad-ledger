import { useEffect, useMemo, useRef, useState } from "react";
import type { ExtractionResult, PageType, ResolvedField } from "../shared/models";
import type { MessageResponse } from "../shared/messages";
import type { UpdateCheckResponse } from "../shared/messages";
import {
  exportCommunityRulePacks,
  importCommunityRulePacks,
  listCommunityRulePacks,
  parseCommunityRulePackImport
} from "../storage/community-rules";
import type { CommunityRulePack } from "../rules/community/models";
import {
  exportCaptureReportsCsv,
  exportCaptureSessionCsv,
  listCaptureReports,
  saveCaptureReport,
  type SavedCaptureReport
} from "../storage/capture-sessions";
import type { CaptureSession, SiteProfile } from "../extraction/site-context";

type PanelState = "idle" | "loading" | "ready" | "error" | "unsupported";
type PanelTab = "analysis" | "saved" | "rules" | "details";

interface ActiveTabContext {
  tabId: number;
  url?: string;
  title?: string;
}

interface SitePermissionRequest {
  origin: string;
  displayOrigin: string;
}

interface EditableField {
  key: string;
  label: string;
  value: string;
  confidence: number;
  status: string;
}

interface CaptureStartResponse {
  result: ExtractionResult;
  session: CaptureSession;
}

const fieldLabels: Record<string, string> = {
  name: "Name",
  email: "Email",
  university: "University",
  department: "Department",
  academicTitle: "Academic title",
  researchInterests: "Research interests",
  acceptingStudents: "Open position status",
  country: "Country",
  googleScholarUrl: "Google Scholar",
  orcidUrl: "ORCID",
  cvUrl: "CV",
  labUrl: "Lab",
  openPositionsUrl: "Open positions",
  contactInstructions: "Contact instructions",
  emailSubjectHint: "Email subject",
  contactRestriction: "Contact restriction"
};

const hiddenEditorFields = new Set(["googleScholarUrl", "orcidUrl", "cvUrl", "openPositionsUrl"]);
const professorFieldOrder = [
  "name",
  "email",
  "university",
  "department",
  "academicTitle",
  "researchInterests",
  "acceptingStudents",
  "contactInstructions",
  "emailSubjectHint",
  "contactRestriction",
  "labUrl",
  "country"
];
const programFieldOrder = [
  "university",
  "department",
  "country",
  "researchInterests",
  "acceptingStudents",
  "contactInstructions",
  "emailSubjectHint",
  "contactRestriction",
  "email"
];
const hiddenProgramFields = new Set(["name", "academicTitle", "labUrl"]);

function valueToText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join("; ");
  }

  return value == null ? "" : String(value);
}

function fieldValueToText(key: string, value: unknown): string {
  if (key === "acceptingStudents") {
    if (value === "accepting") {
      return "Accepting or recruiting";
    }
    if (value === "not_accepting") {
      return "Not accepting new students";
    }
    if (value === "unknown") {
      return "";
    }
  }

  return valueToText(value);
}

function permissionOriginFromUrl(url: string | undefined): SitePermissionRequest | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return {
      origin: `${parsed.origin}/*`,
      displayOrigin: parsed.origin
    };
  } catch {
    return null;
  }
}

function isMissingHostPermissionError(message: string): boolean {
  return /must request permission to access the respective host|cannot access contents of the page/i.test(message);
}

function textToFieldValue(key: string, value: string): unknown {
  if (key === "researchInterests") {
    return value
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (key === "acceptingStudents") {
    if (/not|no|closed|unavailable/i.test(value)) {
      return "not_accepting";
    }
    if (/accept|recruit|open|available|yes/i.test(value)) {
      return "accepting";
    }
    return "unknown";
  }

  return value.trim();
}

async function sendMessage<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as MessageResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error || "The extension did not return a successful response.");
  }

  return response.data as T;
}

function buildEditableFieldsFromFields(
  fields: Record<string, ResolvedField<unknown>>,
  reportType: PageType = "professor"
): EditableField[] {
  const fieldDisplayOrder = reportType === "program" ? programFieldOrder : professorFieldOrder;
  const hiddenFields = reportType === "program"
    ? new Set([...hiddenEditorFields, ...hiddenProgramFields])
    : hiddenEditorFields;
  const orderScore = (key: string) => {
    const index = fieldDisplayOrder.indexOf(key);
    return index >= 0 ? index : fieldDisplayOrder.length + 1;
  };

  return Object.entries(fields)
    .filter(([key]) => !hiddenFields.has(key))
    .sort(([a], [b]) => orderScore(a) - orderScore(b))
    .map(([key, field]) => ({
      key,
      label: fieldLabels[key] ?? key,
      value: fieldValueToText(key, field.value),
      confidence: field.confidence,
      status: field.status
    }));
}

function scoreResolvedFields(fields: Record<string, ResolvedField<unknown>>): number {
  const weights: Record<string, number> = {
    name: 18,
    university: 18,
    email: 15,
    acceptingStudents: 18,
    researchInterests: 14,
    contactInstructions: 8,
    department: 5,
    academicTitle: 4
  };
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const weighted = Object.entries(weights).reduce((sum, [key, weight]) => {
    const field = fields[key];
    const hasValue =
      field?.value != null &&
      valueToText(field.value) !== "" &&
      !(key === "acceptingStudents" && field.value === "unknown");
    return sum + (hasValue ? ((field.confidence ?? 0) / 100) * weight : 0);
  }, 0);

  return Math.round((weighted / totalWeight) * 100);
}

function sessionWithEdits(session: CaptureSession, editableFields: EditableField[]): CaptureSession {
  const fields: Record<string, ResolvedField<unknown>> = { ...session.fields };

  for (const field of editableFields) {
    const previous = session.fields[field.key];
    fields[field.key] = {
      value: textToFieldValue(field.key, field.value),
      confidence: field.value ? Math.max(previous?.confidence ?? field.confidence, field.confidence, 60) : 0,
      alternatives: previous?.alternatives ?? [],
      evidence: previous?.evidence ?? [],
      status: field.value ? previous?.status === "missing" ? "suggested" : previous?.status ?? field.status : "missing"
    };
  }

  return { ...session, fields };
}

function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ConfidencePill({ value, status }: { value: number; status: string }) {
  const tone = value >= 85 ? "good" : value >= 55 ? "warn" : "low";
  return <span className={`pill ${tone}`}>{status} {value}%</span>;
}

function FieldEditor({
  fields,
  onChange
}: {
  fields: EditableField[];
  onChange: (fields: EditableField[]) => void;
}) {
  return (
    <div className="field-grid">
      {fields.map((field) => (
        <label className="field" key={field.key}>
          <span>
            {field.label}
            <ConfidencePill value={field.confidence} status={field.status} />
          </span>
          {field.key === "researchInterests" ? (
            <textarea
              value={field.value}
              onChange={(event) =>
                onChange(fields.map((item) => (item.key === field.key ? { ...item, value: event.target.value } : item)))
              }
              rows={3}
            />
          ) : (
            <input
              value={field.value}
              onChange={(event) =>
                onChange(fields.map((item) => (item.key === field.key ? { ...item, value: event.target.value } : item)))
              }
            />
          )}
        </label>
      ))}
    </div>
  );
}

function reportTitle(report: SavedCaptureReport): string {
  return (
    valueToText(report.capture.summary.name) ||
    valueToText(report.capture.summary.university) ||
    report.capture.rootUrl
  );
}

function CaptureReportsPanel({
  reports,
  onDownloadAllReports,
  compact = false
}: {
  reports: SavedCaptureReport[];
  onDownloadAllReports: () => void;
  compact?: boolean;
}) {
  const professorReports = reports.filter((report) => report.reportType !== "program");
  const programReports = reports.filter((report) => report.reportType === "program");

  return (
    <div className={`report-queue ${compact ? "compact" : ""}`}>
      <div className="report-queue-header">
        <div>
          <strong>Saved reports</strong>
          <p>{reports.length} saved row{reports.length === 1 ? "" : "s"} stored locally</p>
        </div>
        <button disabled={reports.length === 0} onClick={onDownloadAllReports}>Download all CSV</button>
      </div>

      {reports.length === 0 ? (
        <p className="muted">Saved reports will stay here until you download the combined CSV.</p>
      ) : (
        <div className="report-groups">
          {professorReports.length > 0 && (
            <div>
              <p className="eyebrow">Professors</p>
              {professorReports.slice(0, compact ? 3 : 8).map((report) => (
                <div className="report-row" key={report.id}>
                  <span>{reportTitle(report)}</span>
                  <small>{valueToText(report.capture.summary.university) || report.capture.rootUrl}</small>
                </div>
              ))}
            </div>
          )}
          {programReports.length > 0 && (
            <div>
              <p className="eyebrow">Programs</p>
              {programReports.slice(0, compact ? 3 : 8).map((report) => (
                <div className="report-row" key={report.id}>
                  <span>{reportTitle(report)}</span>
                  <small>{valueToText(report.capture.summary.university) || report.capture.rootUrl}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisView({
  result,
  siteProfile,
  fields,
  notes,
  captureSession,
  permissionRequest,
  onFieldsChange,
  onNotesChange,
  onRequestPermission,
  onStartCapture,
  onStopCapture,
  onDownloadReport,
  onSaveReport,
  captureReports,
  onDownloadAllReports
}: {
  result: ExtractionResult | null;
  siteProfile: SiteProfile | null;
  fields: EditableField[];
  notes: string;
  captureSession: CaptureSession | null;
  permissionRequest: SitePermissionRequest | null;
  onFieldsChange: (fields: EditableField[]) => void;
  onNotesChange: (value: string) => void;
  onRequestPermission: () => void;
  onStartCapture: () => void;
  onStopCapture: () => void;
  onDownloadReport: () => void;
  onSaveReport: () => void;
  captureReports: SavedCaptureReport[];
  onDownloadAllReports: () => void;
}) {
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);

  if (permissionRequest) {
    return (
      <section className="empty-state">
        <h2>Site access needed</h2>
        <p>Chrome did not allow temporary access for this page. Grant access to {permissionRequest.displayOrigin}, then capture will start.</p>
        <div className="actions">
          <button className="primary" onClick={onRequestPermission}>Grant site access</button>
          <button onClick={onStartCapture}>Try again</button>
        </div>
      </section>
    );
  }

  const isCaptureActive = captureSession?.status === "active";

  if (!result && !isCaptureActive) {
    return (
      <section className="capture-start">
        <p className="eyebrow">Capture session</p>
        <h2>Start collecting this site</h2>
        <p>Open a professor, lab, or call-for-students page, then start capture. Related pages on the same site will be captured automatically as you visit them, including new tabs.</p>
        <button className="primary" onClick={onStartCapture}>Start capture</button>
        <CaptureReportsPanel reports={captureReports} onDownloadAllReports={onDownloadAllReports} />
      </section>
    );
  }

  const topClassification = result?.classification[0];
  const displayName =
    valueToText(captureSession?.fields.name?.value) ||
    valueToText(result?.fields.name?.value) ||
    result?.snapshot.title ||
    captureSession?.rootUrl ||
    "Capture session";
  const scoreFields = captureSession?.fields ?? siteProfile?.fields ?? result?.fields ?? {};
  const displayScore = scoreResolvedFields(scoreFields);
  const suggestedPages = captureSession?.suggestedPages ?? siteProfile?.suggestedPages ?? [];
  const viewedUrls = new Set([...(captureSession?.sourceUrls ?? []), ...(siteProfile?.sourceUrls ?? [])]);
  const visibleSuggestedPages = suggestionsExpanded ? suggestedPages : suggestedPages.slice(0, 3);

  return (
    <section className="analysis">
      <div className="capture-panel capture-panel-top">
        <div>
          <strong>Capture session</strong>
          <p>
            {isCaptureActive
              ? `${captureSession.pageCount} captured page${captureSession.pageCount === 1 ? "" : "s"} from this site`
              : "Start capture, then browse related pages in this site or new tabs."}
          </p>
        </div>
        <div className="actions compact">
          {isCaptureActive ? (
            <>
              <button onClick={onDownloadReport}>Download report</button>
              <button className="primary" onClick={onSaveReport}>Save report</button>
              <button className="danger" onClick={onStopCapture}>Stop session</button>
            </>
          ) : (
            <button className="primary" onClick={onStartCapture}>Start capture</button>
          )}
        </div>
        {isCaptureActive && captureSession.events.length > 0 && (
          <div className="capture-events">
            {captureSession.events.slice(0, 3).map((event) => (
              <div className={`capture-event ${event.status}`} key={`${event.status}-${event.url}-${event.capturedAt}`}>
                <span>{event.status}</span>
                <p>{event.title || event.url}</p>
                {event.reason && <small>{event.reason}</small>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="result-header">
        <div>
          <p className="eyebrow">{result ? result.pageType.replaceAll("_", " ") : "capture session"}</p>
          <h2>{displayName}</h2>
        </div>
        <div className="score">{displayScore > 0 ? `${displayScore}%` : `${captureSession?.pageCount ?? 0} pg`}</div>
      </div>

      {result?.warnings.map((warning) => (
        <div className="notice" key={warning}>{warning}</div>
      ))}

      {topClassification && (
        <div className="classification">
          <strong>Classifier</strong>
          <span>{topClassification.pageType.replaceAll("_", " ")} · score {topClassification.score}</span>
        </div>
      )}

      {siteProfile && (
        <div className="site-context">
          <div className="site-context-header">
            <div>
              <strong>Cumulative site profile</strong>
              <p>{captureSession?.pageCount ?? siteProfile.pageCount} analyzed page{(captureSession?.pageCount ?? siteProfile.pageCount) === 1 ? "" : "s"} from this site</p>
            </div>
            <button className="link-button" onClick={() => setSuggestionsExpanded((value) => !value)}>
              {suggestedPages.length} suggested {suggestionsExpanded ? "Hide" : "Show"}
            </button>
          </div>
          {suggestedPages.length > 0 && suggestionsExpanded && (
            <div className="suggested-links">
              {visibleSuggestedPages.map((page) => {
                const viewed = viewedUrls.has(page.url);
                return (
                <a className={viewed ? "viewed" : ""} href={page.url} target="_blank" rel="noreferrer" key={page.url}>
                  <span>{page.text}</span>
                  <small>{viewed ? "captured" : page.reason}</small>
                </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {fields.length > 0 ? (
        <FieldEditor fields={fields} onChange={onFieldsChange} />
      ) : (
        <p className="muted">Captured fields will appear here after the first page is collected.</p>
      )}

      <label className="field">
        <span>Notes</span>
        <textarea value={notes} onChange={(event) => onNotesChange(event.target.value)} rows={4} />
      </label>

      <CaptureReportsPanel reports={captureReports} onDownloadAllReports={onDownloadAllReports} compact />
    </section>
  );
}

function RulePacksView({
  rulePacks,
  onRefresh,
  onImport
}: {
  rulePacks: CommunityRulePack[];
  onRefresh: () => void;
  onImport: (packs: CommunityRulePack[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const exported = useMemo(() => exportCommunityRulePacks(rulePacks), [rulePacks]);

  async function importFile(file: File): Promise<void> {
    const text = await file.text();
    onImport(parseCommunityRulePackImport(text));
  }

  return (
    <section>
      <div className="toolbar">
        <button onClick={() => downloadText("gradledger-community-rules.json", exported, "application/json")}>Export rules</button>
        <button onClick={() => navigator.clipboard.writeText(exported)}>Copy rules</button>
        <button onClick={() => fileInputRef.current?.click()}>Import rules</button>
        <button onClick={onRefresh}>Refresh</button>
      </div>
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            importFile(file).catch((error: unknown) => alert(error instanceof Error ? error.message : "Rule import failed."));
          }
          event.currentTarget.value = "";
        }}
      />

      <div className="record-list">
        {rulePacks.map((pack) => (
          <article className="record-card" key={pack.id}>
            <div>
              <h3>{pack.name}</h3>
              <p>
                {pack.domainMappings.length} domain mappings · {pack.adapters.length} adapters · {pack.relatedLinkPatterns.length} link patterns
              </p>
            </div>
            <span>{pack.source}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function DetailsView({ result }: { result: ExtractionResult | null }) {
  if (!result) {
    return <p className="muted">Analyze a page to inspect the snapshot and evidence.</p>;
  }

  return (
    <section className="details">
      <h2>Snapshot inspector</h2>
      <div className="detail-block">
        <h3>Metadata</h3>
        <pre>{JSON.stringify(result.snapshot.metadata, null, 2)}</pre>
      </div>
      <div className="detail-block">
        <h3>Emails</h3>
        <pre>{JSON.stringify(result.snapshot.emails, null, 2)}</pre>
      </div>
      <div className="detail-block">
        <h3>Headings</h3>
        <ul>
          {result.snapshot.headings.slice(0, 80).map((heading) => (
            <li key={heading.id}>H{heading.level} · {heading.text}</li>
          ))}
        </ul>
      </div>
      <div className="detail-block">
        <h3>Content blocks</h3>
        {result.snapshot.contentBlocks.slice(0, 80).map((block) => (
          <article className="block-card" key={block.id}>
            <strong>{block.tagName}</strong>
            <p>{block.text}</p>
            <small>{block.headingPath.join(" / ") || "No heading path"}</small>
          </article>
        ))}
      </div>
      <div className="detail-block">
        <h3>Evidence</h3>
        <pre>{JSON.stringify(result.fields, null, 2)}</pre>
      </div>
      <div className="detail-block">
        <h3>Community rules</h3>
        <pre>{JSON.stringify(result.communityRules ?? {}, null, 2)}</pre>
      </div>
    </section>
  );
}

export default function App() {
  const [state, setState] = useState<PanelState>("idle");
  const [activeTab, setActiveTab] = useState<PanelTab>("analysis");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [siteProfile, setSiteProfile] = useState<SiteProfile | null>(null);
  const [captureSession, setCaptureSession] = useState<CaptureSession | null>(null);
  const [captureReportType, setCaptureReportType] = useState<PageType>("professor");
  const captureReportTypeRef = useRef<PageType>("professor");
  const [fields, setFields] = useState<EditableField[]>([]);
  const [captureReports, setCaptureReports] = useState<SavedCaptureReport[]>([]);
  const [rulePacks, setRulePacks] = useState<CommunityRulePack[]>([]);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");
  const [permissionRequest, setPermissionRequest] = useState<SitePermissionRequest | null>(null);
  const [toast, setToast] = useState("");
  const [availableUpdate, setAvailableUpdate] = useState<UpdateCheckResponse>(null);
  const toastTimerRef = useRef<number | null>(null);

  function showToast(message: string): void {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2600);
  }

  async function refreshCaptureReports(): Promise<void> {
    setCaptureReports(await listCaptureReports());
  }

  async function refreshRulePacks(): Promise<void> {
    setRulePacks(await listCommunityRulePacks());
  }

  async function refreshCaptureSession(): Promise<void> {
    const session = await sendMessage<CaptureSession | null>({ type: "GET_CAPTURE_SESSION" });
    setCaptureSession(session);
    if (session?.status === "active") {
      setFields(buildEditableFieldsFromFields(session.fields, captureReportType));
      setState("ready");
    }
  }

  async function requestSiteAccessAndAnalyze(): Promise<void> {
    if (!permissionRequest) {
      await startCapture();
      return;
    }

    const granted = await chrome.permissions.request({ origins: [permissionRequest.origin] });
    if (!granted) {
      setError(`Chrome did not grant access to ${permissionRequest.displayOrigin}.`);
      setState("error");
      return;
    }

    await startCapture();
  }

  function currentReportType(): PageType {
    return captureReportType === "program" ? "program" : "professor";
  }

  async function saveActiveReport(): Promise<void> {
    if (!captureSession) {
      return;
    }

    const report = await saveCaptureReport(sessionWithEdits(captureSession, fields), currentReportType(), notes);
    setCaptureReports([report, ...captureReports]);
    showToast("Report saved locally");
    setActiveTab("saved");
  }

  async function startCapture(): Promise<void> {
    setState("loading");
    setError("");
    setPermissionRequest(null);

    try {
      const context = await sendMessage<ActiveTabContext>({ type: "GET_ACTIVE_TAB_CONTEXT" });
      const { result: extraction, session } = await sendMessage<CaptureStartResponse>({
        type: "START_CAPTURE_SESSION",
        tabId: context.tabId
      });
      const profile = await sendMessage<SiteProfile | null>({ type: "GET_SITE_PROFILE", url: extraction.snapshot.url });
      setResult(extraction);
      setCaptureSession(session);
      setCaptureReportType(extraction.pageType === "program" ? "program" : "professor");
      setSiteProfile(profile);
      setFields(buildEditableFieldsFromFields(session.fields, extraction.pageType));
      setActiveTab("analysis");
      setState("ready");
      showToast(`Captured ${extraction.snapshot.title || extraction.snapshot.url}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Capture failed.";
      const context = await sendMessage<ActiveTabContext>({ type: "GET_ACTIVE_TAB_CONTEXT" }).catch(() => null);
      const originRequest = isMissingHostPermissionError(message) ? permissionOriginFromUrl(context?.url) : null;
      if (originRequest) {
        setPermissionRequest(originRequest);
      }
      setError(message);
      setState(/cannot be analyzed|unsupported|internal pages/i.test(message) ? "unsupported" : "error");
    }
  }

  async function stopCapture(): Promise<void> {
    const session = await sendMessage<CaptureSession | null>({ type: "STOP_CAPTURE_SESSION" });
    if (session) {
      showToast(`Stopped capture with ${session.pageCount} page${session.pageCount === 1 ? "" : "s"}`);
    }
    setCaptureSession(null);
    setResult(null);
    setSiteProfile(null);
    setFields([]);
    setNotes("");
    setCaptureReportType("professor");
    setPermissionRequest(null);
    setState("idle");
    setActiveTab("analysis");
  }

  function downloadActiveReport(): void {
    if (captureSession) {
      downloadText(
        `gradledger-report-${captureSession.id}.csv`,
        exportCaptureSessionCsv(sessionWithEdits(captureSession, fields), currentReportType(), notes),
        "text/csv"
      );
    }
  }

  function downloadAllReports(): void {
    if (captureReports.length > 0) {
      downloadText("gradledger-saved-reports.csv", exportCaptureReportsCsv(captureReports), "text/csv");
    }
  }

  async function importRules(packs: CommunityRulePack[]): Promise<void> {
    await importCommunityRulePacks(packs);
    await refreshRulePacks();
  }

  useEffect(() => {
    captureReportTypeRef.current = captureReportType;
  }, [captureReportType]);

  useEffect(() => {
    refreshCaptureReports().catch(() => setCaptureReports([]));
    refreshRulePacks().catch(() => setRulePacks([]));
    refreshCaptureSession().catch(() => setCaptureSession(null));
    sendMessage<UpdateCheckResponse>({ type: "CHECK_FOR_UPDATE" })
      .then(setAvailableUpdate)
      .catch(() => setAvailableUpdate(null));

    const listener = (message: unknown) => {
      if (typeof message !== "object" || message === null) {
        return;
      }

      const extensionMessage = message as {
        type?: string;
        session?: CaptureSession;
        capturedUrl?: string;
        title?: string;
      };
      if (extensionMessage.type === "CAPTURE_SESSION_UPDATED" && extensionMessage.session) {
        const session = extensionMessage.session;
        setCaptureSession(session);
        setFields(buildEditableFieldsFromFields(session.fields, captureReportTypeRef.current));
        setState("ready");
        if (extensionMessage.capturedUrl) {
          showToast(`Captured ${extensionMessage.title || extensionMessage.capturedUrl}`);
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  return (
    <main>
      <header className="app-header">
        <div>
          <h1>GradLedger</h1>
          <p>{captureSession?.status === "active" ? "Capture running" : "Site capture"}</p>
        </div>
      </header>

      <nav className="tabs" aria-label="Panel sections">
        <button className={activeTab === "analysis" ? "active" : ""} onClick={() => setActiveTab("analysis")}>Analyze</button>
        <button className={activeTab === "saved" ? "active" : ""} onClick={() => setActiveTab("saved")}>Reports</button>
        <button className={activeTab === "rules" ? "active" : ""} onClick={() => setActiveTab("rules")}>Rules</button>
        <button className={activeTab === "details" ? "active" : ""} onClick={() => setActiveTab("details")}>Details</button>
      </nav>

      {availableUpdate && (
        <div className="update-banner" role="status">
          <div>
            <strong>Update available: {availableUpdate.version}</strong>
            <p>Download the latest GradLedger release from GitHub.</p>
          </div>
          <button onClick={() => window.open(availableUpdate.releaseUrl, "_blank", "noopener,noreferrer")}>
            Open GitHub
          </button>
        </div>
      )}

      {state === "loading" && <div className="banner">Collecting normalized page snapshot...</div>}
      {(state === "error" || state === "unsupported") && <div className="banner error">{error}</div>}
      {toast && <div className="toast" role="status">{toast}</div>}

      {activeTab === "analysis" && (
        <AnalysisView
          result={result}
          siteProfile={siteProfile}
          fields={fields}
          notes={notes}
          captureSession={captureSession}
          permissionRequest={permissionRequest}
          onFieldsChange={setFields}
          onNotesChange={setNotes}
          onRequestPermission={requestSiteAccessAndAnalyze}
          onStartCapture={() => startCapture().catch(console.error)}
          onStopCapture={() => stopCapture().catch(console.error)}
          onDownloadReport={downloadActiveReport}
          onSaveReport={() => saveActiveReport().catch(console.error)}
          captureReports={captureReports}
          onDownloadAllReports={downloadAllReports}
        />
      )}

      {activeTab === "saved" && (
        <section>
          <CaptureReportsPanel reports={captureReports} onDownloadAllReports={downloadAllReports} />
        </section>
      )}

      {activeTab === "rules" && (
        <RulePacksView rulePacks={rulePacks} onRefresh={refreshRulePacks} onImport={(packs) => importRules(packs).catch(console.error)} />
      )}

      {activeTab === "details" && <DetailsView result={result} />}
    </main>
  );
}
