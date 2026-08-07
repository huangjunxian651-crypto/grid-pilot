import { describe, expect, it } from "vitest";

function canSubmitCredential(form: { accountId: string; label: string; apiKey: string; apiSecret: string }, editing = false) {
  return Boolean(form.accountId && form.label && (editing || (form.apiKey && form.apiSecret)));
}

function filterActiveOnly(creds: { isActive: boolean }[], activeOnly: boolean) {
  return activeOnly ? creds.filter((c) => c.isActive) : creds;
}

describe("credential form validation", () => {
  it("requires account id, label, api key, and api secret for create", () => {
    expect(canSubmitCredential({ accountId: "", label: "main", apiKey: "k", apiSecret: "s" })).toBe(false);
    expect(canSubmitCredential({ accountId: "acct", label: "", apiKey: "k", apiSecret: "s" })).toBe(false);
    expect(canSubmitCredential({ accountId: "acct", label: "main", apiKey: "", apiSecret: "s" })).toBe(false);
    expect(canSubmitCredential({ accountId: "acct", label: "main", apiKey: "k", apiSecret: "" })).toBe(false);
    expect(canSubmitCredential({ accountId: "acct", label: "main", apiKey: "k", apiSecret: "s" })).toBe(true);
  });

  it("requires only account id and label for edit (api key/secret optional)", () => {
    expect(canSubmitCredential({ accountId: "", label: "main", apiKey: "", apiSecret: "" }, true)).toBe(false);
    expect(canSubmitCredential({ accountId: "acct", label: "", apiKey: "", apiSecret: "" }, true)).toBe(false);
    expect(canSubmitCredential({ accountId: "acct", label: "main", apiKey: "", apiSecret: "" }, true)).toBe(true);
    expect(canSubmitCredential({ accountId: "acct", label: "main", apiKey: "k", apiSecret: "s" }, true)).toBe(true);
  });
});

describe("credential active-only filter", () => {
  it("returns all credentials when activeOnly is false", () => {
    const creds = [{ isActive: true }, { isActive: false }, { isActive: true }];
    expect(filterActiveOnly(creds, false)).toHaveLength(3);
  });

  it("returns only active credentials when activeOnly is true", () => {
    const creds = [{ isActive: true }, { isActive: false }, { isActive: true }];
    expect(filterActiveOnly(creds, true)).toHaveLength(2);
    expect(filterActiveOnly(creds, true).every((c) => c.isActive)).toBe(true);
  });
});

function defaultEnvironment(): "demo" | "live" {
  return "demo";
}

function isEnvironmentEditable(editingId: string | null): boolean {
  return editingId == null;
}

describe("credential environment field", () => {
  it("defaults to demo for new credentials", () => {
    expect(defaultEnvironment()).toBe("demo");
  });

  it("is editable only when creating (editingId is null)", () => {
    expect(isEnvironmentEditable(null)).toBe(true);
    expect(isEnvironmentEditable("cred-1")).toBe(false);
  });
});
