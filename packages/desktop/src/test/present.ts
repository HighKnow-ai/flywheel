/**
 * Reads a test's own fixture where the type cannot prove the element is there.
 *
 * A fixture is the test's invariant: the third Story exists because the test wrote three. Under
 * `noUncheckedIndexedAccess` an index read is `T | undefined` all the same, and a non-null
 * assertion would let a fixture that lost an element read `undefined` onward and fail somewhere
 * unrelated. These throw at the read instead, naming what was missing.
 */

/** `items[index]`, or a thrown error when the fixture has no such element. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`fixture has no element at ${index} (length ${items.length})`);
  return item;
}

/** `value`, or a thrown error naming `what` when it is absent. */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`fixture is missing ${what}`);
  return value;
}
