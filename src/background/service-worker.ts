import { extractPage } from "../extraction/engine";
import { UnsupportedPageError } from "../shared/errors";
import { isExtensionMessage, isValidSnapshot, type MessageResponse } from "../shared/messages";
import type { ExtractionResult, PageSnapshot, SavedRecord } from "../shared/models";
import { ChromeStorageRepository } from "../storage/chrome-storage";
import {
  getActiveCaptureSession,
  mergeResultIntoActiveCapture,
  recordFailedCaptureUrl,
  recordIgnoredCaptureUrl,
  startCaptureSession,
  stopCaptureSession
} from "../storage/capture-sessions";
import { listCommunityRulePacks } from "../storage/community-rules";
import { getSiteProfileForUrl, mergeResultIntoSiteProfile } from "../storage/site-profiles";
import { deriveSiteKey, type CaptureSession } from "../extraction/site-context";

const repository = new ChromeStorageRepository();
const analyzeContextMenuId = "gradpath-analyze-page";
const captureInFlightTabIds = new Set<number>();

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0];
}

function isSupportedPageUrl(url: string): boolean {
  const parsed = new URL(url);
  return ["http:", "https:", "file:"].includes(parsed.protocol);
}

function assertSupportedUrl(url: string): void {
  if (!isSupportedPageUrl(url)) {
    throw new UnsupportedPageError("Chrome internal pages and extension pages cannot be analyzed.");
  }
}

async function collectSnapshot(tabId: number): Promise<PageSnapshot> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) {
    assertSupportedUrl(tab.url);
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/collector.js"]
    });
  } catch (error) {
    throw new UnsupportedPageError(
      error instanceof Error
        ? `Could not analyze this page: ${error.message}`
        : "Could not analyze this page. Try a normal http, https, or allowed file page."
    );
  }

  const response = (await chrome.tabs.sendMessage(tabId, {
    type: "COLLECT_PAGE_SNAPSHOT"
  })) as MessageResponse<PageSnapshot>;

  if (!response?.ok || !isValidSnapshot(response.data)) {
    throw new Error(response?.error || "The page did not return a valid snapshot.");
  }

  return response.data;
}

async function analyzeCurrentPage(tabId: number, options: { mergeIntoCapture?: boolean } = {}): Promise<ExtractionResult> {
  const snapshot = await collectSnapshot(tabId);
  const communityRulePacks = await listCommunityRulePacks();
  const result = extractPage(snapshot, communityRulePacks);
  await mergeResultIntoSiteProfile(result);
  if (options.mergeIntoCapture ?? true) {
    await mergeResultIntoActiveCapture(result);
  }
  return result;
}

function sendCaptureSessionUpdate(
  session: CaptureSession,
  capturedUrl: string,
  title: string,
  showBadge = false
): void {
  chrome.runtime.sendMessage({
    type: "CAPTURE_SESSION_UPDATED",
    session,
    capturedUrl,
    title
  }).catch(() => {
    // The side panel may be closed; storage remains the source of truth.
  });

  if (!showBadge) {
    return;
  }

  chrome.action.setBadgeBackgroundColor({ color: "#2358d5" }).catch(() => undefined);
  chrome.action.setBadgeText({ text: "OK" }).catch(() => undefined);
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" }).catch(() => undefined);
  }, 1600);
}

async function captureTabIfInSession(tabId: number, url: string, title = ""): Promise<void> {
  if (captureInFlightTabIds.has(tabId) || !isSupportedPageUrl(url)) {
    return;
  }

  const session = await getActiveCaptureSession();
  if (!session || session.status !== "active") {
    return;
  }

  if (deriveSiteKey(url).siteKey !== session.siteKey) {
    const updatedSession = await recordIgnoredCaptureUrl(url, title, "outside initial site");
    if (updatedSession) {
      sendCaptureSessionUpdate(updatedSession, url, title);
    }
    return;
  }

  if (session.sourceUrls.includes(url)) {
    return;
  }

  captureInFlightTabIds.add(tabId);
  try {
    await analyzeCurrentPage(tabId);
    const updatedSession = await getActiveCaptureSession();
    if (updatedSession) {
      sendCaptureSessionUpdate(updatedSession, url, title, true);
    }
  } catch (error) {
    const updatedSession = await recordFailedCaptureUrl(url, title, error instanceof Error ? error.message : "capture failed");
    if (updatedSession) {
      sendCaptureSessionUpdate(updatedSession, url, title);
    }
  } finally {
    captureInFlightTabIds.delete(tabId);
  }
}

