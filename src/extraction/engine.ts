import type { Candidate, ExtractionResult, PageSnapshot, ResolvedField } from "../shared/models";
import { normalizeForComparison, normalizeWhitespace } from "../shared/normalization";
import { englishRules } from "../rules/languages/en";
import { bundledCommunityRulePack } from "../rules/community/default-pack";
import {
  fieldRuleMatchesSnapshot,
  linkMatchesPattern,
  matchCommunityRules
} from "../rules/community/matcher";
import type { CommunityRulePack, MatchedCommunityRules } from "../rules/community/models";
import { classifyPage, decidePageType } from "./classifier";
import { candidate, resolveField } from "./resolver";
import { findUniversitiesInText, findUniversityByDomain, findUniversityByName } from "./university-directory";
import { isAcademicTitle, isLikelyUniversity, looksLikePersonName, normalizePersonName } from "./validators";

const extractionVersion = "phase2-local-rules-0.2.0";

function jsonLdObjects(snapshot: PageSnapshot, typeName: string) {
  return snapshot.jsonLd.filter((object) => {
    const type = object["@type"];
    return type === typeName || (Array.isArray(type) && type.includes(typeName));
  });
}

function candidateAgreement<T>(candidates: Candidate<T>[]): Candidate<T>[] {
  const counts = new Map<string, number>();
  for (const item of candidates) {
    counts.set(String(item.normalizedValue ?? item.value).toLowerCase(), (counts.get(String(item.normalizedValue ?? item.value).toLowerCase()) ?? 0) + 1);
  }

  return candidates.map((item) => {
    const key = String(item.normalizedValue ?? item.value).toLowerCase();
    const bonus = (counts.get(key) ?? 0) > 1 ? 10 : 0;
    return { ...item, agreementScore: item.agreementScore + bonus, finalScore: item.finalScore + bonus };
  });
}

function cleanAcademicNameText(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\b(home'?s?|personal|academic)\s+page\b.*$/i, "")
    .replace(/\b(curriculum vit[ae]|cv|homepage|home page|profile|directory)\b.*$/i, "")
    .replace(/\s*[,|]\s*(ph\.?d\.?|m\.?d\.?|msc|m\.?sc\.?|professor|assistant professor|associate professor)\b.*$/i, "")
    .replace(/\s+[-–—]\s+(professor|assistant professor|associate professor|lecturer|home|homepage|profile)\b.*$/i, "")
    .replace(/'s\b/i, "")
    .trim();
}

function maybePersonNameFromText(value: string): string | null {
  const candidates = [
    cleanAcademicNameText(value),
    cleanAcademicNameText(value.split(/[|–—-]/)[0] ?? ""),
    cleanAcademicNameText(value.split(/,/)[0] ?? "")
  ];
  const match = candidates.find((item) => item && looksLikePersonName(item));
  return match ? normalizePersonName(match) : null;
}

function professorNameFromText(value: string): string | null {
  const titled = value.match(/\b(?:professor|prof\.?|dr\.?)\s+((?:[A-Z][\p{L}'.-]*)(?:\s+[A-Z][\p{L}'.-]*){1,4})\b/u);
  if (titled?.[1]) {
    return maybePersonNameFromText(titled[1]);
  }

  const predicate = value.match(/\b((?:[A-Z][\p{L}'.-]*)(?:\s+[A-Z][\p{L}'.-]*){1,4})\s+(?:is|,)\s+(?:an?\s+)?(?:assistant\s+|associate\s+|full\s+)?professor\b/u);
  return predicate?.[1] ? maybePersonNameFromText(predicate[1]) : null;
}

function blocksNearLabel(snapshot: PageSnapshot, pattern: RegExp, windowSize = 4) {
  return snapshot.contentBlocks.flatMap((block, index, blocks) => {
    if (!pattern.test(block.text)) {
      return [];
    }

    return blocks.slice(index, index + windowSize);
  });
}

const knownInstitutionAliases: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bKAIST\b/i, name: "KAIST" },
  { pattern: /\bDGIST\b/i, name: "DGIST" },
  { pattern: /\bUNIST\b/i, name: "UNIST" },
  { pattern: /\bPOSTECH\b/i, name: "POSTECH" },
  { pattern: /\bMIT\b|Massachusetts Institute of Technology/i, name: "Massachusetts Institute of Technology" },
  { pattern: /\bEPFL\b/i, name: "EPFL" },
  { pattern: /\bETH Zurich\b/i, name: "ETH Zurich" },
  { pattern: /\bCMU\b|Carnegie Mellon University/i, name: "Carnegie Mellon University" }
];

function cleanInstitutionCandidate(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\b(melbourne|australia|canada|england|united kingdom|germany|austria|netherlands|france|south korea|korea|japan|denmark|finland|new zealand|aotearoa)\b.*$/i, "")
    .replace(/\b(about|about me|home|profile|research|publications|contact)\b.*$/i, "")
    .replace(/[.,;:|].*$/, "")
    .trim();
}

function isPlausibleGenericInstitution(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return (
    /\b(?:university|institute|college)\s+of\b/i.test(normalized) ||
    /\b(?:university|institute|college)\b$/i.test(normalized) && wordCount <= 3
  );
}

function extractInstitutionNames(text: string): string[] {
  const names = new Set<string>();
  for (const directoryMatch of findUniversitiesInText(text)) {
    names.add(directoryMatch.name);
  }

  for (const alias of knownInstitutionAliases) {
    if (alias.pattern.test(text)) {
      names.add(alias.name);
    }
  }

  const institutionPattern =
    /\b(?:(?:[A-Z][\p{L}&.'-]*|of|the|and)\s+){0,4}(?:University|Institute|College)(?:\s+(?:of|the|and|[A-Z][\p{L}&.'-]*)){0,5}/gu;
  for (const match of text.matchAll(institutionPattern)) {
    const value = cleanInstitutionCandidate(match[0]);
    if (isLikelyUniversity(value) && isPlausibleGenericInstitution(value) && value.length <= 90) {
      names.add(value);
    }
  }

  return Array.from(names);
}

