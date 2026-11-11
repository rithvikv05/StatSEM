import React, { Suspense, useState } from 'react';
import { ModerationDetails } from './ModerationDetails';
import type { ModerationData, ResultsData } from '../utils/results-types';

const AdvancedResultPanels = React.lazy(() => import('./AdvancedResultPanels').then(module => ({ default: module.AdvancedResultPanels })));

const labels: Record<string, string> = {
  blindfolding: 'Predictive relevance', predict: 'Prediction and CVPAT',
  cta: 'Tetrad assessment', moderation: 'Interaction and simple slopes',
  quadratic: 'Nonlinear effects', ipma: 'Importance and performance',
  hcm: 'Higher-order constructs', micom: 'Measurement invariance',
  mga: 'Group comparisons', otg: 'Group differences',
  pca: 'Principal components', fimix: 'Finite mixture segmentation', pos: 'Prediction-oriented segmentation',
  ex_post: 'Ex post segmentation', power: 'Power and sample size',
  copula: 'Endogeneity diagnostics', nca: 'Necessary conditions',
};

interface AnalysisDetailProps {
  id: string; data: unknown; results: ResultsData | null | undefined; initiallyOpen: boolean;
  loading?: boolean; error?: string; stale?: boolean; onLoad: (id: string) => void;
}
const AnalysisDetail: React.FC<AnalysisDetailProps> = ({ id, data, results, initiallyOpen, loading, error, stale, onLoad }) => {
  const [open, setOpen] = useState(initiallyOpen);
  // A copula run returns a new model; use its own diagnostics, not those of an older base run.
  const resultContext = id === 'copula' && data && typeof data === 'object' && 'gaussian_copula' in data ? data : results;
  return (
    <details className="inline-analysis__detail" open={open} onToggle={event => {
      const next = event.currentTarget.open;
      setOpen(next);
      if (next && data == null && !loading && !error) onLoad(id);
    }}>
      <summary>{labels[id] || id.replaceAll('_', ' ')}</summary>
      {open && stale && <p className="results-empty-note">This analysis was calculated for a previous version of the model.</p>}
      {open && error && <p className="results-empty-note">{error} <button type="button" onClick={() => onLoad(id)}>Retry</button></p>}
      {open && !error && data == null && <p className="results-empty-note">Loading analysis output...</p>}
      {open && data != null && (id === 'moderation'
        ? <ModerationDetails data={data as ModerationData} results={results} />
        : <Suspense fallback={<p className="results-empty-note">Loading analysis output...</p>}>
          <AdvancedResultPanels activeTab={id} results={resultContext} analysisResults={{ [id]: data }} />
        </Suspense>)}
    </details>
  );
};

interface InlineAnalysisResultsProps {
  results: ResultsData | null | undefined; analyses: Record<string, unknown>; available: string[];
  latest?: { id: string; revision: number };
  loading: Record<string, boolean>; errors: Record<string, string>; stale: Record<string, boolean>;
  onLoad: (id: string) => void;
}
export const InlineAnalysisResults: React.FC<InlineAnalysisResultsProps> = ({ results, analyses, available: saved, latest, loading, errors, stale, onLoad }) => {
  const available = { ...analyses };
  if (results?.moderation && !available.moderation) available.moderation = results.moderation;
  if ((results?.nonlinear_effects?.length || results?.quadratic_effects?.length) && !available.quadratic) available.quadratic = results.nonlinear_effects ?? results.quadratic_effects;
  if (results?.gaussian_copula && !available.copula) available.copula = results.gaussian_copula;
  const entries = Array.from(new Set([...saved, ...Object.keys(available)]))
    .filter(id => id !== 'mediation' && id !== 'consistent_pls')
    .map(id => [id, available[id]] as const);
  if (!entries.length) return null;
  return <section className="inline-analysis" aria-label="Additional analysis output">
    <h2>Additional analysis output</h2>
    <p>These details belong to their own analysis run. The estimates above reflect the displayed model run.</p>
    {entries.map(([id, data]) => <AnalysisDetail key={`${id}-${id === latest?.id ? latest.revision : 'saved'}`} id={id} data={data} results={results} initiallyOpen={id === latest?.id} loading={loading[id]} error={errors[id]} stale={stale[id]} onLoad={onLoad} />)}
  </section>;
};
