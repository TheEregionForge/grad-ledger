import { deriveSiteKey, mergeSiteProfile, type SiteProfile } from "../extraction/site-context";
import type { ExtractionResult } from "../shared/models";

const siteProfilesStorageKey = "gradpath.siteProfiles.v1";

function chromeGet<T>(key: string): Promise<T | undefined> {
  return chrome.storage.local.get(key).then((result) => result[key] as T | undefined);
}

function chromeSet(value: Record<string, unknown>): Promise<void> {
  return chrome.storage.local.set(value);
}

export async function listSiteProfiles(): Promise<SiteProfile[]> {
  return (await chromeGet<SiteProfile[]>(siteProfilesStorageKey)) ?? [];
}

export async function getSiteProfileForUrl(url: string): Promise<SiteProfile | undefined> {
  const { siteKey } = deriveSiteKey(url);
  const profiles = await listSiteProfiles();
  return profiles.find((profile) => profile.siteKey === siteKey);
}

export async function mergeResultIntoSiteProfile(result: ExtractionResult): Promise<SiteProfile> {
  const profiles = await listSiteProfiles();
  const { siteKey } = deriveSiteKey(result.snapshot.url);
  const previous = profiles.find((profile) => profile.siteKey === siteKey);
  const nextProfile = mergeSiteProfile(previous, result);
  const nextProfiles = previous
    ? profiles.map((profile) => (profile.siteKey === siteKey ? nextProfile : profile))
    : [nextProfile, ...profiles];

  await chromeSet({ [siteProfilesStorageKey]: nextProfiles.slice(0, 100) });
  return nextProfile;
}