function universityContextScore(text: string, institution: string): number {
  const escapedInstitution = institution.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const affiliationPattern = new RegExp(
    `\\b(?:i\\s+(?:am|work)|(?:assistant|associate|full|senior)?\\s*(?:professor|lecturer|researcher)|faculty|based|affiliated)\\b[^.]{0,90}\\b(?:at|with|in)\\b[^.]{0,90}${escapedInstitution}`,
    "i"
  );
  const conciseAffiliationPattern = new RegExp(`\\b(?:at|with)\\b[^.]{0,60}${escapedInstitution}`, "i");
  const formerAffiliationPattern = new RegExp(
    `\\b(?:degree|graduat(?:ed|ing)|alumn(?:us|a|i)|former|previously|before\\s+joining|phd|ph\\.d\\.|master'?s?)\\b[^.]{0,90}${escapedInstitution}`,
    "i"
  );

  if (formerAffiliationPattern.test(text)) {
    return -18;
  }
  if (affiliationPattern.test(text)) {
    return 20;
  }
  if (conciseAffiliationPattern.test(text)) {
    return 10;
  }
  return 0;
}

function extractName(snapshot: PageSnapshot): ResolvedField<string> {
  const candidates: Candidate<string>[] = [];

  for (const person of jsonLdObjects(snapshot, "Person")) {
    if (typeof person.name === "string" && looksLikePersonName(person.name)) {
      candidates.push(
        candidate({
          value: normalizePersonName(person.name),
          normalizedValue: normalizePersonName(person.name),
          field: "name",
          source: "jsonld",
          sourceUrl: snapshot.url,
          baseScore: 94,
          validationScore: 5
        })
      );
    }
  }

  const h1 = snapshot.headings.find((heading) => heading.level === 1);
  const h1Name = h1 ? maybePersonNameFromText(h1.text) : null;
  if (h1 && h1Name) {
    candidates.push(
      candidate({
        value: h1Name,
        normalizedValue: h1Name,
        field: "name",
        source: "heading",
        sourceUrl: snapshot.url,
        selector: h1.selectorFingerprint,
        snippet: h1.text,
        headingPath: h1.headingPath,
        baseScore: 88,
        validationScore: 5
      })
    );
  }

  for (const heading of snapshot.headings.slice(0, 8)) {
    const professorName = professorNameFromText(heading.text);
    if (professorName) {
      candidates.push(
        candidate({
          value: professorName,
          normalizedValue: professorName,
          field: "name",
          source: "heading",
          sourceUrl: snapshot.url,
          selector: heading.selectorFingerprint,
          snippet: heading.text,
          headingPath: heading.headingPath,
          baseScore: 93,
          validationScore: 5
        })
      );
    }
  }

  for (const block of snapshot.contentBlocks.slice(0, 25)) {
    const professorName = professorNameFromText(block.text);
    if (professorName) {
      candidates.push(
        candidate({
          value: professorName,
          normalizedValue: professorName,
          field: "name",
          source: "content-block",
          sourceUrl: snapshot.url,
          selector: block.selectorFingerprint,
          snippet: block.text,
          headingPath: block.headingPath,
          baseScore: block.top < 1200 ? 91 : 78,
          validationScore: 5
        })
      );
    }
  }

  const titleName = maybePersonNameFromText(snapshot.title);
  if (titleName) {
    candidates.push(
      candidate({
        value: titleName,
        normalizedValue: titleName,
        field: "name",
        source: "metadata",
        sourceUrl: snapshot.url,
        snippet: snapshot.title,
        baseScore: 65,
        validationScore: 5
      })
    );
  }

  return resolveField(candidateAgreement(candidates));
}

function isPlaceholderEmailValue(value: string, context = ""): boolean {
  const normalized = `${value} ${context}`.toLowerCase();
  return (
    /\b(first|last|family|given|director|your|user)[_\s.-]*(name|surname)\b/.test(normalized) ||
    /\b(firstname|lastname|familyname|yourname|username)\b/.test(normalized) ||
    /\b(example|domain|email|name)@(?:example|domain)\./.test(normalized) ||
    /\[(?:director|first|last|family|name|surname)[^\]]*\]/.test(normalized)
  );
}

function extractEmail(snapshot: PageSnapshot): ResolvedField<string> {
  const candidates = snapshot.emails.filter((email) => !isPlaceholderEmailValue(email.value, email.textContext)).map((email) =>
    candidate({
      value: email.value,
      normalizedValue: email.value.toLowerCase(),
      field: "email",
      source: email.source === "mailto" ? "mailto" : email.source === "jsonld" ? "jsonld" : "content-block",
      sourceUrl: snapshot.url,
      selector: email.selectorFingerprint,
      snippet: email.textContext,
      baseScore: email.source === "mailto" ? 98 : email.source === "jsonld" ? 94 : 76,
      validationScore: 5
    })
  );

  return resolveField(candidateAgreement(candidates));
}

