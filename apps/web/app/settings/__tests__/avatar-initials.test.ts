import { describe, expect, it } from "vitest";
import { avatarInitials } from "../avatar-initials";

describe("avatarInitials", () => {
  it("uses first letters of the first two words", () => {
    expect(avatarInitials("Wan Xian")).toBe("WX");
    expect(avatarInitials("alice bob carol")).toBe("AB");
  });

  it("falls back to first two characters for a single word", () => {
    expect(avatarInitials("wanxsb")).toBe("WA");
    expect(avatarInitials("z")).toBe("Z");
  });

  it("derives from the local part of an email", () => {
    expect(avatarInitials("wanxsb@gridpilot.io")).toBe("WA");
    expect(avatarInitials("jane.doe@example.com")).toBe("JD");
  });

  it("splits on separators in names", () => {
    expect(avatarInitials("jane_doe")).toBe("JD");
    expect(avatarInitials("john-smith")).toBe("JS");
  });

  it("returns a placeholder for empty input", () => {
    expect(avatarInitials("")).toBe("?");
    expect(avatarInitials("   ")).toBe("?");
  });
});
