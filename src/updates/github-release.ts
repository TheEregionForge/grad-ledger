export interface GitHubReleaseUpdate {
  version: string;
  releaseUrl: string;
  publishedAt?: string;
}

interface GitHubReleaseResponse {
  tag_name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

interface UpdateCheckCache {
  checkedAt: string;
  update: GitHubReleaseUpdate | null;
}

const repository = "TheEregionForge/grad-ledger";
const latestReleaseEndpoint = `https://api.github.com/repos/${repository}/releases/latest`;
const releasePageUrl = `https://github.com/${repository}/releases`;
const cacheKey = "gradledger.githubReleaseCheck.v1";
const checkIntervalMs = 24 * 60 * 60 * 1000;

export function normalizeReleaseVersion(value: string): number[] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  return match ? match.slice(1).map(Number) : null;
}

export function isReleaseNewer(latest: string, current: string): boolean {
  const latestParts = normalizeReleaseVersion(latest);
  const currentParts = normalizeReleaseVersion(current);
  if (!latestParts || !currentParts) {
    return false;
  }

  for (let index = 0; index < latestParts.length; index += 1) {
    if (latestParts[index] !== currentParts[index]) {
      return latestParts[index] > currentParts[index];
    }
  }
  return false;
}

function isValidReleaseUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.startsWith(`/${repository}/releases/`);
  } catch {
    return false;
  }
}

export function parseGitHubReleaseUpdate(
  release: GitHubReleaseResponse,
  currentVersion: string
): GitHubReleaseUpdate | null {
  if (
    release.draft === true ||
    release.prerelease === true ||
    typeof release.tag_name !== "string" ||
    !isReleaseNewer(release.tag_name, currentVersion)
  ) {
    return null;
  }

  return {
    version: release.tag_name.replace(/^v/i, ""),
    releaseUrl: isValidReleaseUrl(release.html_url) ? release.html_url : releasePageUrl,
    publishedAt: typeof release.published_at === "string" ? release.published_at : undefined
  };
}

function isRecent(cache: UpdateCheckCache | undefined): boolean {
  if (!cache?.checkedAt) {
    return false;
  }
  const checkedAt = Date.parse(cache.checkedAt);
  return Number.isFinite(checkedAt) && Date.now() - checkedAt < checkIntervalMs;
}

async function getCache(): Promise<UpdateCheckCache | undefined> {
  const stored = await chrome.storage.local.get(cacheKey);
  const value = stored[cacheKey];
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as UpdateCheckCache;
}

/**
 * Checks only GitHub's public latest-release metadata. The result is cached for
 * 24 hours and failures are silent so an unavailable network never disrupts capture.
 */
export async function checkForGitHubUpdate(): Promise<GitHubReleaseUpdate | null> {
  const cached = await getCache();
  if (isRecent(cached)) {
    return cached?.update ?? null;
  }

  try {
    const response = await fetch(latestReleaseEndpoint, {
      headers: {
        Accept: "application/vnd.github+json"
      }
    });
    if (!response.ok) {
      throw new Error(`GitHub release check returned ${response.status}.`);
    }

    const release = (await response.json()) as GitHubReleaseResponse;
    const update = parseGitHubReleaseUpdate(release, chrome.runtime.getManifest().version);
    await chrome.storage.local.set({
      [cacheKey]: { checkedAt: new Date().toISOString(), update } satisfies UpdateCheckCache
    });
    return update;
  } catch {
    // Cache the unsuccessful check too; the extension should not retry on every panel open while offline.
    await chrome.storage.local.set({
      [cacheKey]: { checkedAt: new Date().toISOString(), update: cached?.update ?? null } satisfies UpdateCheckCache
    }).catch(() => undefined);
    return cached?.update ?? null;
  }
}