function extractUniversity(snapshot: PageSnapshot, communityRules: MatchedCommunityRules): ResolvedField<string> {
  const candidates: Candidate<string>[] = [];
  const directoryDomainMatch = findUniversityByDomain(snapshot.domain);
  if (directoryDomainMatch) {
    candidates.push(
      candidate({
        value: directoryDomainMatch.name,
        normalizedValue: normalizeForComparison(directoryDomainMatch.name),
        field: "university",
        source: "adapter",
        sourceUrl: snapshot.url,
        snippet: `Known university domain: ${snapshot.domain}`,
        baseScore: 96,
        validationScore: 5
      })
    );
  }

  for (const mapping of communityRules.domainMappings) {
    if (mapping.university) {
      candidates.push(
        candidate({
          value: mapping.university,
          normalizedValue: normalizeForComparison(mapping.university),
          field: "university",
          source: "adapter",
          sourceUrl: snapshot.url,
          snippet: `Known domain mapping: ${mapping.domainPattern}`,
          baseScore: 90,
          validationScore: isLikelyUniversity(mapping.university) ? 5 : 0
        })
      );
    }
  }

  for (const person of jsonLdObjects(snapshot, "Person")) {
    const affiliation = person.affiliation;
    const affiliations = Array.isArray(affiliation) ? affiliation : [affiliation];

    for (const item of affiliations) {
      if (item && typeof item === "object") {
        const name = (item as { name?: unknown }).name;
        if (typeof name === "string" && isLikelyUniversity(name)) {
          candidates.push(
            candidate({
              value: normalizeWhitespace(name),
              normalizedValue: normalizeForComparison(name),
              field: "university",
              source: "jsonld",
              sourceUrl: snapshot.url,
              baseScore: 94,
              validationScore: 5
            })
          );
        }
      }
    }
  }

  for (const object of snapshot.jsonLd) {
    const type = object["@type"];
    const typeList = Array.isArray(type) ? type : [type];
    if (typeList.some((item) => item === "CollegeOrUniversity" || item === "EducationalOrganization" || item === "Organization")) {
      const name = object.name;
      if (typeof name === "string" && isLikelyUniversity(name)) {
        candidates.push(
          candidate({
            value: normalizeWhitespace(name),
            normalizedValue: normalizeForComparison(name),
            field: "university",
            source: "jsonld",
            sourceUrl: snapshot.url,
            baseScore: 94,
            validationScore: 5
          })
        );
      }
    }
  }

  const metadataUniversity = snapshot.metadata.ogSiteName;
  if (metadataUniversity && isLikelyUniversity(metadataUniversity)) {
    candidates.push(
      candidate({
        value: normalizeWhitespace(metadataUniversity),
        normalizedValue: normalizeForComparison(metadataUniversity),
        field: "university",
        source: "metadata",
        sourceUrl: snapshot.url,
        snippet: metadataUniversity,
        baseScore: 70,
        validationScore: 5
      })
    );
  }

  // Keep each affiliation mention local. Joining the page into one string makes an
  // old degree or a footer university look as strong as the person's employer.
  const institutionSources: Array<{
    text: string;
    source: "metadata" | "heading" | "content-block";
    baseScore: number;
    selector?: Candidate<string>["selector"];
    headingPath?: string[];
  }> = [
    { text: snapshot.title, source: "metadata", baseScore: 56 },
    { text: snapshot.metadata.ogTitle ?? "", source: "metadata", baseScore: 54 },
    { text: snapshot.metadata.ogDescription ?? "", source: "metadata", baseScore: 58 },
    { text: snapshot.metadata.description ?? "", source: "metadata", baseScore: 56 },
    ...snapshot.headings.slice(0, 12).map((heading) => ({
      text: heading.text,
      source: "heading" as const,
      baseScore: heading.level === 1 ? 76 : 68,
      selector: heading.selectorFingerprint,
      headingPath: heading.headingPath
    })),
    ...snapshot.contentBlocks.slice(0, 80).map((block) => ({
      text: block.text,
      source: "content-block" as const,
      baseScore: block.top < 1400 ? 78 : 70,
      selector: block.selectorFingerprint,
      headingPath: block.headingPath
    }))
  ];

  for (const source of institutionSources) {
    if (!source.text) {
      continue;
    }

    for (const value of extractInstitutionNames(source.text)) {
      const directoryMatch = findUniversityByName(value);
      const resolvedValue = directoryMatch?.name ?? value;
      const score = source.baseScore + (directoryMatch ? 8 : 0) + universityContextScore(source.text, resolvedValue);
      candidates.push(
        candidate({
          value: resolvedValue,
          normalizedValue: normalizeForComparison(resolvedValue),
          field: "university",
          source: directoryMatch ? "adapter" : source.source,
          sourceUrl: snapshot.url,
          selector: source.selector,
          snippet: source.text,
          headingPath: source.headingPath,
          baseScore: Math.max(35, Math.min(95, score)),
          validationScore: directoryMatch ? 5 : 3
        })
      );
    }
  }

  for (const breadcrumb of snapshot.breadcrumbs) {
    if (isLikelyUniversity(breadcrumb.text)) {
      candidates.push(
        candidate({
          value: normalizeWhitespace(breadcrumb.text),
          normalizedValue: normalizeForComparison(breadcrumb.text),
          field: "university",
          source: "breadcrumb",
          sourceUrl: snapshot.url,
          selector: breadcrumb.selectorFingerprint,
          snippet: breadcrumb.text,
          baseScore: 76,
          validationScore: 5
        })
      );
    }
  }

  return resolveField(candidateAgreement(candidates));
}

function extractDepartment(snapshot: PageSnapshot, communityRules: MatchedCommunityRules): ResolvedField<string> {
  const candidates: Candidate<string>[] = [];
  const departmentPattern = /\b(department|school|faculty|college)\s+of\s+[\p{L}&,\-\s]+/giu;
  const facultyDashPattern = /\bFaculty of [\p{L}&,\-\s]+ - [\p{L}&,\-\s]+/giu;

  for (const mapping of communityRules.domainMappings) {
    if (mapping.department) {
      candidates.push(
        candidate({
          value: mapping.department,
          normalizedValue: normalizeForComparison(mapping.department),
          field: "department",
          source: "adapter",
          sourceUrl: snapshot.url,
          snippet: `Known domain mapping: ${mapping.domainPattern}`,
          baseScore: 88,
          validationScore: 4
        })
      );
    }
  }

  for (const block of snapshot.contentBlocks.slice(0, 80)) {
    for (const match of [...block.text.matchAll(departmentPattern), ...block.text.matchAll(facultyDashPattern)]) {
      const value = normalizeWhitespace(match[0]).replace(/[.,;:]$/, "");
      candidates.push(
        candidate({
          value,
          normalizedValue: normalizeForComparison(value),
          field: "department",
          source: "content-block",
          sourceUrl: snapshot.url,
          selector: block.selectorFingerprint,
          snippet: block.text,
          headingPath: block.headingPath,
          baseScore: block.headingPath.length ? 84 : 70,
          validationScore: 4
        })
      );
    }
  }

  return resolveField(candidateAgreement(candidates));
}

