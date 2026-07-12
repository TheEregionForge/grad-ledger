import type { CommunityRulePack } from "./models";

export const bundledCommunityRulePack: CommunityRulePack = {
  id: "gradpath-bundled-community-rules",
  name: "GradLedger bundled community rules",
  version: "0.1.0",
  updatedAt: "2026-07-11T00:00:00.000Z",
  source: "bundled",
  domainMappings: [
    {
      domainPattern: "*.edu",
      country: "United States",
      aliases: ["university", "college", "institute"]
    },
    {
      domainPattern: "*.edu.au",
      country: "Australia"
    },
    {
      domainPattern: "*.ac.uk",
      country: "United Kingdom"
    },
    {
      domainPattern: "*.ca",
      country: "Canada"
    },
    {
      domainPattern: "*.kaist.ac.kr",
      university: "KAIST",
      country: "South Korea"
    },
    {
      domainPattern: "*.dgist.ac.kr",
      university: "DGIST",
      country: "South Korea"
    },
    {
      domainPattern: "yslim73.wixsite.com",
      university: "DGIST",
      country: "South Korea"
    },
    {
      domainPattern: "*.ualberta.ca",
      university: "University of Alberta",
      country: "Canada"
    },
    {
      domainPattern: "webdocs.cs.ualberta.ca",
      university: "University of Alberta",
      department: "Department of Computing Science",
      country: "Canada"
    },
    {
      domainPattern: "about.uq.edu.au",
      university: "The University of Queensland",
      country: "Australia"
    },
    {
      domainPattern: "*.uwaterloo.ca",
      university: "University of Waterloo",
      country: "Canada"
    },
    {
      domainPattern: "*.sfu.ca",
      university: "Simon Fraser University",
      country: "Canada"
    },
    {
      domainPattern: "*.queensu.ca",
      university: "Queen's University",
      country: "Canada"
    },
    {
      domainPattern: "*.aalto.fi",
      university: "Aalto University",
      country: "Finland"
    },
    {
      domainPattern: "*.tulane.edu",
      university: "Tulane University",
      country: "United States"
    },
    {
      domainPattern: "uehwan.github.io",
      university: "University of Seoul",
      country: "South Korea"
    }
  ],
  relatedLinkPatterns: [
    {
      id: "scholar-link",
      label: "Google Scholar",
      field: "googleScholarUrl",
      urlPattern: "scholar.google.",
      score: 95
    },
    {
      id: "orcid-link",
      label: "ORCID",
      field: "orcidUrl",
      urlPattern: "orcid.org/",
      score: 95
    },
    {
      id: "cv-link",
      label: "CV",
      field: "cvUrl",
      urlPattern: "(cv|curriculum-vitae|resume)",
      anchorPattern: "\\b(cv|curriculum vitae|resume)\\b",
      score: 88
    },
    {
      id: "lab-link",
      label: "Lab",
      field: "labUrl",
      urlPattern: "(lab|group|research)",
      anchorPattern: "\\b(lab|laboratory|group|research group)\\b",
      score: 76
    },
    {
      id: "open-positions-link",
      label: "Open positions",
      field: "openPositionsUrl",
      urlPattern: "(open-positions|positions|join|joining|apply|applying|prospective|intern|vacanc|opening)",
      anchorPattern: "\\b(open positions|positions|join us|how to join|how to apply|apply|applying|prospective students|openings|vacancies|internship)\\b",
      score: 90
    }
  ],
  adapters: [
    {
      id: "academic-join-apply-pages",
      name: "Academic join/apply page signals",
      domainPattern: "*",
      pathPattern: "(apply|join|joining|prospective|openings?|positions?|intern)",
      priority: 12,
      enabled: true,
      fields: [
        {
          id: "join-apply-accepting",
          field: "acceptingStudents",
          value: "accepting",
          source: "content-block",
          textPattern: "\\b(actively recruiting|actively seeking|looking for|we always look for|always looking for|welcomes talents|call for graduate students|openings? for|positions? available|available positions?|hiring .* (msc|master|phd|ph\\.d\\.|student)|funded .*openings?|fully funded .*positions?|year-round openings?|taking on new students|accepting new students|open to supervising|prospective students .* (apply|contact|email|join)|send .*email .*cv|send .*email .*transcript)\\b",
          score: 84,
          enabled: true
        },
        {
          id: "join-apply-not-accepting",
          field: "acceptingStudents",
          value: "not_accepting",
          source: "content-block",
          textPattern: "\\b(no open positions|not accepting|not currently taking on any new students|not taking on any new students|not taking new students|not recruiting|no funded openings|no positions available|no vacancies|unable to take on new students|cannot take new students)\\b",
          score: 96,
          enabled: true
        }
      ]
    },
    {
      id: "github-pages-academic-profile",
      name: "Academic personal site on GitHub Pages",
      domainPattern: "*.github.io",
      priority: 20,
      enabled: true,
      fields: [
        {
          id: "github-pages-open-positions",
          field: "acceptingStudents",
          value: "accepting",
          source: "content-block",
          textPattern: "\\b(open positions|openings|students.*welcome|i am looking for|actively seeking|actively recruiting|call for graduate students|join (my|our) (lab|group)|hiring .* (msc|master|phd|ph\\.d\\.|student))\\b",
          score: 86,
          enabled: true
        },
        {
          id: "github-pages-not-accepting",
          field: "acceptingStudents",
          value: "not_accepting",
          source: "content-block",
          textPattern: "\\b(no open positions|not accepting|not currently taking on any new students|not taking on any new students|not taking new students|not recruiting|no openings|no positions available|no vacancies)\\b",
          score: 96,
          enabled: true
        }
      ]
    }
  ]
};
