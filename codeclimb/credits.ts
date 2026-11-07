// Running out of credits is not a failed experiment: nothing was wrong with the work, and a score
// taken without models is meaningless. Whoever hits it reports a CreditStop, and the night pauses.

export interface CreditStop {
  who: "coder" | "reviewer" | "program";
  model: string;
  message: string;
}

/** Thrown where a function has no result to carry the stop in. */
export class OutOfCredits extends Error {
  constructor(readonly stop: CreditStop) {
    super(`out of credits on ${stop.model}: ${stop.message}`);
  }
}

// Exhausted accounts, not throttles: a 429 rate limit passes in seconds and stays Pi's and the program's to retry.
const CREDIT_ERROR =
  /\b402\b|payment required|insufficient[ _](credits?|quota|funds|balance)|credit balance|out of (credits|budget)|quota[ _](exceeded|exhausted)|exceeded your .{0,40}(quota|allowance)|usage limit reached|key limit exceeded|billing/i;

export const isCreditError = (message: string) => CREDIT_ERROR.test(message);