function extractAcademicTitle(snapshot: PageSnapshot): ResolvedField<string> {
  const candidates: Candidate<string>[] = [];
  const blocks = snapshot.contentBlocks.slice(0, 30);

  for (const block of blocks) {
    const title = isAcademicTitle(block.text, englishRules.academicTitles);
    if (title) {
      candidates.push(
        candidate({
          value: title.replace(/\b\w/g, (char) => char.toUpperCase()),
          normalizedValue: title,
          field: "academicTitle",
          source: "content-block",
          sourceUrl: snapshot.url,
          selector: block.selectorFingerprint,
          snippet: block.text,
          headingPath: block.headingPath,
          baseScore: block.top < 900 ? 86 : 74,
          validationScore: 5
        })
      );
    }
  }

  return resolveField(candidateAgreement(candidates));
}

function extractResearchInterests(snapshot: PageSnapshot): ResolvedField<string[]> {
  const candidates: Candidate<string[]>[] = [];
  const researchBlocks = snapshot.contentBlocks.filter((block) =>
    block.headingPath.some((heading) => /research|interests|areas|projects|topics|focus|about/i.test(heading)) ||
    /^(areas?|interests?|research interests?)$/i.test(block.text)
  );
  const topicPattern =
    /\b(machine learning|deep learning|computer vision|natural language processing|nlp|robotics|human-computer interaction|hci|security|privacy|systems|wireless|networks|embedded systems|embedded ai|on-device machine learning|neural networks?|large language models?|llms?|multi-?modal learning|multimodal foundation models?|foundation models?|signal processing|bioinformatics|medical imaging|medical image computing|biomedical computing|computer-assisted diagnosis|image-guided interventions?|ultrasound imaging|computational biology|systems biology|healthcare|data science|data mining|web mining|text mining|social network analysis|social computing|computational social science|information retrieval|multimedia|artificial intelligence|ai|trustworthy ai|responsible ai|human-centered ai|reinforcement learning|rl|optimization|computer graphics|visualization|visual ai|generative modeling|generative ai|protein generation|biological data generation|spatial intelligence|software engineering|empirical software engineering|software analytics|software repository mining|software repositories|release engineering|build engineering|programming languages|formal verification|formal methods|proof assistants?|probabilistic programming|program analysis|compilers?|debugging|testing|fuzz testing|quantum computing|heterogeneous computing|fpga|databases?|database systems|distributed systems|edge computing|internet of things|iot|cyber-physical systems|heuristic search|path ?finding|multi-agent path ?finding|game ai)\b/gi;

  if (researchBlocks.length) {
    const explicitTopics = new Set<string>();
    for (const block of researchBlocks) {
      for (const match of block.text.matchAll(topicPattern)) {
        explicitTopics.add(match[0].replace(/\b\w/g, (char) => char.toUpperCase()));
      }
    }
    const values = (explicitTopics.size >= 2 ? Array.from(explicitTopics) : researchBlocks
      .slice(0, 5)
      .map((block) => block.text)
      .filter((text) => !/^(areas?|interests?|research interests?)$/i.test(text))
      .filter((text) => !/publication|journal|conference|copyright/i.test(text))
      .slice(0, 3));

    if (values.length) {
      candidates.push(
        candidate({
          value: values,
          normalizedValue: values.map(normalizeForComparison),
          field: "researchInterests",
          source: "content-block",
          sourceUrl: snapshot.url,
          selector: researchBlocks[0].selectorFingerprint,
          snippet: values.join(" "),
          headingPath: researchBlocks[0].headingPath,
          baseScore: 84,
          validationScore: 4
        })
      );
    }
  }

  const labelNeighborhood = blocksNearLabel(snapshot, /^(areas?|interests?|research interests?)$/i, 8);
  const topicMatches = new Set<string>();
  const topicBlocks = labelNeighborhood.length > 0 ? labelNeighborhood : snapshot.contentBlocks;
  for (const block of topicBlocks) {
    for (const match of block.text.matchAll(topicPattern)) {
      topicMatches.add(match[0].replace(/\b\w/g, (char) => char.toUpperCase()));
    }
  }

  if (topicMatches.size > 0) {
    const values = Array.from(topicMatches).slice(0, 10);
    candidates.push(
      candidate({
        value: values,
        normalizedValue: values.map(normalizeForComparison),
        field: "researchInterests",
        source: "derived",
        sourceUrl: snapshot.url,
        snippet: values.join("; "),
        baseScore: researchBlocks.length || labelNeighborhood.length ? 74 : 58,
        validationScore: 4,
        warnings: researchBlocks.length || labelNeighborhood.length ? [] : ["Research topics inferred from keyword matches."]
      })
    );
  }

  return resolveField(candidateAgreement(candidates));
}

