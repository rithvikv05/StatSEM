import type { ResultsData } from './results-types';

export const hasRunDetails = (results: ResultsData | null | undefined): boolean => {
  const run = results?.results_pls_original ?? results;
  return run != null && (run.converged != null || run.iterations != null || run.n_samples != null || run.sample_size != null || Array.isArray(run.stop_criterion_history));
};
