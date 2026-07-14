/** `$0.0234` → `$0.02` (never `$0.00` for a nonzero cost, `—` for null). */
export function formatCost(cost: number | null): string {
  if (cost == null) return "—";
  if (cost > 0 && cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

/** Toggle a batch id in/out of a max-2 selection (for the compare checkboxes).
 *  A third click evicts the OLDEST selection (FIFO), keeping selection size <= 2
 *  so "Compare" always has exactly two ids once two are picked. */
export function toggleCompareSelection(selected: string[], batchId: string): string[] {
  if (selected.includes(batchId)) return selected.filter((id) => id !== batchId);
  if (selected.length < 2) return [...selected, batchId];
  return [selected[1]!, batchId];
}