function extractContactInstructions(snapshot: PageSnapshot): ResolvedField<string[]> {
  const candidates: Candidate<string[]>[] = [];
  const instructionPatterns = [
    /\b(use|include|put|write)\b[^.]{0,80}\b(subject|subject line|email subject)\b[^.]{0,120}/gi,
    /\bsubject(?: line)?\b[^.]{0,80}\b(starting with|starts with|include|contains?|phrase|words?)\b[^.]{0,120}/gi,
    /\bdo not (send|email|contact)\b[^.]{0,120}/gi,
    /\bdo not (?:read|respond to|reply to)\b[^.]{0,120}\b(email|emails?|inquir(?:y|ies))\b[^.]{0,80}/gi,
    /\bplease (do not|avoid)\b[^.]{0,120}\b(email|contact|send)\b[^.]{0,80}/gi,
    /\b(?:cannot|can't|may not|will not)\s+(?:reply|respond)\s+to\s+(?:every|all|individual)\s+[^.]{0,100}/gi,
    /\b(contact|email)\b[^.]{0,80}\b(with|using)\b[^.]{0,80}\b(subject|title)\b[^.]{0,80}/gi,
    /\b(send|submit|apply)\b[^.]{0,120}\b(cv|resume|transcript|statement|portfolio)\b[^.]{0,80}/gi,
    /\b(send|email|e-mail|contact)\b[^.]{0,120}\b(with|including)\b[^.]{0,120}\b(following information|materials?|documents?|cv|resume|transcript|statement|portfolio)\b[^.]{0,80}/gi,
    /\b(only|must)\b[^.]{0,80}\b(through|via)\b[^.]{0,80}\b(form|portal|application system|google form)\b[^.]{0,80}/gi,
    /\b(apply|submit)\b[^.]{0,80}\b(through|via|using)\b[^.]{0,80}\b(form|portal|application system|official application)\b[^.]{0,80}/gi,
    /\bdo not\b[^.]{0,80}\b(zip|rar|archive files?)\b[^.]{0,80}/gi,
    /\b(prefer|preferred|please send)\b[^.]{0,80}\b(pdf|pdfs)\b[^.]{0,80}/gi,
    /\b(drop us a line|feel free to email|please email|please contact)\b[^.]{0,100}/gi
  ];
  const documentPattern = /\b(cv|resume|transcript|degree certificates?|statement of purpose|research statement|portfolio|publication list|recommendation letters?|referees?|writing sample)\b/gi;

  for (const block of snapshot.contentBlocks) {
    const values = new Set<string>();
    for (const pattern of instructionPatterns) {
      for (const match of block.text.matchAll(pattern)) {
        values.add(normalizeWhitespace(match[0]).replace(/[;,.]\s*$/, ""));
      }
    }

    const headingIsApplication = block.headingPath.some((heading) => /apply|join|prospective|position|opening|student|intern|postdoc/i.test(heading));
    const mentionedDocuments = Array.from(block.text.matchAll(documentPattern)).map((match) => match[0].toLowerCase());
    if ((headingIsApplication || /\b(apply|join|prospective|opening|internship)\b/i.test(block.text)) && mentionedDocuments.length > 0) {
      values.add(`Prepare: ${Array.from(new Set(mentionedDocuments)).join(", ")}`);
    }

    if (values.size > 0) {
      candidates.push(
        candidate({
          value: Array.from(values).slice(0, 5),
          normalizedValue: Array.from(values).map(normalizeForComparison),
          field: "contactInstructions",
          source: "content-block",
          sourceUrl: snapshot.url,
          selector: block.selectorFingerprint,
          snippet: block.text,
          headingPath: block.headingPath,
          baseScore: block.headingPath.some((heading) => /contact|apply|position|student|intern/i.test(heading)) ? 90 : 76,
          validationScore: 5
        })
      );
    }
  }

  const aggregateValues = Array.from(
    new Set(candidates.flatMap((item) => item.value.map((value) => normalizeWhitespace(String(value))).filter(Boolean)))
  ).slice(0, 8);
  if (aggregateValues.length > 1) {
    candidates.push(
      candidate({
        value: aggregateValues,
        normalizedValue: aggregateValues.map(normalizeForComparison),
        field: "contactInstructions",
        source: "derived",
        sourceUrl: snapshot.url,
        snippet: aggregateValues.join("; "),
        baseScore: 94,
        validationScore: 5
      })
    );
  }

  return resolveField(candidateAgreement(candidates));
}

function extractEmailSubjectHint(snapshot: PageSnapshot): ResolvedField<string> {
  const candidates: Candidate<string>[] = [];
  const subjectPatterns = [
    /subject(?: line)?\s*[:：]\s*["“]?([^"”\n.]{3,80})/i,
    /(?:use|include|put|write)[^.]{0,60}(?:subject|email subject)[^.]{0,40}["“]([^"”]{3,80})["”]/i
  ];

  for (const block of snapshot.contentBlocks) {
    for (const pattern of subjectPatterns) {
      const match = block.text.match(pattern);
      if (match?.[1]) {
        const value = normalizeWhitespace(match[1]);
        candidates.push(
          candidate({
            value,
            normalizedValue: normalizeForComparison(value),
            field: "emailSubjectHint",
            source: "content-block",
            sourceUrl: snapshot.url,
            selector: block.selectorFingerprint,
            snippet: block.text,
            headingPath: block.headingPath,
            baseScore: 92,
            validationScore: 5
          })
        );
      }
    }
  }

  return resolveField(candidateAgreement(candidates));
}

