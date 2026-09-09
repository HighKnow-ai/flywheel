/**
 * Behavior under test (CR-02/IN-01, 01-REVIEW.md): `deriveKeyPrefix` must always emit a prefix
 * `core::domain::project::validate_key_prefix` accepts (2-10 uppercase letters/digits, starting
 * with a letter) — a directory name like `2024-app` or a single-character name used to derive an
 * invalid prefix, which three of the four registration entry points had no way to recover from
 * since they register immediately with no confirmation step to edit it.
 */
import { describe, expect, it } from "vitest";
import { deriveKeyPrefix } from "../FirstRun";

/** Mirrors `core::domain::project::validate_key_prefix` exactly, so this test proves the same
 * contract the backend enforces, not a looser JS-side approximation of it. */
function isValidKeyPrefix(prefix: string): boolean {
  return /^[A-Z][A-Z0-9]{1,9}$/.test(prefix);
}

describe("deriveKeyPrefix", () => {
  it("derives the expected prefix for an ordinary directory name", () => {
    expect(deriveKeyPrefix("/repos/my-app")).toBe("MYAP");
  });

  it("hardens a digit-leading directory name into a valid, letter-led prefix (CR-02)", () => {
    const prefix = deriveKeyPrefix("/repos/2024-app");
    expect(prefix).toBe("P202");
    expect(isValidKeyPrefix(prefix)).toBe(true);
  });

  it("hardens a single-character directory name into a valid, 2+ character prefix", () => {
    const prefix = deriveKeyPrefix("/repos/x");
    expect(isValidKeyPrefix(prefix)).toBe(true);
  });

  it("hardens a directory name with no alphanumeric characters at all", () => {
    const prefix = deriveKeyPrefix("/repos/___");
    expect(prefix).toBe("PRJ");
    expect(isValidKeyPrefix(prefix)).toBe(true);
  });

  it("never emits a prefix validate_key_prefix would reject, across a spread of realistic names", () => {
    const names = [
      "2024-app",
      "_x",
      "a",
      "99bottles",
      "my-app",
      "___",
      "1",
      "Flywheel",
      "___2025___",
    ];
    for (const name of names) {
      const prefix = deriveKeyPrefix(`/repos/${name}`);
      expect(isValidKeyPrefix(prefix)).toBe(true);
    }
  });
});
