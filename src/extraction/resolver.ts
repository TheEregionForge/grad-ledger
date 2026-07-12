import type { Candidate, ResolvedField } from "../shared/models";

export function resolveField<T>(candidates: Candidate<T>[]): ResolvedField<T> {
  if (candidates.length === 0) {
    return {
      value: null,
      confidence: 0,
      alternatives: [],
      evidence: [],
      status: "missing"
    };
  }

  const ranked = [...candidates].sort((a, b) => b.finalScore - a.finalScore);
  const [best, second] = ranked;
  const confidence = Math.max(0, Math.min(100, Math.round(best.finalScore)));
  const status =
    confidence >= 90
      ? "confirmed"
      : second && Math.abs(best.finalScore - second.finalScore) < 6
        ? "ambiguous"
        : confidence >= 55
          ? "suggested"
          : "missing";

  return {
    value: status === "missing" ? null : best.value,
    confidence,
    alternatives: ranked.slice(1, 5),
    evidence: ranked.slice(0, 5),
    status
  };
}

export function candidate<T>(input: Omit<Candidate<T>, "validationScore" | "agreementScore" | "finalScore" | "warnings"> & {
  validationScore?: number;
  agreementScore?: number;
  warnings?: string[];
}): Candidate<T> {
  const validationScore = input.validationScore ?? 0;
  const agreementScore = input.agreementScore ?? 0;

  return {
    ...input,
    validationScore,
    agreementScore,
    finalScore: input.baseScore + validationScore + agreementScore,
    warnings: input.warnings ?? []
  };
}
