import { describe, expect, it } from "vitest";
import { extractPage } from "../../src/extraction/engine";
import type { ContentBlock, HeadingBlock, PageSnapshot } from "../../src/shared/models";

function heading(text: string, level = 1): HeadingBlock {
  return {
    id: `h-${text}`,
    text,
    level,
    headingPath: [text],
    top: 0,
    selectorFingerprint: { tag: `h${level}`, semanticClasses: [], relativeIndex: 0 }
  };
}

function block(text: string, headingPath: string[] = [], top = 100): ContentBlock {
  return {
    id: `b-${Math.random().toString(36).slice(2)}`,
    text,
    tagName: "p",
    headingPath,
    selectorFingerprint: { tag: "p", semanticClasses: [], relativeIndex: 0 },
    top,
    fontSize: 16,
    fontWeight: 400,
    linkDensity: 0,
    textLength: text.length,
    visible: true,
    attributes: {}
  };
}

function snapshot(input: Partial<PageSnapshot> & Pick<PageSnapshot, "url" | "title">): PageSnapshot {
  return {
    domain: new URL(input.url).hostname,
    metadata: {},
    jsonLd: [],
    breadcrumbs: [],
    headings: [],
    contentBlocks: [],
    links: [],
    emails: [],
    tables: [],
    ...input
  };
}