async function openSidePanelForTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) {
    return;
  }

  await chrome.storage.session.set({ gradpathActiveTabId: tab.id });

  if (tab.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } else {
    await chrome.sidePanel.open({ tabId: tab.id });
  }

  chrome.runtime.sendMessage({ type: "ANALYSIS_TARGET_CHANGED", tabId: tab.id }).catch(() => {
    // Side panel may not be ready yet.
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: analyzeContextMenuId,
    title: "Analyze with GradLedger",
    contexts: ["page"]
  });

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Older Chrome builds may not support this behavior; action.onClicked below is the fallback.
  });
});

chrome.action.onClicked.addListener((tab) => {
  openSidePanelForTab(tab).catch(() => {
    // The side panel will show an error if the user tries to analyze an unsupported tab.
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === analyzeContextMenuId && tab) {
    openSidePanelForTab(tab).catch(() => {
      // Keep context menu failures quiet; explicit analysis reports the detailed error.
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    captureTabIfInSession(tabId, tab.url, tab.title ?? "").catch(() => {
      // Capture failures are stored as session events where possible.
    });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId).then((tab) => {
    if (tab.url) {
      return captureTabIfInSession(activeInfo.tabId, tab.url, tab.title ?? "");
    }
    return undefined;
  }).catch(() => {
    // Tab activation can race with tab closure or restricted pages.
  });
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (response: MessageResponse) => void) => {
  if (!isExtensionMessage(message)) {
    sendResponse({ ok: false, error: "Invalid extension message." });
    return false;
  }

  void (async () => {
    try {
      if (message.type === "GET_ACTIVE_TAB_CONTEXT") {
        const session = await chrome.storage.session.get("gradpathActiveTabId");
        const currentActiveTab = await getActiveTab();
        const sessionTab = session.gradpathActiveTabId
          ? await chrome.tabs.get(Number(session.gradpathActiveTabId)).catch(() => undefined)
          : undefined;
        const activeTab = [currentActiveTab, sessionTab].find((candidate) => {
          if (!candidate?.id) {
            return false;
          }

          return candidate.url ? isSupportedPageUrl(candidate.url) : true;
        });

        if (!activeTab?.id) {
          sendResponse({ ok: false, error: "No active browser tab was found." });
          return;
        }

        sendResponse({
          ok: true,
          data: { tabId: activeTab.id, url: activeTab.url, title: activeTab.title }
        });
        return;
      }

      if (message.type === "ANALYZE_CURRENT_PAGE") {
        const result = await analyzeCurrentPage(message.tabId);
        sendResponse({ ok: true, data: result });
        return;
      }

      if (message.type === "GET_SITE_PROFILE") {
        const profile = await getSiteProfileForUrl(message.url);
        sendResponse({ ok: true, data: profile ?? null });
        return;
      }

      if (message.type === "GET_CAPTURE_SESSION") {
        const session = await getActiveCaptureSession();
        sendResponse({ ok: true, data: session ?? null });
        return;
      }

      if (message.type === "START_CAPTURE_SESSION") {
        const result = await analyzeCurrentPage(message.tabId, { mergeIntoCapture: false });
        const session = await startCaptureSession(result);
        sendCaptureSessionUpdate(session, result.snapshot.url, result.snapshot.title, true);
        sendResponse({ ok: true, data: { result, session } });
        return;
      }

      if (message.type === "STOP_CAPTURE_SESSION") {
        const session = await stopCaptureSession();
        sendResponse({ ok: true, data: session });
        return;
      }

      if (message.type === "SAVE_RECORD") {
        await repository.saveRecord(message.record as SavedRecord);
        sendResponse({ ok: true, data: message.record });
        return;
      }

      if (message.type === "DEEP_SCAN_REQUESTED") {
        sendResponse({ ok: false, error: "Deep scan is planned for a later Phase 1 milestone." });
        return;
      }

      sendResponse({ ok: false, error: `Message ${message.type} is not handled by the service worker.` });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected extension error."
      });
    }
  })();

  return true;
});
