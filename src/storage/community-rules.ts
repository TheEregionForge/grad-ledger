import { bundledCommunityRulePack } from "../rules/community/default-pack";
import type { CommunityRulePack } from "../rules/community/models";

const importedCommunityPacksKey = "gradpath.communityRulePacks.v1";

function chromeGet<T>(key: string): Promise<T | undefined> {
  return chrome.storage.local.get(key).then((result) => result[key] as T | undefined);
}

function chromeSet(value: Record<string, unknown>): Promise<void> {
  return chrome.storage.local.set(value);
}

export async function listCommunityRulePacks(): Promise<CommunityRulePack[]> {
  const imported = (await chromeGet<CommunityRulePack[]>(importedCommunityPacksKey)) ?? [];
  return [bundledCommunityRulePack, ...imported];
}

export async function importCommunityRulePacks(packs: CommunityRulePack[]): Promise<void> {
  const existing = (await chromeGet<CommunityRulePack[]>(importedCommunityPacksKey)) ?? [];
  const merged = new Map(existing.map((pack) => [pack.id, pack]));
  packs.forEach((pack) => merged.set(pack.id, { ...pack, source: "imported" }));
  await chromeSet({ [importedCommunityPacksKey]: Array.from(merged.values()) });
}

export function exportCommunityRulePacks(packs: CommunityRulePack[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: "GradLedger",
      version: 1,
      packs
    },
    null,
    2
  );
}

export function parseCommunityRulePackImport(value: string): CommunityRulePack[] {
  const parsed = JSON.parse(value) as unknown;

  if (Array.isArray(parsed)) {
    return parsed as CommunityRulePack[];
  }

  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { packs?: unknown }).packs)) {
    return (parsed as { packs: CommunityRulePack[] }).packs;
  }

  throw new Error("Import file does not contain community rule packs.");
}
