import React from 'react';
import { useStore } from '../store';
import { formatNumber, normalizeDecimalDigits } from '../utils/number-format';
import type { ResultsData } from '../utils/results-types';

export const ModelFitResults: React.FC<{ results: ResultsData | null | undefined }> = ({ results }) => {
  const { settings } = useStore();
  const fit = results?.fit || results?.model_fit || {};
  const fmt = (value: unknown) => formatNumber(value, normalizeDecimalDigits(settings.decimalDigits), settings.decimalSystem);
  const rows = [
    ['SRMR', fit.saturated_model?.srmr ?? fit.srmr_saturated ?? fit.srmr, fit.estimated_model?.srmr ?? fit.srmr_estimated ?? fit.srmr, 'Common reference: < 0.080'],
    ['d_ULS (squared Euclidean distance)', fit.saturated_model?.d_uls ?? fit.d_uls_saturated ?? fit.d_uls, fit.estimated_model?.d_uls ?? fit.d_uls, 'Compare with bootstrap reference'],
    ['d_G (geodesic distance)', fit.saturated_model?.d_g ?? fit.d_g_saturated ?? fit.d_g, fit.estimated_model?.d_g ?? fit.d_g, 'Compare with bootstrap reference'],
    ['RMS theta', null, fit.rms_theta, 'Common reference: < 0.120'],
    ['Tenenhaus GoF', typeof fit.gof === 'object' ? fit.gof?.gof : fit.gof, null, 'Legacy measure; not recommended for assessing model fit'],
    ...(fit.nfi != null ? [['NFI', fit.nfi, null, 'Normed fit index']] : []),
  ];

  return (
    <table className="scientific-table">
      <thead><tr><th>Criterion</th><th>Saturated model</th><th>Estimated model</th><th>Reference</th></tr></thead>
      <tbody>
        {rows.map(([label, saturated, estimated, reference]) => (
          <tr key={String(label)}><td>{label}</td><td>{fmt(saturated)}</td><td>{fmt(estimated)}</td><td>{reference}</td></tr>
        ))}
      </tbody>
    </table>
  );
};