function extractEmailSubjectHintAdvanced(snapshot: PageSnapshot): ResolvedField<string> {
  const candidates: Candidate<string>[] = [];
  const subjectPatterns = [
    /subject(?: line)?\s*[:：]\s*["“]?([^"”\n.]{3,80})/i,
    /(?:use|include|put|write)[^.]{0,60}(?:subject|email subject|subject line)[^.]{0,60}["“]([^"”]{3,80})["”]/i,
    /(?:subject|subject line|email subject)[^.]{0,80}(?:starting with|starts with|include|contains?|phrase|words?)[^.]{0,40}(?:`([^`]{3,80})`|"([^"]{3,80})"|“([^”]{3,80})”|\[([^\]]{3,80})\])/i
  ];

  for (const block of snapshot.contentBlocks) {
    const values = new Set<string>();
    for (const pattern of subjectPatterns) {
      const match = block.text.match(pattern);
      const value = match?.slice(1).find((item) => item);
      if (value) {
        values.add(normalizeWhitespace(value));
      }
    }

    if (/\bsubject(?: line)?\b/i.test(block.text)) {
      for (const match of block.text.matchAll(/(?:`([^`]{3,80})`|"([^"]{3,80})"|“([^”]{3,80})”|\[([^\]]{3,80})\])/g)) {
        const value = match.slice(1).find((item) => item);
        if (value && !/^\s*(at|dot|email)\s*$/i.test(value)) {
          values.add(normalizeWhitespace(value));
        }
      }
    }

    if (values.size > 0) {
      const value = Array.from(values).slice(0, 5).join("; ");
      candidates.push(
        candidate({
          value,
          normalizedValue: normalizeForComparison(value),
          field: "emailSubjectHint",
          source: "content-block",
          sourceUrl: snapshot.url,
          selector: block.selectorFingerprint,
          snippet: block.text,
          headingPath: block.headingPath,
          baseScore: 92,
          validationScore: 5
        })
      );
    }
  }

  const aggregateValues = Array.from(
    new Set(candidates.flatMap((item) => item.value.split(";").map((part) => normalizeWhitespace(part)).filter(Boolean)))
  ).slice(0, 6);
  if (aggregateValues.length > 1) {
    candidates.push(
      candidate({
        value: aggregateValues.join("; "),
        normalizedValue: aggregateValues.map(normalizeForComparison).join(";"),
        field: "emailSubjectHint",
        source: "derived",
        sourceUrl: snapshot.url,
        snippet: aggregateValues.join("; "),
        baseScore: 96,
        validationScore: 5
      })
    );
  }

  const advanced = resolveField(candidateAgreement(candidates));
  if (advanced.value) {
    return advanced;
  }

  return extractEmailSubjectHint(snapshot);
}

function extractDoNotEmail(snapshot: PageSnapshot): ResolvedField<string> {
  const candidates: Candidate<string>[] = [];
  const pattern = /\b(do not email|do not contact|please do not email|no email inquiries|emails? will not be answered|do not read or respond to individual email inquir(?:y|ies)|do not send a contact email|cannot reply to every query|cannot respond to every query|cannot reply to all candidates?|cannot contact all candidates?)\b/i;

  for (const block of snapshot.contentBlocks) {
    const match = block.text.match(pattern);
    if (match) {
      candidates.push(
        candidate({
          value: "do_not_email",
          normalizedValue: "do_not_email",
          field: "contactRestriction",
          source: "content-block",
          sourceUrl: snapshot.url,
          selector: block.selectorFingerprint,
          snippet: block.text,
          headingPath: block.headingPath,
          baseScore: 96,
          validationScore: 5
        })
      );
    }
  }

  return resolveField(candidateAgreement(candidates));
}

function extractCountry(
  snapshot: PageSnapshot,
  communityRules: MatchedCommunityRules,
  university: ResolvedField<string>
): ResolvedField<string> {
  const candidates: Candidate<string>[] = [];

  const directoryDomainMatch = findUniversityByDomain(snapshot.domain);
  const directoryUniversityMatch = typeof university.value === "string" ? findUniversityByName(university.value) : null;
  const directoryMatch = directoryUniversityMatch ?? directoryDomainMatch;
  if (directoryMatch) {
    candidates.push(
      candidate({
        value: directoryMatch.country,
        normalizedValue: normalizeForComparison(directoryMatch.country),
        field: "country",
        source: "adapter",
        sourceUrl: snapshot.url,
        snippet: `Country from university directory: ${directoryMatch.name}`,
        baseScore: 94,
        validationScore: 5
      })
    );
  }

  for (const mapping of communityRules.domainMappings) {
    if (mapping.country) {
      candidates.push(
        candidate({
          value: mapping.country,
          normalizedValue: normalizeForComparison(mapping.country),
          field: "country",
          source: "adapter",
          sourceUrl: snapshot.url,
          snippet: `Known domain mapping: ${mapping.domainPattern}`,
          baseScore: mapping.university ? 86 : 72,
          validationScore: 3
        })
      );
    }
  }

  return resolveField(candidateAgreement(candidates));
}