describe("extraction engine calibration rules", () => {
  it("extracts structured directory research labels without overfitting to one person", () => {
    const result = extractPage(
      snapshot({
        url: "https://apps.ualberta.ca/directory/person/example",
        title: "Prof. Osmar Zaiane, PhD - Directory@UAlberta.ca",
        headings: [heading("Prof. Osmar Zaiane, PhD")],
        emails: [{ value: "zaiane@ualberta.ca", source: "visible-text", textContext: "Email zaiane@ualberta.ca" }],
        contentBlocks: [
          block("Professor, Faculty of Science - Computing Science", ["Contact"]),
          block("Research", ["Overview"]),
          block("Areas", ["Overview", "Research"]),
          block("Artificial Intelligence", ["Overview", "Research"]),
          block("Database Systems", ["Overview", "Research"]),
          block("Machine Learning", ["Overview", "Research"]),
          block("Interests", ["Overview", "Research"]),
          block("Data Mining, Web Mining, Text Mining, Machine Learning, Social Network Analysis, Content-Based Information Retrieval, Multimedia.", ["Overview", "Research"])
        ]
      })
    );

    expect(result.fields.name.value).toBe("Osmar Zaiane");
    expect(result.fields.university.value).toBe("University of Alberta");
    expect(String(result.fields.department.value)).toContain("Faculty of Science - Computing Science");
    expect(result.fields.researchInterests.value).toEqual(
      expect.arrayContaining(["Machine Learning", "Data Mining", "Web Mining"])
    );
  });

  it("recognizes generalized join/apply pages and required contact materials", () => {
    const result = extractPage(
      snapshot({
        url: "https://alinlab.kaist.ac.kr/joining_alinlab.html",
        title: "For prospective students and postdocs",
        headings: [heading("For prospective students and postdocs")],
        emails: [{ value: "jinwoos@kaist.ac.kr", source: "visible-text", textContext: "send email" }],
        contentBlocks: [
          block("We always look for graduate or internship students and postdoc collaborators with a strong interest in machine/deep learning.", ["For prospective students and postdocs"]),
          block("If you are interested in joining our lab, send an email to me with your transcript or CV.", ["For prospective students and postdocs"])
        ],
        links: [
          {
            text: "How to Join?",
            href: "https://alinlab.kaist.ac.kr/joining_alinlab.html",
            isMailto: false,
            selectorFingerprint: { tag: "a", semanticClasses: [], relativeIndex: 0 }
          }
        ]
      })
    );

    expect(result.fields.university.value).toBe("KAIST");
    expect(result.fields.acceptingStudents.value).toBe("accepting");
    expect(result.fields.contactInstructions.value).toEqual(
      expect.arrayContaining([expect.stringContaining("transcript")])
    );
    expect(result.fields.openPositionsUrl.value).toBe("https://alinlab.kaist.ac.kr/joining_alinlab.html");
  });

  it("prefers professor-name evidence over possessive home-page titles", () => {
    const result = extractPage(
      snapshot({
        url: "https://example.edu/~jgrundy/",
        title: "John Grundy's Home Page",
        headings: [heading("John Grundy's Home Page")],
        contentBlocks: [
          block("Professor John Grundy is a faculty member in software engineering.", ["About"]),
          block("Monash University Faculty of Information Technology", ["About"])
        ]
      })
    );

    expect(result.fields.name.value).toBe("John Grundy");
    expect(result.fields.university.value).toBe("Monash University");
    expect(result.fields.country.value).toBe("Australia");
  });

  it("captures explicit not-taking-students statements as open-position status", () => {
    const result = extractPage(
      snapshot({
        url: "https://example.edu/~prof/",
        title: "Prospective students",
        headings: [heading("Prospective students")],
        contentBlocks: [
          block("I am not currently taking on any new students.", ["Prospective students"]),
          block("Please check this page later for open positions.", ["Prospective students"])
        ]
      })
    );

    expect(result.fields.acceptingStudents.value).toBe("not_accepting");
    expect(result.fields.acceptingStudents.confidence).toBeGreaterThanOrEqual(95);
    expect(result.fields.openPositionsUrl.value).toBe("https://example.edu/~prof/");
  });

  it("does not mark open-position status complete before evidence is found", () => {
    const result = extractPage(
      snapshot({
        url: "https://example.edu/~quiet/",
        title: "Professor Quiet",
        headings: [heading("Professor Quiet")],
        contentBlocks: [block("Professor Quiet works on software engineering.", ["About"])]
      })
    );

    expect(result.fields.acceptingStudents.value).toBeNull();
    expect(result.fields.acceptingStudents.confidence).toBe(0);
    expect(result.fields.acceptingStudents.status).toBe("missing");
  });

  it("skips placeholder emails while keeping recruiting evidence on lab pages", () => {
    const result = extractPage(
      snapshot({
        url: "https://rebels.cs.uwaterloo.ca/",
        title: "The Software REBELs",
        headings: [heading("The Software REBELs")],
        emails: [
          {
            value: "first_name.family_name@uwaterloo.ca",
            source: "visible-text",
            textContext: "Email: [first_name].[family_name]@uwaterloo.ca"
          }
        ],
        contentBlocks: [
          block("Located at the University of Waterloo.", ["About"]),
          block("Join the rebellion! We are actively recruiting bright and motivated Master's or PhD students.", ["Join the rebellion"]),
          block("Research interests include empirical software engineering, software repositories, and release engineering.", ["Research"])
        ]
      })
    );

    expect(result.pageType).toBe("lab");
    expect(result.fields.university.value).toBe("University of Waterloo");
    expect(result.fields.email.value).toBeNull();
    expect(result.fields.acceptingStudents.value).toBe("accepting");
    expect(result.fields.researchInterests.value).toEqual(
      expect.arrayContaining(["Empirical Software Engineering", "Software Repositories", "Release Engineering"])
    );
  });

  it("captures mixed recruiting pages with subject prefixes and email restrictions", () => {
    const result = extractPage(
      snapshot({
        url: "https://sfu-tai.github.io/joinus",
        title: "Join Us - TAI at SFU",
        headings: [heading("Join Us")],
        emails: [
          {
            value: "director_first_name_director_last_name@sfu.ca",
            source: "visible-text",
            textContext: "[director first name in lowercase]_[director last name in lowercase]@sfu.ca"
          }
        ],
        contentBlocks: [
          block("TAI @ SFU welcomes talents of all levels and has multiple PhD openings and research internship positions.", ["Join Us"]),
          block("The deadline has passed for 2026 PhD/MSc admissions, but research internships are still open.", ["Join Us"]),
          block("Please do not read or respond to individual email inquiry. If you email, use a subject starting with [Seek for PhD], [Seek for Msc], or [Seek for Internship].", ["Contact"]),
          block("Research areas include trustworthy AI, responsible AI, and human-centered AI.", ["Research"])
        ]
      })
    );

    expect(result.pageType).toBe("lab");
    expect(result.fields.university.value).toBe("Simon Fraser University");
    expect(result.fields.email.value).toBeNull();
    expect(result.fields.acceptingStudents.value).toBe("accepting");
    expect(String(result.fields.emailSubjectHint.value)).toContain("Seek for PhD");
    expect(result.fields.contactRestriction.value).toBe("do_not_email");
    expect(result.fields.contactInstructions.value).toEqual(
      expect.arrayContaining([expect.stringContaining("individual email inquiry")])
    );
  });

  it("extracts prospective-student subject phrases and attachment guidance", () => {
    const result = extractPage(
      snapshot({
        url: "https://webdocs.cs.ualberta.ca/~alona/prospective_students.html",
        title: "Instructions for prospective students",
        headings: [heading("Instructions for prospective students")],
        contentBlocks: [
          block("Use the phrase \"Corpus Callosum\" in the subject line so I know you read this page.", ["Prospective students"]),
          block("Master's applicants should use subject \"Potential Master's Student\" and PhD applicants should use subject \"Potential PhD Candidate\".", ["Prospective students"]),
          block("Include GPA, English scores, publications, thesis, CV, and transcript. Do not send zip or rar files; PDFs are preferred.", ["Prospective students"])
        ]
      })
    );

    expect(result.fields.university.value).toBe("University of Alberta");
    expect(String(result.fields.emailSubjectHint.value)).toContain("Corpus Callosum");
    expect(String(result.fields.emailSubjectHint.value)).toContain("Potential Master's Student");
    expect(result.fields.contactInstructions.value).toEqual(
      expect.arrayContaining([expect.stringContaining("zip or rar")])
    );
  });

  it("uses profile domains and topic keywords on noisy university templates", () => {
    const result = extractPage(
      snapshot({
        url: "https://www.cs.queensu.ca/people/Parvin/Mousavi",
        title: "Parvin Mousavi | School of Computing",
        headings: [heading("Parvin Mousavi")],
        emails: [{ value: "parvin.mousavi@queensu.ca", source: "visible-text", textContext: "Email parvin.mousavi@queensu.ca" }],
        contentBlocks: [
          block("Professor / CIFAR AI Chair / Canada Research Chair", ["Profile"]),
          block("Research Areas: Artificial Intelligence and Biomedical Computing.", ["Research Areas"]),
          block("Interests: Machine Learning in Computer Assisted Diagnosis and Interventions, Image-Guided Interventions, Ultrasound Imaging, Medical Image Computing, Computational Biology, Bioinformatics, Systems Biology.", ["Research Areas"])
        ]
      })
    );

    expect(result.fields.name.value).toBe("Parvin Mousavi");
    expect(result.fields.university.value).toBe("Queen's University");
    expect(result.fields.country.value).toBe("Canada");
    expect(result.fields.researchInterests.value).toEqual(
      expect.arrayContaining(["Biomedical Computing", "Medical Image Computing", "Bioinformatics"])
    );
  });

  it("uses a local employment statement over unrelated university mentions", () => {
    const result = extractPage(
      snapshot({
        url: "https://andrewlensen.com/",
        title: "Dr Andrew Lensen",
        headings: [heading("Dr Andrew Lensen")],
        contentBlocks: [
          block("I completed my PhD at the University of Alberta in 2019.", ["About"], 120),
          block(
            "I am a Senior Lecturer in Artificial Intelligence at Te Herenga Waka - Victoria University of Wellington (THW-VUW), Aotearoa/New Zealand.",
            ["About"],
            180
          ),
          block("I currently supervise PhD and MSc students on interdisciplinary AI projects.", ["Students"], 400)
        ]
      })
    );

    expect(result.fields.university.value).toBe("Victoria University of Wellington");
    expect(result.fields.country.value).toBe("New Zealand");
    expect(result.fields.acceptingStudents.value).toBeNull();
  });

  it("recognizes broader explicit availability statements without inferring from a student list", () => {
    const accepting = extractPage(
      snapshot({
        url: "https://example.edu/~prof/openings",
        title: "Openings",
        headings: [heading("Openings")],
        contentBlocks: [block("I am currently accepting PhD applicants for 2027. Please contact me with a CV.", ["Openings"])]
      })
    );
    const unavailable = extractPage(
      snapshot({
        url: "https://example.edu/~prof/",
        title: "Professor Example",
        headings: [heading("Professor Example")],
        contentBlocks: [block("I do not have capacity to supervise additional students this year.", ["Prospective students"])]
      })
    );

    expect(accepting.fields.acceptingStudents.value).toBe("accepting");
    expect(unavailable.fields.acceptingStudents.value).toBe("not_accepting");
  });

  it("leaves a coarse availability status unknown when degree-level statements conflict", () => {
    const result = extractPage(
      snapshot({
        url: "https://example.edu/~prof/students",
        title: "Prospective students",
        headings: [heading("Prospective students")],
        contentBlocks: [
          block("I am not accepting new PhD students this year. I am currently accepting MSc applicants for 2027.", ["Prospective students"])
        ]
      })
    );

    expect(result.fields.acceptingStudents.value).toBe("unknown");
    expect(result.fields.acceptingStudents.status).toBe("ambiguous");
  });
});
