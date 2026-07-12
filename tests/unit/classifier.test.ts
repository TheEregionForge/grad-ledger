import { describe, expect, it } from "vitest";
import { classifyPage, decidePageType } from "../../src/extraction/classifier";
import type { PageSnapshot } from "../../src/shared/models";

function baseSnapshot(overrides: Partial<PageSnapshot>): PageSnapshot {
  return {
    url: "https://example.edu/profile/jane-smith",
    title: "Dr. Jane Smith | Example University",
    domain: "example.edu",
    metadata: {},
    jsonLd: [],
    breadcrumbs: [],
    headings: [],
    contentBlocks: [],
    links: [],
    emails: [],
    tables: [],
    ...overrides
  };
}

describe("classifier", () => {
  it("detects a professor profile from deterministic signals", () => {
    const snapshot = baseSnapshot({
      jsonLd: [{ "@type": "Person", name: "Jane Smith" }],
      headings: [{ id: "h1", level: 1, text: "Dr. Jane Smith", headingPath: ["Dr. Jane Smith"], top: 0 }],
      emails: [{ value: "jane@example.edu", source: "mailto" }],
      contentBlocks: [
        {
          id: "b1",
          text: "Associate Professor. Research interests include machine learning.",
          tagName: "p",
          headingPath: ["Research Interests"],
          selectorFingerprint: { tag: "p", semanticClasses: [], relativeIndex: 0 },
          top: 10,
          fontSize: 16,
          fontWeight: 400,
          linkDensity: 0,
          textLength: 68,
          visible: true,
          attributes: {}
        }
      ]
    });

    const scores = classifyPage(snapshot);
    expect(decidePageType(scores)).toBe("professor");
  });

  it("detects a degree program page from admissions and curriculum signals", () => {
    const snapshot = baseSnapshot({
      url: "https://example.edu/graduate/programs/computer-science-msc",
      title: "Computer Science MSc Program | Graduate Admissions",
      headings: [
        { id: "h1", level: 1, text: "Computer Science MSc Program", headingPath: ["Computer Science MSc Program"], top: 0 }
      ],
      contentBlocks: [
        {
          id: "b1",
          text: "Review admissions requirements, tuition fees, application deadlines, IELTS or TOEFL requirements, curriculum, credits, and degree requirements for international students.",
          tagName: "p",
          headingPath: ["Admissions"],
          selectorFingerprint: { tag: "p", semanticClasses: [], relativeIndex: 0 },
          top: 10,
          fontSize: 16,
          fontWeight: 400,
          linkDensity: 0,
          textLength: 151,
          visible: true,
          attributes: {}
        }
      ]
    });

    const scores = classifyPage(snapshot);
    expect(decidePageType(scores)).toBe("program");
  });

  it("keeps a professor homepage as professor even when it mentions graduate students", () => {
    const snapshot = baseSnapshot({
      url: "https://example.edu/~jgrundy/",
      title: "John Grundy's Home Page",
      headings: [
        { id: "h1", level: 1, text: "John Grundy's Home Page", headingPath: ["John Grundy's Home Page"], top: 0 }
      ],
      emails: [{ value: "john.grundy@example.edu", source: "mailto" }],
      contentBlocks: [
        {
          id: "b1",
          text: "Professor John Grundy publishes research in software engineering and supervises PhD students.",
          tagName: "p",
          headingPath: ["About"],
          selectorFingerprint: { tag: "p", semanticClasses: [], relativeIndex: 0 },
          top: 10,
          fontSize: 16,
          fontWeight: 400,
          linkDensity: 0,
          textLength: 89,
          visible: true,
          attributes: {}
        }
      ]
    });

    const scores = classifyPage(snapshot);
    expect(decidePageType(scores)).toBe("professor");
  });
});
