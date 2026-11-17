/**
 * How much slower than a developer's machine this run's machine is, as a factor on the tests' time budgets:
 * `FLYWHEEL_TEST_TIME_SCALE`, or 1 when it is unset or not a positive number. The desktop package reads the
 * same variable the same way (`packages/desktop/src/test/time-scale.ts`, which says why a machine is slow).
 *
 * Measured 2026-11-17 on the self-hosted runner, at background priority on the efficiency cores: the real
 * `claude` binary had not exited 10 s after a spawn that settles in under a second here, so a deadline sized
 * for a normal machine read a slow start as a hang. A scaled budget still fails a CLI that never exits.
 */
export function testTimeScale() {
  const factor = Number(process.env.FLYWHEEL_TEST_TIME_SCALE);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}
