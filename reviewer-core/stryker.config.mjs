// Mutation testing for one module (SPEC-05 stretch: "an eval for your tests").
// Mutates only src/output/to-review.ts and runs the existing vitest suite against
// each mutant; a SURVIVED mutant = a behavior change your tests did not catch.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  mutate: ['src/prompt.ts'],
  reporters: ['clear-text', 'progress'],
  coverageAnalysis: 'perTest',
  concurrency: 2,
  clearTextReporter: { allowColor: false, maxTestsToLog: 0 },
  // Stryker's vitest runner otherwise uses vitest's `related` changed-file
  // detection, which can't map a mutated source file back to its test here.
  vitest: { related: false },
};
