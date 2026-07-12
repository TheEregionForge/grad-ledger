import type { TableSnapshot } from "../shared/models";
import { normalizeWhitespace } from "../shared/normalization";
import { buildSelectorFingerprint } from "./selector-fingerprint";
import { isVisible } from "./visibility";

export function collectTables(): TableSnapshot[] {
  return Array.from(document.querySelectorAll<HTMLTableElement>("table"))
    .filter(isVisible)
    .slice(0, 20)
    .map((table, index) => {
      const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th")).map((cell) =>
        normalizeWhitespace(cell.textContent ?? "")
      );
      const rows = Array.from(table.querySelectorAll("tr"))
        .slice(headers.length ? 1 : 0)
        .map((row) =>
          Array.from(row.querySelectorAll("th,td")).map((cell) => normalizeWhitespace(cell.textContent ?? ""))
        )
        .filter((row) => row.some(Boolean));

      return {
        id: `table-${index + 1}`,
        caption: normalizeWhitespace(table.caption?.textContent ?? "") || undefined,
        headers,
        rows,
        selectorFingerprint: buildSelectorFingerprint(table)
      };
    })
    .filter((table) => table.rows.length > 0);
}
