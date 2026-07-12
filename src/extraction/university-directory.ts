export interface UniversityDirectoryEntry {
  name: string;
  country: string;
  aliases?: string[];
  domains?: string[];
}

export const universityDirectory: UniversityDirectoryEntry[] = [
  { name: "University of Alberta", country: "Canada", domains: ["ualberta.ca"] },
  { name: "University of Waterloo", country: "Canada", domains: ["uwaterloo.ca"] },
  { name: "Simon Fraser University", country: "Canada", aliases: ["SFU"], domains: ["sfu.ca"] },
  { name: "University of Toronto", country: "Canada", aliases: ["U of T"], domains: ["utoronto.ca"] },
  { name: "University of British Columbia", country: "Canada", aliases: ["UBC"], domains: ["ubc.ca"] },
  { name: "McGill University", country: "Canada", domains: ["mcgill.ca"] },
  { name: "Queen's University", country: "Canada", aliases: ["Queens University"], domains: ["queensu.ca"] },
  { name: "University of Edinburgh", country: "United Kingdom", domains: ["ed.ac.uk"] },
  { name: "University of Oxford", country: "United Kingdom", domains: ["ox.ac.uk"] },
  { name: "University of Cambridge", country: "United Kingdom", domains: ["cam.ac.uk"] },
  { name: "Imperial College London", country: "United Kingdom", domains: ["imperial.ac.uk"] },
  { name: "University College London", country: "United Kingdom", aliases: ["UCL"], domains: ["ucl.ac.uk"] },
  { name: "King's College London", country: "United Kingdom", domains: ["kcl.ac.uk"] },
  { name: "Technical University of Munich", country: "Germany", aliases: ["TUM"], domains: ["tum.de"] },
  { name: "University of Freiburg", country: "Germany", domains: ["uni-freiburg.de"] },
  { name: "RWTH Aachen University", country: "Germany", domains: ["rwth-aachen.de"] },
  { name: "Karlsruhe Institute of Technology", country: "Germany", aliases: ["KIT"], domains: ["kit.edu"] },
  { name: "University of Vienna", country: "Austria", domains: ["univie.ac.at"] },
  { name: "TU Wien", country: "Austria", aliases: ["Vienna University of Technology"], domains: ["tuwien.at"] },
  { name: "University of Amsterdam", country: "Netherlands", aliases: ["UvA"], domains: ["uva.nl"] },
  { name: "Delft University of Technology", country: "Netherlands", aliases: ["TU Delft"], domains: ["tudelft.nl"] },
  { name: "Eindhoven University of Technology", country: "Netherlands", aliases: ["TU/e"], domains: ["tue.nl"] },
  { name: "Leiden University", country: "Netherlands", domains: ["universiteitleiden.nl"] },
  { name: "Université Paris-Saclay", country: "France", aliases: ["Paris-Saclay University"], domains: ["universite-paris-saclay.fr"] },
  { name: "Sorbonne University", country: "France", aliases: ["Sorbonne Université"], domains: ["sorbonne-universite.fr"] },
  { name: "École Polytechnique", country: "France", aliases: ["Ecole Polytechnique"], domains: ["polytechnique.edu"] },
  { name: "KAIST", country: "South Korea", aliases: ["Korea Advanced Institute of Science and Technology"], domains: ["kaist.ac.kr"] },
  { name: "DGIST", country: "South Korea", aliases: ["Daegu Gyeongbuk Institute of Science and Technology"], domains: ["dgist.ac.kr"] },
  { name: "UNIST", country: "South Korea", aliases: ["Ulsan National Institute of Science and Technology"], domains: ["unist.ac.kr"] },
  { name: "POSTECH", country: "South Korea", aliases: ["Pohang University of Science and Technology"], domains: ["postech.ac.kr"] },
  { name: "Seoul National University", country: "South Korea", aliases: ["SNU"], domains: ["snu.ac.kr"] },
  { name: "University of Tokyo", country: "Japan", aliases: ["The University of Tokyo", "UTokyo"], domains: ["u-tokyo.ac.jp"] },
  { name: "Kyoto University", country: "Japan", domains: ["kyoto-u.ac.jp"] },
  { name: "Osaka University", country: "Japan", domains: ["osaka-u.ac.jp"] },
  { name: "Tokyo Institute of Technology", country: "Japan", aliases: ["Tokyo Tech"], domains: ["titech.ac.jp"] },
  { name: "University of Copenhagen", country: "Denmark", domains: ["ku.dk"] },
  { name: "Technical University of Denmark", country: "Denmark", aliases: ["DTU"], domains: ["dtu.dk"] },
  { name: "Aarhus University", country: "Denmark", domains: ["au.dk"] },
  { name: "University of Helsinki", country: "Finland", domains: ["helsinki.fi"] },
  { name: "Aalto University", country: "Finland", domains: ["aalto.fi"] },
  { name: "University of Turku", country: "Finland", domains: ["utu.fi"] },
  {
    name: "Victoria University of Wellington",
    country: "New Zealand",
    aliases: ["Te Herenga Waka", "VUW", "THW-VUW"],
    domains: ["wgtn.ac.nz", "vuw.ac.nz"]
  },
  { name: "Monash University", country: "Australia", domains: ["monash.edu"] },
  { name: "The University of Queensland", country: "Australia", aliases: ["University of Queensland"], domains: ["uq.edu.au"] }
];

function normalizeLookupText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function findUniversityInText(text: string): UniversityDirectoryEntry | null {
  return findUniversitiesInText(text)[0] ?? null;
}

export function findUniversitiesInText(text: string): UniversityDirectoryEntry[] {
  const normalizedText = ` ${normalizeLookupText(text)} `;
  const matches = universityDirectory
    .map((entry) => {
      const longestMatchLength = Math.max(
        ...[entry.name, ...(entry.aliases ?? [])]
          .filter((name) => normalizedText.includes(` ${normalizeLookupText(name)} `))
          .map((name) => normalizeLookupText(name).length),
        0
      );
      return { entry, longestMatchLength };
    })
    .filter((match) => match.longestMatchLength > 0)
    .sort((left, right) => right.longestMatchLength - left.longestMatchLength);

  return matches.map((match) => match.entry);
}

export function findUniversityByDomain(domain: string): UniversityDirectoryEntry | null {
  return universityDirectory.find((entry) =>
    (entry.domains ?? []).some((item) => domain === item || domain.endsWith(`.${item}`))
  ) ?? null;
}

export function findUniversityByName(name: string): UniversityDirectoryEntry | null {
  const normalizedName = normalizeLookupText(name);
  return universityDirectory.find((entry) =>
    [entry.name, ...(entry.aliases ?? [])].some((item) => normalizeLookupText(item) === normalizedName)
  ) ?? null;
}
