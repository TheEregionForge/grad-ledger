export interface KnownDomainMapping {
  domainPattern: string;
  university?: string;
  country?: string;
  department?: string;
  aliases?: string[];
}

export interface RelatedLinkPattern {
  id: string;
  label: string;
  field: string;
  urlPattern: string;
  anchorPattern?: string;
  score: number;
}

export interface AdapterFieldRule {
  id: string;
  field: string;
  value?: string;
  source:
    | "domain-mapping"
    | "metadata"
    | "heading"
    | "content-block"
    | "breadcrumb"
    | "link"
    | "table";
  textPattern?: string;
  headingPattern?: string;
  urlPattern?: string;
  score: number;
  enabled: boolean;
}

export interface DomainAdapter {
  id: string;
  name: string;
  domainPattern: string;
  pathPattern?: string;
  priority: number;
  enabled: boolean;
  fields: AdapterFieldRule[];
}

export interface CommunityRulePack {
  id: string;
  name: string;
  version: string;
  updatedAt: string;
  source: "bundled" | "imported" | "local";
  domainMappings: KnownDomainMapping[];
  relatedLinkPatterns: RelatedLinkPattern[];
  adapters: DomainAdapter[];
}

export interface MatchedCommunityRules {
  packs: CommunityRulePack[];
  domainMappings: KnownDomainMapping[];
  adapters: DomainAdapter[];
  relatedLinkPatterns: RelatedLinkPattern[];
}
