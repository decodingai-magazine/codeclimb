export function tally(rows: { name: string; score: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const prev = out.get(row.name) ?? 0;
    out.set(row.name, prev + row.score);
  }
  return out;
}
