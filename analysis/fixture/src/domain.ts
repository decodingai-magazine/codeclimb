/* Pure parts, with one of each type escape. */
export function parse(raw: string): any {
  return JSON.parse(raw);
}

export function first(xs: number[]): number {
  return xs[0]!;
}

export function cast(x: string): number {
  return x as unknown as number;
}

export function grade(score: number): string {
  if (score > 0.9) return "a";
  if (score > 0.5) return "b";
  return "c";
}

// @ts-expect-error
export const unused: number = "x";

export async function save(): Promise<void> {}

export function kick(): void {
  save();
}
