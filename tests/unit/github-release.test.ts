import { describe, expect, it } from "vitest";
import { isReleaseNewer, normalizeReleaseVersion, parseGitHubReleaseUpdate } from "../../src/updates/github-release";

describe("GitHub release update checks", () => {
  it("accepts stable semantic release tags and compares each version component", () => {
    expect(normalizeReleaseVersion("v0.5.1")).toEqual([0, 5, 1]);
    expect(isReleaseNewer("v0.5.1", "0.5.0")).toBe(true);
    expect(isReleaseNewer("0.5.0", "0.5.0")).toBe(false);
    expect(isReleaseNewer("0.5.0", "0.5.1")).toBe(false);
  });

  it("returns only a newer stable release from the configured GitHub repository", () => {
    expect(
      parseGitHubReleaseUpdate(
        {
          tag_name: "v0.5.1",
          html_url: "https://github.com/TheEregionForge/grad-ledger/releases/tag/v0.5.1",
          published_at: "2026-07-12T00:00:00.000Z"
        },
        "0.5.0"
      )
    ).toEqual({
      version: "0.5.1",
      releaseUrl: "https://github.com/TheEregionForge/grad-ledger/releases/tag/v0.5.1",
      publishedAt: "2026-07-12T00:00:00.000Z"
    });
    expect(parseGitHubReleaseUpdate({ tag_name: "v0.6.0", prerelease: true }, "0.5.0")).toBeNull();
    expect(parseGitHubReleaseUpdate({ tag_name: "v0.5.0" }, "0.5.0")).toBeNull();
  });
});