function splitAvailabilityStatements(text: string): string[] {
  return normalizeWhitespace(text)
    .replace(/\bph\.d\./gi, "PhD")
    .replace(/\bm\.sc\./gi, "MSc")
    .split(/(?<=[.!?])\s+(?=[A-Z\[\"])/)
    .filter((statement) => statement.length >= 8);
}

function extractAcceptingStudents(snapshot: PageSnapshot, communityRules: MatchedCommunityRules): ResolvedField<string> {
  const candidates: Candidate<string>[] = [];
  const explicitStatusCandidates: Candidate<string>[] = [];
  const negativeStatusPatterns = [
    /\bnot\s+(?:currently\s+)?(?:taking|accepting|recruiting|looking for|supervising)\s+(?:on\s+)?(?:any\s+)?(?:new\s+)?(?:phd|ph\.d\.|msc|master'?s?|graduate|undergraduate|research\s+)?students?\b/i,
    /\b(?:i|we|the lab|my lab)\s+(?:am|are|is)\s+not\s+(?:currently\s+)?(?:taking|accepting|recruiting|looking for|supervising)\s+(?:on\s+)?(?:any\s+)?(?:new\s+)?students?\b/i,
    /\b(?:i|we|the lab|my lab)\s+(?:am|are|is)\s+(?:not\s+)?(?:currently\s+)?(?:not\s+)?admitting\s+(?:new\s+)?(?:phd|ph\.d\.|msc|master'?s?|graduate)?\s*students?\b/i,
    /\b(?:i|we|the lab|my lab)\s+(?:do|does)\s+not\s+have\s+(?:the\s+)?capacity\s+to\s+(?:supervise|take on|accept)\b/i,
    /\b(?:not|no longer|will not be)\s+(?:accepting|taking|recruiting|supervising)\b/i,
    /\b(?:no|not any)\s+(?:open\s+)?(?:positions?|openings?|vacanc(?:y|ies)|funded openings?)\b/i,
    /\b(?:no|not any)\s+(?:phd|ph\.d\.|msc|master'?s?|graduate|undergraduate|internship|postdoc)\s+(?:positions?|openings?)\b/i,
    /\b(?:unable|not able|cannot|can't)\s+to\s+(?:take|accept|supervise)\s+(?:on\s+)?(?:new\s+)?students?\b/i,
    /\b(?:all|the)\s+(?:available\s+)?(?:positions?|openings?)\s+(?:are|have been)\s+(?:filled|taken)\b/i,
    /\b(?:lab|group)\s+(?:is\s+)?full\b/i
  ];
  const positiveStatusPatterns = [
    /\bactively\s+(?:recruiting|seeking)\b[^.]{0,120}\b(?:students?|candidates?|phd|ph\.d\.|msc|master'?s?|interns?|postdocs?)\b/i,
    /\b(?:taking|accepting|recruiting|looking for|seeking|supervising)\s+(?:on\s+)?(?:new\s+)?(?:phd|ph\.d\.|msc|master'?s?|graduate|undergraduate|research\s+)?students?\b/i,
    /\b(?:currently\s+)?accepting\s+(?:(?:phd|ph\.d\.|msc|master'?s?|graduate)\s+)?(?:applications?|applicants?|candidates?)\b/i,
    /\b(?:interested|prospective)\s+(?:phd|ph\.d\.|msc|master'?s?|graduate)?\s*students?\b[^.]{0,100}\b(?:contact|email|apply|join)\b/i,
    /\b(?:welcomes?|invites?)\b[^.]{0,100}\b(?:students?|candidates?|talents?|applicants?)\b[^.]{0,80}\b(?:join|apply|contact|work)\b/i,
    /\bcall\s+for\s+graduate\s+students?\b/i,
    /\byear-?round\s+openings?\b/i,
    /\bhiring\b[^.]{0,100}\b(?:phd|ph\.d\.|msc|master'?s?|graduate|undergraduate|interns?|postdocs?|students?)\b/i,
    /\bmultiple\b[^.]{0,80}\b(?:phd|ph\.d\.|msc|master'?s?|internship|postdoc)\b[^.]{0,80}\b(?:positions?|openings?)\b/i,
    /\bfully\s+funded\b[^.]{0,80}\b(?:phd|ph\.d\.|msc|master'?s?|postdoctoral)\b[^.]{0,80}\b(?:positions?|openings?)\b/i,
    /\b(?:available|funded)\s+(?:phd|ph\.d\.|msc|master'?s?|graduate|undergraduate|internship|postdoc)?\s*(?:positions?|openings?|vacanc(?:y|ies))\b/i,
    /\b(?:positions?|openings?)\s+(?:are\s+)?available\b/i,
    /\b(?:applications?|inquiries)\s+(?:are\s+)?welcome\b/i,
    /\b(?:students?|applicants?|candidates?)\s+(?:are\s+)?(?:welcome|encouraged)\s+to\s+(?:apply|contact|join)\b/i,
    /\b(?:join|joining)\s+(?:my|our|the)\s+(?:lab|group|team)\b/i,
    /\bopen\s+to\s+supervis(?:e|ing)\b/i
  ];

  for (const adapter of communityRules.adapters) {
    for (const rule of adapter.fields.filter((fieldRule) => fieldRule.enabled && fieldRule.field === "acceptingStudents")) {
      if (rule.value && fieldRuleMatchesSnapshot(rule, snapshot)) {
        candidates.push(
          candidate({
            value: rule.value,
            normalizedValue: rule.value,
            field: "acceptingStudents",
            source: "adapter",
            sourceUrl: snapshot.url,
            snippet: `${adapter.name}: ${rule.id}`,
            baseScore: rule.score,
            validationScore: 5
          })
        );
      }
    }
  }

  for (const block of snapshot.contentBlocks) {
    const contextIsApplication =
      block.headingPath.some((heading) => /apply|join|prospective|opening|position|student|intern|postdoc/i.test(heading)) ||
      /apply|join|prospective|opening|position|student|intern|postdoc/i.test(snapshot.title);
    for (const statement of splitAvailabilityStatements(block.text)) {
      const lowered = statement.toLowerCase();
      const negative = englishRules.acceptingNegative.find((phrase) => lowered.includes(phrase));
      const positive = englishRules.acceptingPositive.find((phrase) => lowered.includes(phrase));
      const negativeMatch = negativeStatusPatterns.find((pattern) => pattern.test(statement));
      const positiveMatch = positiveStatusPatterns.find((pattern) => pattern.test(statement));
      const structuredPositive =
        /\b(looking for|seeking|recruiting|openings? for|funded)\b[^.]{0,100}\b(phd|ph\.d\.|m\.s\.|ms|master'?s?|graduate|undergraduate|interns?|postdocs?|students?|candidates?)\b/i.test(statement) ||
        /\b(funded|available|fully funded|multiple)\b[^.]{0,80}\b(phd|ph\.d\.|master'?s?|msc|graduate|internship|postdoctoral)\b[^.]{0,80}\b(openings?|positions?)\b/i.test(statement) ||
        /\b(hiring|welcomes?|invites?)\b[^.]{0,100}\b(phd|ph\.d\.|m\.s\.|ms|master'?s?|graduate|undergraduate|interns?|postdocs?|students?|candidates?|talents?)\b/i.test(statement);

      if (negative || negativeMatch) {
        const statusCandidate = candidate({
          value: "not_accepting",
          field: "acceptingStudents",
          source: "content-block",
          sourceUrl: snapshot.url,
          selector: block.selectorFingerprint,
          snippet: statement,
          headingPath: block.headingPath,
          baseScore: 96,
          validationScore: 5
        });
        candidates.push(statusCandidate);
        explicitStatusCandidates.push(statusCandidate);
      }

      if (positive || positiveMatch || structuredPositive) {
        const statusCandidate = candidate({
          value: "accepting",
          field: "acceptingStudents",
          source: "content-block",
          sourceUrl: snapshot.url,
          selector: block.selectorFingerprint,
          snippet: statement,
          headingPath: block.headingPath,
          baseScore: contextIsApplication || structuredPositive ? 84 : 76,
          validationScore: 4
        });
        candidates.push(statusCandidate);
        if (positiveMatch || structuredPositive) {
          explicitStatusCandidates.push(statusCandidate);
        }
      }
    }
  }

  const explicitValues = new Set(explicitStatusCandidates.map((item) => item.value));
  if (explicitValues.has("accepting") && explicitValues.has("not_accepting")) {
    const evidence = candidateAgreement(explicitStatusCandidates).sort((left, right) => right.finalScore - left.finalScore);
    return {
      value: "unknown",
      confidence: 85,
      alternatives: evidence.slice(1, 5),
      evidence: evidence.slice(0, 5),
      status: "ambiguous"
    };
  }

  if (candidates.length > 0) {
    return resolveField(candidateAgreement(candidates));
  }

  return {
    value: null,
    confidence: 0,
    alternatives: [],
    evidence: [],
    status: "missing"
  };
}

function extractRelatedLinkField(snapshot: PageSnapshot, communityRules: MatchedCommunityRules, field: string): ResolvedField<string> {
  const patterns = communityRules.relatedLinkPatterns.filter((pattern) => pattern.field === field);
  const candidates: Candidate<string>[] = [];

  for (const pattern of patterns) {
    for (const link of snapshot.links) {
      if (linkMatchesPattern(link, pattern)) {
        candidates.push(
          candidate({
            value: link.href,
            normalizedValue: link.href,
            field,
            source: "adapter",
            sourceUrl: snapshot.url,
            selector: link.selectorFingerprint,
            snippet: `${pattern.label}: ${link.text || link.href}`,
            baseScore: pattern.score,
            validationScore: 4
          })
        );
      }
    }
  }

  return resolveField(candidateAgreement(candidates));
}

function extractOpenPositionsUrl(snapshot: PageSnapshot, communityRules: MatchedCommunityRules): ResolvedField<string> {
  const linkResult = extractRelatedLinkField(snapshot, communityRules, "openPositionsUrl");
  if (linkResult.value) {
    return linkResult;
  }

  if (/\b(open positions|openings|join (my|our|the) (lab|group)|join us|how to apply|call for graduate students|prospective students|for prospective|students.*welcome|actively (recruiting|seeking)|looking for .*students|hiring .*students|funded .*openings|fully funded .*positions|taking on .*students|accepting .*students|not currently taking on .*students|not taking .*students|not accepting .*students|no .*openings|no .*positions)\b/i.test(snapshot.contentBlocks.map((block) => block.text).join(" "))) {
    return resolveField([
      candidate({
        value: snapshot.canonicalUrl || snapshot.url,
        normalizedValue: snapshot.canonicalUrl || snapshot.url,
        field: "openPositionsUrl",
        source: "derived",
        sourceUrl: snapshot.url,
        snippet: "Current page contains open-position language.",
        baseScore: 84,
        validationScore: 4
      })
    ]);
  }

  return linkResult;
}

function recordConfidence(fields: Record<string, ResolvedField<unknown>>): number {
  const weights: Record<string, number> = {
    name: 18,
    university: 18,
    email: 15,
    acceptingStudents: 18,
    researchInterests: 14,
    contactInstructions: 8,
    department: 5,
    academicTitle: 4
  };

  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const weighted = Object.entries(weights).reduce((sum, [field, weight]) => {
    const resolvedField = fields[field];
    const isUnknownOpenPosition = field === "acceptingStudents" && resolvedField?.value === "unknown";
    return sum + (resolvedField?.value && !isUnknownOpenPosition ? ((resolvedField.confidence ?? 0) / 100) * weight : 0);
  }, 0);

  return Math.round((weighted / totalWeight) * 100);
}

export function extractPage(snapshot: PageSnapshot, communityRulePacks: CommunityRulePack[] = [bundledCommunityRulePack]): ExtractionResult {
  const communityRules = matchCommunityRules(snapshot, communityRulePacks);
  const classification = classifyPage(snapshot);
  const pageType = decidePageType(classification);
  const university = extractUniversity(snapshot, communityRules);
  const fields: Record<string, ResolvedField<unknown>> = {
    name: extractName(snapshot),
    email: extractEmail(snapshot),
    university,
    department: extractDepartment(snapshot, communityRules),
    country: extractCountry(snapshot, communityRules, university),
    academicTitle: extractAcademicTitle(snapshot),
    researchInterests: extractResearchInterests(snapshot),
    acceptingStudents: extractAcceptingStudents(snapshot, communityRules),
    googleScholarUrl: extractRelatedLinkField(snapshot, communityRules, "googleScholarUrl"),
    orcidUrl: extractRelatedLinkField(snapshot, communityRules, "orcidUrl"),
    cvUrl: extractRelatedLinkField(snapshot, communityRules, "cvUrl"),
    labUrl: extractRelatedLinkField(snapshot, communityRules, "labUrl"),
    openPositionsUrl: extractOpenPositionsUrl(snapshot, communityRules),
    contactInstructions: extractContactInstructions(snapshot),
    emailSubjectHint: extractEmailSubjectHintAdvanced(snapshot),
    contactRestriction: extractDoNotEmail(snapshot)
  };

  return {
    pageType,
    confidence: recordConfidence(fields),
    classification,
    fields,
    snapshot,
    createdAt: new Date().toISOString(),
    extractionVersion,
    warnings: pageType === "unknown" ? ["The page type could not be classified with enough confidence."] : [],
    communityRules: {
      packNames: communityRules.packs.map((pack) => `${pack.name} ${pack.version}`),
      adapterNames: communityRules.adapters.map((adapter) => adapter.name),
      domainMappings: communityRules.domainMappings.map((mapping) => mapping.domainPattern)
    }
  };
}
