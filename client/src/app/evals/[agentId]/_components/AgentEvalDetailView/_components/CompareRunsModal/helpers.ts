export interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
}

/** Standard LCS-based line diff (correct, not a heuristic) — short system
 *  prompts are at most a few dozen lines, so the O(n·m) DP table is cheap. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: "same", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      result.push({ type: "removed", text: a[i]! });
      i++;
    } else {
      result.push({ type: "added", text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: "removed", text: a[i]! });
    i++;
  }
  while (j < m) {
    result.push({ type: "added", text: b[j]! });
    j++;
  }
  return result;
}

/** Leading sign for a diff line — the non-color signal that pairs with the
 *  add/remove background (a11y: color is never the only cue), mirroring the
 *  PR diff viewer's `CodeLine` (`+`/`−`, U+2212 minus, for add/remove). */
export function diffSign(type: DiffLine["type"]): string {
  return type === "added" ? "+" : type === "removed" ? "−" : " ";
}

/** Whether an increase in this metric is an improvement (recall/precision/
 *  citation: yes; cost: no — a cost increase is never "good"). Colors the
 *  delta arrow accordingly (paired with the arrow glyph itself — icon + color,
 *  never color alone). */
export function isImprovement(metric: "recall" | "precision" | "citation" | "cost", delta: number): boolean {
  if (delta === 0) return true;
  return metric === "cost" ? delta < 0 : delta > 0;
}
