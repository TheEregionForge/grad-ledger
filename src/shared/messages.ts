import type { ExtractionResult, PageSnapshot, SavedRecord } from "./models";
import type { CaptureSession, SiteProfile } from "../extraction/site-context";

export type ExtensionMessage =
  | { type: "ANALYZE_CURRENT_PAGE"; tabId: number }
  | { type: "PAGE_SNAPSHOT_READY"; snapshot: PageSnapshot }
  | { type: "EXTRACTION_COMPLETE"; result: ExtractionResult }
  | { type: "SAVE_RECORD"; record: SavedRecord }
  | { type: "DEEP_SCAN_REQUESTED"; recordId: string }
  | { type: "GET_ACTIVE_TAB_CONTEXT" }
  | { type: "GET_SITE_PROFILE"; url: string }
  | { type: "GET_CAPTURE_SESSION" }
  | { type: "START_CAPTURE_SESSION"; tabId: number }
  | { type: "STOP_CAPTURE_SESSION" }
  | { type: "COLLECT_PAGE_SNAPSHOT" }
  | { type: "ANALYSIS_TARGET_CHANGED"; tabId: number }
  | { type: "CAPTURE_SESSION_UPDATED"; session: CaptureSession; capturedUrl?: string; title?: string };

export interface MessageResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isExtensionMessage(message: unknown): message is ExtensionMessage {
  if (!isObject(message) || typeof message.type !== "string") {
    return false;
  }

  switch (message.type) {
    case "ANALYZE_CURRENT_PAGE":
      return Number.isInteger(message.tabId);
    case "PAGE_SNAPSHOT_READY":
      return isObject(message.snapshot);
    case "EXTRACTION_COMPLETE":
      return isObject(message.result);
    case "SAVE_RECORD":
      return isObject(message.record);
    case "DEEP_SCAN_REQUESTED":
      return typeof message.recordId === "string";
    case "GET_ACTIVE_TAB_CONTEXT":
    case "GET_CAPTURE_SESSION":
    case "STOP_CAPTURE_SESSION":
    case "COLLECT_PAGE_SNAPSHOT":
      return true;
    case "GET_SITE_PROFILE":
      return typeof message.url === "string";
    case "START_CAPTURE_SESSION":
      return Number.isInteger(message.tabId);
    case "ANALYSIS_TARGET_CHANGED":
      return Number.isInteger(message.tabId);
    case "CAPTURE_SESSION_UPDATED":
      return isObject(message.session);
    default:
      return false;
  }
}

export function isValidSnapshot(value: unknown): value is PageSnapshot {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    typeof value.domain === "string" &&
    Array.isArray(value.jsonLd) &&
    Array.isArray(value.headings) &&
    Array.isArray(value.contentBlocks) &&
    Array.isArray(value.links) &&
    Array.isArray(value.emails) &&
    Array.isArray(value.tables)
  );
}
