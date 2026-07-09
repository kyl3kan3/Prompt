/**
 * Deterministic pseudonymization: the same email/host always maps to the same
 * placeholder within a run, so the model can still count recurrences
 * ("EMAIL_2 appears in 14 sessions") without ever seeing the real value.
 * The mapping table lives only in memory / the local run directory.
 */
export class Pseudonymizer {
  private maps: Record<string, Map<string, string>> = {
    EMAIL: new Map(),
    IP: new Map(),
  };

  private replace(kind: "EMAIL" | "IP", value: string): string {
    const map = this.maps[kind];
    let placeholder = map.get(value);
    if (!placeholder) {
      placeholder = `${kind}_${map.size + 1}`;
      map.set(value, placeholder);
    }
    return placeholder;
  }

  apply(input: string): string {
    let text = input.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      (m) => this.replace("EMAIL", m.toLowerCase()),
    );
    text = text.replace(
      /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
      (m) => (m === "127.0.0.1" || m === "0.0.0.0" ? m : this.replace("IP", m)),
    );
    return text;
  }

  /** Local-only mapping table, written to the run directory for user inspection. */
  mappingTable(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const [kind, map] of Object.entries(this.maps)) {
      out[kind] = Object.fromEntries(map.entries());
    }
    return out;
  }
}
