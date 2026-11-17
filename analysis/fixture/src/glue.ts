// The fixture's one glue file.
import { Inngest, NonRetriableError } from "inngest";

export const client = new Inngest({ id: "fixture" });

export function fail(reason: string): never {
  throw new NonRetriableError(reason);
}
