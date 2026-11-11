import React from 'react';
import { useStore } from '../store';
import { formatNumber, formatPValue, normalizeDecimalDigits } from '../utils/number-format';
import type { ModerationData, ResultsData } from '../utils/results-types';

export const ModerationDetails: React.FC<{ data: ModerationData; results: ResultsData | null | undefined }> = ({ data, results }) => {
  const { settings } = useStore();
  const digits = normalizeDecimalDigits(settings.decimalDigits);
  const fmt = (value: unknown) => formatNumber(value, digits, settings.decimalSystem);
  const fmtP = (value: unknown) => formatPValue(value, digits, settings.decimalSystem);
  const name = (id: string) => results?.construct_names?.[id] || id;
  const effects = Array.isArray(data?.moderating_effects) ? data.moderating_effects : [];
  const conditional = Array.isArray(data?.conditional_indirect_effects) ? data.conditional_indirect_effects : [];
  if (!effects.length && !conditional.length) return <p className="results-empty-note">No interaction details are available.</p>;
  return <div className="inline-analysis__content">
    {effects.map((effect, index) => {
      const slopes = Array.isArray(effect.simple_slopes) ? effect.simple_slopes : [];
      return <section key={effect.id ?? index}>
        <h3>{name(effect.source)} → {name(effect.target)}, moderated by {name(effect.moderator)}</h3>
        {slopes.length > 0 && <table className="scientific-table">
          <thead><tr><th>Moderator level</th><th>Conditional slope</th><th>Standard error</th><th>p value</th><th>Confidence interval</th></tr></thead>
          <tbody>{slopes.map((slope, i) => {
            const level = String(slope.moderator_level || '').split(' ')[0];
            const key = `simple_slope:${effect.interaction_term}->${effect.target}:${level}`;
            const inference = results?.significance?.parameter_summary?.[key] ?? results?.bootstrap?.parameter_summary?.[key];
            const low = slope.ci_lower ?? inference?.ci_lower ?? inference?.ci_low;
            const high = slope.ci_upper ?? inference?.ci_upper ?? inference?.ci_high;
            return <tr key={i}>
              <td>{slope.moderator_level}</td><td>{fmt(slope.slope)}</td><td>{fmt(slope.standard_error ?? inference?.standard_error ?? inference?.se)}</td><td>{fmtP(slope.p_value ?? inference?.p_value)}</td>
              <td>{low != null && high != null ? `[${fmt(low)}, ${fmt(high)}]` : '—'}</td>
            </tr>;
          })}</tbody>
        </table>}
      </section>;
    })}
    {conditional.length > 0 && <section>
      <h3>Conditional indirect effects</h3>
      <table className="scientific-table"><thead><tr><th>Path</th><th>Moderator</th><th>Level</th><th>Indirect effect</th></tr></thead>
        <tbody>{conditional.flatMap((item, i) => (item.conditional_effects ?? []).map((effect, j) =>
          <tr key={`${i}-${j}`}><td>{item.chain}</td><td>{name(item.moderator)}</td><td>{effect.w_label}</td><td>{fmt(effect.indirect_effect)}</td></tr>))}</tbody>
      </table>
    </section>}
  </div>;
};
