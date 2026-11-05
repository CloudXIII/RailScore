/**
 * Runs of a train counted by lateness at the destination, when the runs themselves are not
 * at hand: Darwin's counts for the list, and HSP's counts for the days before Darwin.
 *
 * Each count includes the ones before it. `runs` includes cancellations and runs that did not
 * call at the boarding stop, which are outside every tolerance: the passenger could not board.
 * `arrived` is every run that reached the destination, however late.
 */
export type PunctualityTally = {
  readonly runs: number;
  readonly within5: number;
  readonly within14: number;
  readonly within29: number;
  readonly arrived: number;
};

export const NO_RUNS: PunctualityTally = {
  runs: 0,
  within5: 0,
  within14: 0,
  within29: 0,
  arrived: 0,
};

/** The sum of the tallies. A missing one adds nothing. */
export function sumTallies(
  tallies: readonly (PunctualityTally | undefined)[],
): PunctualityTally {
  const sum = (key: keyof PunctualityTally) =>
    tallies.reduce((total, tally) => total + (tally?.[key] ?? 0), 0);
  return {
    runs: sum("runs"),
    within5: sum("within5"),
    within14: sum("within14"),
    within29: sum("within29"),
    arrived: sum("arrived"),
  };
}
