export type PageType =
  | "professor"
  | "program"
  | "lab"
  | "scholarship"
  | "faculty_directory"
  | "unknown"
  | "ambiguous";

export interface PageMetadata {
  description?: string;
  author?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogSiteName?: string;
  twitterTitle?: string;
  faviconUrl?: string;
}

export type JsonLdObject = Record<string, unknown>;

export interface TextBlock {
  id: string;
  text: string;
  selectorFingerprint?: SelectorFingerprint;
}

export interface HeadingBlock extends TextBlock {
  level: number;
  headingPath: string[];
  top: number;
}

export interface SelectorFingerprint {
  tag: string;
  id?: string;
  role?: string;
  itemprop?: string;
  ariaLabel?: string;
  semanticClasses: string[];
  nearestHeading?: string;
  relativeIndex: number;
}

export interface ContentBlock {
  id: string;
  text: string;
  tagName: string;
  headingPath: string[];
  nearbyHeading?: string;
  selectorFingerprint: SelectorFingerprint;
  top: number;
  fontSize: number;
  fontWeight: number;
  linkDensity: number;
  textLength: number;
  visible: boolean;
  attributes: Record<string, string>;
}

export interface PageLink {
  text: string;
  href: string;
  isMailto: boolean;
  selectorFingerprint: SelectorFingerprint;
}

export interface EmailCandidate {
  value: string;
  source: "mailto" | "visible-text" | "jsonld" | "attribute";
  textContext?: string;
  selectorFingerprint?: SelectorFingerprint;
}

export interface TableSnapshot {
  id: string;
  caption?: string;
  headers: string[];
  rows: string[][];
  selectorFingerprint: SelectorFingerprint;
}

export interface PageSnapshot {
  url: string;
  canonicalUrl?: string;
  title: string;
  language?: string;
  domain: string;
  metadata: PageMetadata;
  jsonLd: JsonLdObject[];
  breadcrumbs: TextBlock[];
  headings: HeadingBlock[];
  contentBlocks: ContentBlock[];
  links: PageLink[];
  emails: EmailCandidate[];
  tables: TableSnapshot[];
}

export interface Candidate<T> {
  value: T;
  normalizedValue?: T;
  field: string;
  source:
    | "jsonld"
    | "metadata"
    | "mailto"
    | "heading"
    | "content-block"
    | "breadcrumb"
    | "table"
    | "adapter"
    | "derived";
  sourceUrl: string;
  selector?: SelectorFingerprint;
  snippet?: string;
  headingPath?: string[];
  baseScore: number;
  validationScore: number;
  agreementScore: number;
  finalScore: number;
  warnings: string[];
}

export interface ResolvedField<T> {
  value: T | null;
  confidence: number;
  alternatives: Candidate<T>[];
  evidence: Candidate<T>[];
  status: "confirmed" | "suggested" | "ambiguous" | "missing";
}

export interface ClassificationScore {
  pageType: PageType;
  score: number;
  evidence: string[];
}

export interface ExtractionResult {
  pageType: PageType;
  confidence: number;
  classification: ClassificationScore[];
  fields: Record<string, ResolvedField<unknown>>;
  snapshot: PageSnapshot;
  createdAt: string;
  extractionVersion: string;
  warnings: string[];
  communityRules?: {
    packNames: string[];
    adapterNames: string[];
    domainMappings: string[];
  };
}

export interface SavedRecord {
  id: string;
  type: PageType;
  canonicalUrl: string;
  sourceUrls: string[];
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string;
  extractionVersion: string;
  adapterId?: string;
  fields: Record<string, ResolvedField<unknown>>;
  tags: string[];
  notes: string;
  workflow?: {
    status:
      | "saved"
      | "shortlisted"
      | "contact_planned"
      | "contacted"
      | "replied"
      | "applied"
      | "rejected"
      | "admitted";
    followUpDate?: string;
  };
}
