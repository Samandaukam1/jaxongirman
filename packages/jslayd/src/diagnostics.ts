/**
 * Compiler diagnostics.
 *
 * Three levels (§91): ERROR blocks the compile, WARNING compiles but tells the
 * author the renderer will do something they did not literally ask for, INFO is
 * advice. Every diagnostic carries a line so the admin editor can point at it.
 */

export type Severity = "error" | "warning" | "info";

export type Diagnostic = {
  severity: Severity;
  /** Stable machine code, e.g. `unknown_property`. Never shown to the admin. */
  code: string;
  /** Uzbek, shown verbatim in the admin editor. */
  message: string;
  /** 1-indexed line in the source prompt; 0 when the problem has no line. */
  line: number;
  /** `[SLIDE cover_01] › [ELEMENT title]`, for grouping in the UI. */
  scope?: string;
  /** What the author probably meant, when it can be determined without guessing. */
  hint?: string;
};

export type Diagnostics = {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  infos: Diagnostic[];
  all: Diagnostic[];
};

/**
 * Accumulator threaded through the whole compile. It carries the current scope
 * so call sites report `unknown property` without repeating where they are.
 */
export class DiagnosticBag {
  readonly items: Diagnostic[] = [];
  private scope: string | undefined;

  /** Runs `body` with `scope` appended, then restores the previous scope. */
  within<T>(scope: string, body: () => T): T {
    const previous = this.scope;
    this.scope = previous ? `${previous} › ${scope}` : scope;
    try {
      return body();
    } finally {
      this.scope = previous;
    }
  }

  error(code: string, message: string, line: number, hint?: string): void {
    this.push("error", code, message, line, hint);
  }

  warn(code: string, message: string, line: number, hint?: string): void {
    this.push("warning", code, message, line, hint);
  }

  info(code: string, message: string, line: number, hint?: string): void {
    this.push("info", code, message, line, hint);
  }

  private push(severity: Severity, code: string, message: string, line: number, hint?: string): void {
    this.items.push({ severity, code, message, line, ...(this.scope ? { scope: this.scope } : {}), ...(hint ? { hint } : {}) });
  }

  get hasErrors(): boolean {
    return this.items.some((item) => item.severity === "error");
  }

  collect(): Diagnostics {
    // Sorted by line so the editor's gutter markers read top to bottom; the
    // original order is preserved within a line, which keeps a property's
    // error ahead of the summary the section emits afterwards.
    const all = [...this.items].sort((first, second) => first.line - second.line);
    return {
      all,
      errors: all.filter((item) => item.severity === "error"),
      warnings: all.filter((item) => item.severity === "warning"),
      infos: all.filter((item) => item.severity === "info"),
    };
  }
}

/** One-line rendering, used by the CLI tests and the admin's copy-to-clipboard. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const level = diagnostic.severity.toUpperCase();
  const where = diagnostic.line > 0 ? `qator ${diagnostic.line}` : "hujjat";
  const scope = diagnostic.scope ? ` ${diagnostic.scope}` : "";
  const hint = diagnostic.hint ? ` — ${diagnostic.hint}` : "";
  return `${level}${scope} (${where}): ${diagnostic.message}${hint}`;
}

/**
 * The nearest known name for an unknown one, or undefined when nothing is close
 * enough to suggest without guessing. Distance 2 on a short identifier is
 * already a stretch, so the threshold scales with length.
 */
export function nearestName(value: string, candidates: readonly string[]): string | undefined {
  const budget = value.length <= 4 ? 1 : value.length <= 8 ? 2 : 3;
  let best: string | undefined;
  let bestDistance = budget + 1;
  for (const candidate of candidates) {
    const distance = editDistance(value.toLowerCase(), candidate.toLowerCase(), bestDistance);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= budget ? best : undefined;
}

/** Levenshtein with an early exit once every cell exceeds the budget. */
function editDistance(left: string, right: string, budget: number): number {
  if (Math.abs(left.length - right.length) > budget) return budget + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowBest = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const value = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + cost,
      );
      current.push(value);
      rowBest = Math.min(rowBest, value);
    }
    if (rowBest > budget) return budget + 1;
    previous = current;
  }
  return previous[right.length] ?? budget + 1;
}
