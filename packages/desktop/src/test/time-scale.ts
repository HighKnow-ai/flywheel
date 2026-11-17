/**
 * How much slower than a developer's machine this run's machine is, as a factor on the tests' time budgets:
 * `FLYWHEEL_TEST_TIME_SCALE`, or 1 when it is unset or not a positive number.
 *
 * A machine can be slow on purpose: a check that runs at background priority on Apple silicon stays on the
 * efficiency cores. Measured 2026-11-17, this package's jsdom suite took 139 s there and 10 s at normal
 * priority, and a WebKit click-through that takes 3.6 s took 14.7 s, so budgets sized for a normal machine
 * failed a different test on each run. A runner that knows it is slow sets the factor; nothing else does, so
 * a developer's run and the hosted CI keep their budgets. A scaled budget still fails a state that never
 * comes; it only stops a slow machine from reading as a broken one.
 *
 * Read in Node (the vitest configs, the jsdom setup). In the real browser there is no `process`, so it is 1
 * there, and the browser arm's budget is the config's.
 */
export function testTimeScale(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const factor = Number(env?.["FLYWHEEL_TEST_TIME_SCALE"]);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}
