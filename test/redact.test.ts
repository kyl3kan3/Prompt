import { describe, expect, it } from "vitest";
import { Redactor } from "../src/core/redact/index.js";
import { redactSecrets } from "../src/core/redact/secrets.js";

describe("secret redaction", () => {
  it("masks structured tokens", () => {
    const input = [
      "aws AKIAIOSFODNN7EXAMPLE",
      "gh ghp_16C7e42F292c6912E7710c838347Ae178B4a",
      "anthropic sk-ant-api03-abcdefghij1234567890",
      "conn postgres://admin:hunter2secret@db.internal:5432/prod",
    ].join("\n");
    const { text, hits } = redactSecrets(input);
    expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(text).not.toContain("ghp_16C7e42F292c6912E7710c838347Ae178B4a");
    expect(text).not.toContain("hunter2secret");
    expect(text).toContain("[REDACTED:aws-access-key]");
    expect(hits["aws-access-key"]).toBe(1);
  });

  it("keeps the key name for assignment-style secrets", () => {
    const { text } = redactSecrets('API_KEY="super-secret-value-123"');
    expect(text).toContain("API_KEY=[REDACTED:assigned-secret]");
    expect(text).not.toContain("super-secret-value-123");
  });

  it("leaves ordinary prose alone", () => {
    const prose = "please fix the login flow, it breaks when the user has no avatar";
    expect(redactSecrets(prose).text).toBe(prose);
  });
});

describe("pseudonymization via Redactor", () => {
  it("maps the same email to the same stable placeholder", () => {
    const r = new Redactor();
    const a = r.clean("mail kyle@example.com about the deploy");
    const b = r.clean("kyle@example.com replied");
    expect(a).toContain("EMAIL_1");
    expect(b).toContain("EMAIL_1");
    expect(a).not.toContain("example.com");
    expect(r.mappingTable().EMAIL["kyle@example.com"]).toBe("EMAIL_1");
  });

  it("does not rewrite loopback addresses", () => {
    const r = new Redactor();
    expect(r.clean("server on 127.0.0.1 works")).toContain("127.0.0.1");
    expect(r.clean("prod box is 10.1.2.3")).not.toContain("10.1.2.3");
  });

  it("accumulates an audit trail", () => {
    const r = new Redactor();
    r.clean("token ghp_16C7e42F292c6912E7710c838347Ae178B4a");
    r.clean("token ghp_26C7e42F292c6912E7710c838347Ae178B4b");
    expect(r.auditHits["github-token"]).toBe(2);
  });
});
