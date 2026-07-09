import { redactSecrets } from "./secrets.js";
import { Pseudonymizer } from "./pseudonymize.js";

/**
 * The single choke point for everything that may leave this machine.
 * Every agent-facing tool passes its output through a Redactor; the model
 * has no code path to raw archive bytes.
 */
export class Redactor {
  private pseudo = new Pseudonymizer();
  /** Cumulative counts for the run's local audit log. */
  readonly auditHits: Record<string, number> = {};

  clean(input: string): string {
    const { text, hits } = redactSecrets(input);
    for (const [rule, count] of Object.entries(hits)) {
      this.auditHits[rule] = (this.auditHits[rule] ?? 0) + count;
    }
    return this.pseudo.apply(text);
  }

  mappingTable(): Record<string, Record<string, string>> {
    return this.pseudo.mappingTable();
  }
}

export { redactSecrets } from "./secrets.js";
export { Pseudonymizer } from "./pseudonymize.js";
