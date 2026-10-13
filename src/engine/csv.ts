export interface CsvRecord { line: number; cells: string[]; raw: string }
export interface CsvResult { records: CsvRecord[]; error: string | null }

/** RFC 4180-style parser. Unclosed quotes and stray quotes are errors, never silently repaired. */
export function parseCsv(text: string): CsvResult {
  const records: CsvRecord[] = [];
  let i = 0, line = 1;
  const n = text.length;
  while (i < n) {
    const startLine = line, startIdx = i;
    const cells: string[] = [];
    let cell = "", inQuotes = false, quotedCell = false, endOfRecord = false;
    while (i < n && !endOfRecord) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQuotes = false; i++;
          const nx = text[i];
          if (i < n && nx !== "," && nx !== "\n" && nx !== "\r") return { records, error: `Unexpected character after closing quote on line ${line}` };
          continue;
        }
        if (ch === "\n") line++;
        cell += ch; i++; continue;
      }
      if (ch === '"') {
        if (cell.length > 0 || quotedCell) return { records, error: `Stray quote inside an unquoted cell on line ${line}` };
        inQuotes = true; quotedCell = true; i++; continue;
      }
      if (ch === ",") { cells.push(cell); cell = ""; quotedCell = false; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        cells.push(cell);
        if (ch === "\r" && text[i + 1] === "\n") i++;
        i++; line++; endOfRecord = true; continue;
      }
      cell += ch; i++;
    }
    if (inQuotes) return { records, error: `Unclosed quote starting on line ${startLine}` };
    if (!endOfRecord) cells.push(cell);
    const raw = text.slice(startIdx, i).replace(/\r?\n$/, "");
    if (!(cells.length === 1 && cells[0].trim() === "")) records.push({ line: startLine, cells, raw });
  }
  return { records, error: null };
}

/** Neutralise spreadsheet formula prefixes for CSV/Markdown exports. */
export function safeCell(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
