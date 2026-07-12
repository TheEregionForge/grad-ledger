import type { ClassificationScore, PageSnapshot, PageType } from "../shared/models";
import { englishRules } from "../rules/languages/en";
import { normalizeForComparison } from "../shared/normalization";
import { looksLikePersonName } from "./validators";

function jsonLdTypes(snapshot: PageSnapshot): string[] {
  return snapshot.jsonLd.flatMap((object) => {
    const type = object["@type"];
    if (Array.isArray(type)) {
      return type.filter((item): item is string => typeof item === "string");
    }
    return typeof type === "string" ? [type] : [];
  });
}

function contentIncludes(snapshot: PageSnapshot, pattern: RegExp): boolean {
  return snapshot.contentBlocks.some((block) => pattern.test(block.text)) || pattern.test(snapshot.title);
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

export function classifyPage(snapshot: PageSnapshot): ClassificationScore[] {
  const types = jsonLdTypes(snapshot);
  const h1 = snapshot.headings.find((heading) => heading.level === 1);
  const allText = normalizeForComparison(
    [snapshot.title, ...snapshot.headings.map((heading) => heading.text), ...snapshot.contentBlocks.slice(0, 80).map((block) => block.text)].join(" ")
  );
  const titleAndHeadings = normalizeForComparison([snapshot.title, ...snapshot.headings.slice(0, 8).map((heading) => heading.text)].join(" "));
  const path = new URL(snapshot.url).pathname.toLowerCase();
  const emailCount = snapshot.emails.length;
  const hasPersonJsonLd = types.includes("Person");
  const hasProgramJsonLd = types.includes("EducationalOccupationalProgram") || types.includes("Course");
  const professorSignals = countMatches(allText, [
    /\b(assistant|associate|full|emeritus|adjunct|visiting|distinguished)?\s*professor\b/i,
    /\b(principal investigator|faculty member|google scholar|dblp|orcid|curriculum vitae|\bcv\b)\b/i,
    /\b(research interests?|publications?|selected publications?)\b/i
  ]);
  const programSignals = countMatches(allText, [
    /\b(admissions?|apply now|how to apply|application deadline|requirements?|tuition|fees?|scholarships?)\b/i,
    /\b(curriculum|course structure|degree requirements?|program requirements?|program overview|study options?)\b/i,
    /\b(undergraduate|graduate|postgraduate|bachelor|master'?s?|msc|m\.sc\.|meng|m\.eng\.|phd|ph\.d\.|doctorate)\b/i,
    /\b(ielts|toefl|gre|credits?|co-?op|duration|start date|international students?)\b/i
  ]);
  const personalPath = /(?:^|\/)(~[^/]+|people|person|profile|faculty|staff|users?)(?:\/|$)/i.test(path);
  const programPath = /(?:^|\/)(programs?|degrees?|graduate|undergraduate|admissions?|courses?|calendar)(?:\/|$)/i.test(path);
  const labPath = /(?:^|\/)(lab|labs|group|research|joinus|join-us|join|positions?|prospectives?)(?:\/|$)/i.test(path);
  const labLikeText = /\b(lab|laboratory|research group|group members|principal investigator|join (our|the) lab|join us|open positions|call for graduate students|actively recruiting|actively seeking|multiple .*openings?|research internship positions?)\b/i.test(allText);
  const hasExplicitAcademicTitle = englishRules.academicTitles.some((title) => allText.includes(title));

  const scores: ClassificationScore[] = [
    { pageType: "professor", score: 0, evidence: [] },
    { pageType: "program", score: 0, evidence: [] },
    { pageType: "faculty_directory", score: 0, evidence: [] },
    { pageType: "lab", score: 0, evidence: [] },
    { pageType: "scholarship", score: 0, evidence: [] }
  ];

  const add = (pageType: PageType, score: number, evidence: string) => {
    const target = scores.find((item) => item.pageType === pageType);
    if (target) {
      target.score += score;
      target.evidence.push(evidence);
    }
  };

  if (hasPersonJsonLd) add("professor", 7, "JSON-LD Person");
  if (h1 && looksLikePersonName(h1.text)) add("professor", 5, "H1 resembles a person name");
  if (hasExplicitAcademicTitle) add("professor", 5, "Academic title detected");
  if (emailCount > 0 && emailCount <= 2) add("professor", 3, "One or two contact emails detected");
  if (/research interests?|publications?|google scholar|orcid|dblp|curriculum vitae|\bcv\b/i.test(allText)) {
    add("professor", 4, "Research or scholar signal detected");
  }
  if (personalPath) add("professor", 2, "Personal/profile URL shape");
  if (professorSignals >= 2) add("professor", 3, "Multiple professor-profile signals");
  if (emailCount > 3) add("professor", -5, "Multiple unrelated emails reduce professor confidence");
  if (programSignals >= 3 && !hasPersonJsonLd) add("professor", -6, "Admissions/program signals reduce professor confidence");
  if (!hasPersonJsonLd && !hasExplicitAcademicTitle && labLikeText) {
    add("professor", -6, "Lab page signals reduce professor confidence");
  }

  if (hasProgramJsonLd) add("program", 8, "JSON-LD educational program");
  if (/\b(program|degree|graduate|undergraduate|postgraduate|master'?s?|phd|ph\.d\.|doctorate|meng|m\.eng\.|masc|msc|m\.sc\.)\b/i.test(titleAndHeadings)) {
    add("program", 5, "Program or degree term in title/H1");
  }
  if (contentIncludes(snapshot, /\b(admission|application|deadline|requirements?|ielts|toefl|gre|tuition|fee)\b/i)) {
    add("program", 6, "Admissions, deadline, requirement, or fee terms detected");
  }
  if (programPath) add("program", 4, "Program/admissions URL shape");
  if (programSignals >= 3) add("program", 5, "Multiple program-page signals");
  if (h1 && looksLikePersonName(h1.text)) add("program", -5, "Person-like H1 reduces program confidence");
  if (professorSignals >= 2 && emailCount <= 2 && personalPath) {
    add("program", -5, "Personal profile signals reduce program confidence");
  }
  if (/\b(lab|laboratory|research group|principal investigator|group members|join (our|the) lab)\b/i.test(allText)) {
    add("program", -4, "Lab/research-group signals reduce program confidence");
  }

  const personLikeHeadings = snapshot.headings.filter((heading) => looksLikePersonName(heading.text)).length;
  if (personLikeHeadings >= 4) add("faculty_directory", 4, "Many person-like headings");
  if (snapshot.emails.length > 3) add("faculty_directory", 3, "More than three email addresses");
  if (/faculty directory|people|our faculty|directory/i.test(snapshot.title)) add("faculty_directory", 4, "Directory term in page title");
  if (snapshot.links.filter((link) => /profile|faculty|people/i.test(link.href)).length >= 4) {
    add("faculty_directory", 4, "Multiple profile links");
  }

  if (/\b(lab|laboratory|research group|group members|principal investigator)\b/i.test(allText)) {
    add("lab", 5, "Lab or research-group terms detected");
  }
  if (/\b(join (our|the) lab|call for graduate students|open positions|research group|principal investigator|group members)\b/i.test(allText)) {
    add("lab", 4, "Lab recruiting or group-membership terms detected");
  }
  if (/\b(join us|actively (recruiting|seeking)|multiple .*openings?|research internship positions?|welcomes talents)\b/i.test(allText)) {
    add("lab", 5, "Lab-style recruiting terms detected");
  }
  if (/\bactively (recruiting|seeking)\b[^.]{0,120}\b(students?|candidates?|phd|ph\.d\.|msc|master'?s?|interns?|postdocs?)\b/i.test(allText)) {
    add("lab", 5, "Active student recruiting detected");
  }
  if (/\b(lab|laboratory|research group|group)\b/i.test(titleAndHeadings)) {
    add("lab", 4, "Lab or group term in title/H1");
  }
  if (labPath) add("lab", 3, "Lab/join/positions URL shape");

  if (types.includes("Scholarship") || /\b(scholarship|fellowship|funding opportunity|award amount)\b/i.test(allText)) {
    add("scholarship", 5, "Scholarship or funding terms detected");
  }

  return scores.sort((a, b) => b.score - a.score);
}

export function decidePageType(scores: ClassificationScore[]): PageType {
  const [top, second] = scores;
  if (!top || top.score < 8) {
    return "unknown";
  }

  if (second && top.score - second.score < 3) {
    return "ambiguous";
  }

  return top.pageType;
}
