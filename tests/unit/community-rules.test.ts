import { describe, expect, it } from "vitest";
import { bundledCommunityRulePack } from "../../src/rules/community/default-pack";
import { fieldRuleMatchesSnapshot, matchCommunityRules } from "../../src/rules/community/matcher";
import type { PageSnapshot } from "../../src/shared/models";

function snapshot(url: string): PageSnapshot {
  return {
    url,
    title: "Open Positions",
    domain: new URL(url).hostname,
    metadata: {},
    jsonLd: [],
    breadcrumbs: [],
    headings: [{ id: "h1", text: "Open Positions", level: 1, headingPath: ["Open Positions"], top: 0 }],
    contentBlocks: [
      {
        id: "b1",
        text: "I am looking for motivated PhD students to join my group.",
        tagName: "p",
        headingPath: ["Open Positions"],
        selectorFingerprint: { tag: "p", semanticClasses: [], relativeIndex: 0 },
        top: 10,
        fontSize: 16,
        fontWeight: 400,
        linkDensity: 0,
        textLength: 58,
        visible: true,
        attributes: {}
      }
    ],
    links: [
      {
        text: "Google Scholar",
        href: "https://scholar.google.com/citations?user=abc",
        isMailto: false,
        selectorFingerprint: { tag: "a", semanticClasses: [], relativeIndex: 0 }
      }
    ],
    emails: [],
    tables: []
  };
}

describe("community rules", () => {
  it("matches domain mappings and adapters", () => {
    const matched = matchCommunityRules(snapshot("https://uehwan.github.io/blog/2024/open-positions-eng/"), [
      bundledCommunityRulePack
    ]);

    expect(matched.domainMappings.some((mapping) => mapping.university === "University of Seoul")).toBe(true);
    expect(matched.adapters.some((adapter) => adapter.id === "github-pages-academic-profile")).toBe(true);
  });

  it("matches adapter field rules against content blocks", () => {
    const matched = matchCommunityRules(snapshot("https://example.github.io/open-positions/"), [bundledCommunityRulePack]);
    const acceptingRule = matched.adapters[0].fields.find((rule) => rule.id === "github-pages-open-positions");

    expect(acceptingRule).toBeDefined();
    expect(fieldRuleMatchesSnapshot(acceptingRule!, snapshot("https://example.github.io/open-positions/"))).toBe(true);
  });
});
