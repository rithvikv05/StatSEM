import React from 'react';
import { useStore } from '../store';
import { formatNumber, normalizeDecimalDigits } from '../utils/number-format';

export const CollinearityResults: React.FC<{ results: any; section: 'inner' | 'outer'; constructName: (id: string) => string; indicatorName: (id: string) => string }> = ({ results, section, constructName, indicatorName }) => {
  const { settings } = useStore();
  const fmt = (value: unknown) => formatNumber(value, normalizeDecimalDigits(settings.decimalDigits), settings.decimalSystem);
  const values = section === 'inner' ? results?.structural?.inner_vif ?? results?.quality_criteria?.inner_vif : results?.measurement?.outer_vif;
  const rows = Object.entries(values || {}).flatMap(([first, entries]) =>
    entries && typeof entries === 'object'
      ? Object.entries(entries).map(([second, value]) => [first, second, value] as const)
      : [[first, '', entries] as const]
  );
  return <table className="scientific-table">
    <thead><tr><th>{section === 'inner' ? 'Target construct' : 'Construct'}</th><th>{section === 'inner' ? 'Predictor construct' : 'Indicator'}</th><th>VIF</th></tr></thead>
    <tbody>{rows.length ? rows.map(([first, second, value], index) => <tr key={index}><td>{constructName(first)}</td><td>{section === 'inner' ? constructName(second) : indicatorName(second)}</td><td>{fmt(value)}</td></tr>) : <tr><td colSpan={3}>No collinearity results available.</td></tr>}</tbody>
  </table>;
};
