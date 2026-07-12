import type {
  AdapterFieldRule,
  CommunityRulePack,
  DomainAdapter,
  KnownDomainMapping,
  MatchedCommunityRules,
  RelatedLinkPattern
} from "./models";
import type { PageLink, PageSnapshot } from "../../shared/models";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wildcardToRegex(pattern: string): RegExp {
  const regex = `^${escapeRegex(pattern).replaceAll("\\*", ".*")}$`;
  return new RegExp(regex, "i");
}

export function matchesPattern(value: string, pattern: string | undefined): boolean {
  if (!pattern) {
    return true;
  }

  if (pattern.includes("*")) {
    return wildcardToRegex(pattern).test(value);
  }

  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase());
  }
}

export function safeRegex(pattern: string | undefined): RegExp | null {
  if (!pattern) {
    return null;
  }

  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

export function matchCommunityRules(snapshot: PageSnapshot, packs: CommunityRulePack[]): MatchedCommunityRules {
  const path = new URL(snapshot.url).pathname;
  const enabledPacks = packs;
  const domainMappings: KnownDomainMapping[] = [];
  const adapters: DomainAdapter[] = [];
  const relatedLinkPatterns: RelatedLinkPattern[] = [];

  for (const pack of enabledPacks) {
    domainMappings.push(...pack.domainMappings.filter((mapping) => matchesPattern(snapshot.domain, mapping.domainPattern)));
    adapters.push(
      ...pack.adapters
        .filter((adapter) => adapter.enabled)
        .filter((adapter) => matchesPattern(snapshot.domain, adapter.domainPattern) && matchesPattern(path, adapter.pathPattern))
    );
    relatedLinkPatterns.push(...pack.relatedLinkPatterns);
  }

  return {
    packs: enabledPacks,
    domainMappings,
    adapters: adapters.sort((a, b) => b.priority - a.priority),
    relatedLinkPatterns
  };
}

export function fieldRuleMatchesSnapshot(rule: AdapterFieldRule, snapshot: PageSnapshot): boolean {
  const textPattern = safeRegex(rule.textPattern);
  const headingPattern = safeRegex(rule.headingPattern);
  const urlPattern = safeRegex(rule.urlPattern);

  if (urlPattern && !urlPattern.test(snapshot.url)) {
    return false;
  }

  if (headingPattern && !snapshot.headings.some((heading) => headingPattern.test(heading.text))) {
    return false;
  }

  if (textPattern) {
    return snapshot.contentBlocks.some((block) => textPattern.test(block.text));
  }

  return true;
}

export function linkMatchesPattern(link: PageLink, pattern: RelatedLinkPattern): boolean {
  const urlPattern = safeRegex(pattern.urlPattern);
  const anchorPattern = safeRegex(pattern.anchorPattern);
  const urlMatches = urlPattern ? urlPattern.test(link.href) : true;
  const anchorMatches = anchorPattern ? anchorPattern.test(link.text) : true;

  return urlMatches && anchorMatches;
}
