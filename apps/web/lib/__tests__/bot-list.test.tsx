import { describe, expect, it } from "vitest";

const filterState: Record<string, string | undefined> = {
  all: undefined,
  running: "RUNNING",
  trailing: "TRAILING_ENTRY",
  sleeping: "SLEEPING",
};

describe("bot list filters", () => {
  it("maps tab ids to backend state values", () => {
    expect(filterState["all"]).toBeUndefined();
    expect(filterState["running"]).toBe("RUNNING");
    expect(filterState["trailing"]).toBe("TRAILING_ENTRY");
    expect(filterState["sleeping"]).toBe("SLEEPING");
  });
});
