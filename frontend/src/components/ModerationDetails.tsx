import React, { useState } from 'react';
import { useStore } from '../store';
import { formatNumber, formatPValue, normalizeDecimalDigits } from '../utils/number-format';
import type { ModerationData, ResultsData } from '../utils/results-types';

export function moderationSections(data: ModerationData | undefined, results: ResultsData | null | undefined): Array<{ id: string; label: string }> {
  const name = (id: string) => results?.construct_names?.[id] || id;
  return [
    ...(data?.moderating_effects || []).flatMap((effect, index) => effect.simple_slopes?.length ? [{ id: `moderation::${index}`, label: `${name(effect.source)} → ${name(effect.target)} · ${name(effect.moderator)}` }] : []),
    ...(data?.conditional_indirect_effects?.length ? [{ id: 'moderation::indirect', label: 'Conditional indirect effects' }] : []),
  ];
}

export const ModerationDetails: React.FC<{ data: ModerationData; results: ResultsData | null | undefined; section?: string }> = ({ data, results, section }) => {
  const { settings } = useStore();
  const digits = normalizeDecimalDigits(settings.decimalDigits);
  const fmt = (value: unknown) => formatNumber(value, digits, settings.decimalSystem);
  const fmtP = (value: unknown) => formatPValue(value, digits, settings.decimalSystem);
  const name = (id: string) => results?.construct_names?.[id] || id;
  const effects = Array.isArray(data?.moderating_effects) ? data.moderating_effects : [];
  const conditional = Array.isArray(data?.conditional_indirect_effects) ? data.conditional_indirect_effects : [];
  const summaries = results?.significance?.parameter_summary ?? results?.bootstrap?.parameter_summary ?? {};
  const pathLabel = (path: string | undefined) => (path || '—').split(/\s*->\s*/).map(name).join(' → ');
  if (!effects.length && !conditional.length) return <p className="results-empty-note">No interaction details are available.</p>;
  return <div className="inline-analysis__content">
    {effects.map((effect, index) => {
      if (section != null && section !== String(index)) return null;
      const slopes = Array.isArray(effect.simple_slopes) ? effect.simple_slopes : [];
      return <section key={effect.id ?? index}>
        <h3>{name(effect.source)} → {name(effect.target)}, moderated by {name(effect.moderator)}</h3>
        {slopes.length > 0 && <><p className="moderation-note">Conditional direct effects (simple slopes). The plot uses construct-score units, with other predictors held at zero; inference appears after bootstrapping.</p><table className="scientific-table">
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
        </table><SlopeChart slopes={slopes} predictor={name(effect.source)} outcome={name(effect.target)} />
          {effect.method === 'two_stage' && (effect.interaction_term?.split(' x ').length ?? 0) === 2 && <CustomSlope effect={effect} fmt={fmt} />}
        </>}
      </section>;
    })}
    {conditional.length > 0 && (section == null || section === 'indirect') && <section>
      <h3>Conditional indirect effects</h3>
      <table className="scientific-table"><thead><tr><th>Path</th><th>Moderator</th><th>Level</th><th>Indirect effect</th><th>Standard error</th><th>p value</th><th>Confidence interval</th></tr></thead>
        <tbody>{conditional.flatMap((item, i) => (item.conditional_effects ?? []).map((effect, j) => {
          const level = String(effect.w_label || '').split(' ')[0];
          const inference = summaries[`cond_indirect:${item.chain}(${item.moderator}):${level}`];
          const low = inference?.ci_lower ?? inference?.ci_low;
          const high = inference?.ci_upper ?? inference?.ci_high;
          return <tr key={`${i}-${j}`}><td>{pathLabel(item.chain)}</td><td>{name(item.moderator)}</td><td>{effect.w_label}</td><td>{fmt(effect.indirect_effect)}</td><td>{fmt(inference?.standard_error ?? inference?.se)}</td><td>{fmtP(inference?.p_value)}</td><td>{low != null && high != null ? `[${fmt(low)}, ${fmt(high)}]` : '—'}</td></tr>;
        }))}</tbody>
      </table>
    </section>}
  </div>;
};

const CustomSlope: React.FC<{ effect: NonNullable<ModerationData['moderating_effects']>[number]; fmt: (value: unknown) => string }> = ({ effect, fmt }) => {
  const [value, setValue] = useState('');
  const level = Number(value);
  const b1 = effect.estimates?.beta_source;
  const b3 = effect.estimates?.beta_interaction;
  const valid = value.trim() !== '' && Number.isFinite(level) && typeof b1 === 'number' && typeof b3 === 'number';
  return <div className="moderation-custom">
    <label>Custom moderator value <input type="number" value={value} onChange={event => setValue(event.target.value)} placeholder="e.g. 0.5" /></label>
    {valid && <span>Conditional slope: <strong>{fmt(b1 + b3 * level)}</strong></span>}
    {valid && <span className="moderation-note">Point estimate only; bootstrap inference is available for the listed levels.</span>}
  </div>;
};

const SlopeChart: React.FC<{ slopes: NonNullable<ModerationData['moderating_effects']>[number]['simple_slopes']; predictor: string; outcome: string }> = ({ slopes, predictor, outcome }) => {
  const series = (slopes || []).map(slope => ({ label: slope.moderator_level || 'Moderator level', points: (slope.line_points || []).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) })).filter(line => line.points.length > 1);
  if (!series.length) return null;
  const points = series.flatMap(line => line.points);
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const x = (v: number) => 48 + (v - minX) / (maxX - minX || 1) * 320;
  const y = (v: number) => 170 - (v - minY) / (maxY - minY || 1) * 130;
  const colors = ['var(--color-accent)', 'var(--color-text-primary)', 'var(--color-text-muted)'];
  return <div className="moderation-chart">
    <svg viewBox="0 0 400 205" role="img" aria-label={`Simple slopes of ${predictor} predicting ${outcome}`}>
      <path d="M48 32V170H368" fill="none" stroke="var(--color-border-strong)" />
      <text x="44" y="35" textAnchor="end" fill="var(--color-text-muted)" fontSize="9">{maxY.toPrecision(3)}</text>
      <text x="44" y="173" textAnchor="end" fill="var(--color-text-muted)" fontSize="9">{minY.toPrecision(3)}</text>
      <text x="48" y="184" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9">{minX.toPrecision(3)}</text>
      <text x="368" y="184" textAnchor="middle" fill="var(--color-text-muted)" fontSize="9">{maxX.toPrecision(3)}</text>
      {series.map((line, index) => <polyline key={`${line.label}-${index}`} points={line.points.map(p => `${x(p.x)},${y(p.y)}`).join(' ')} fill="none" stroke={colors[index % colors.length]} strokeWidth="2" strokeDasharray={index === 1 ? '6 3' : index === 2 ? '2 3' : undefined} />)}
      <text x="208" y="197" textAnchor="middle" fill="var(--color-text-muted)" fontSize="11">{predictor}</text>
      <text x="13" y="100" textAnchor="middle" fill="var(--color-text-muted)" fontSize="11" transform="rotate(-90 13 100)">{outcome}</text>
    </svg>
    <div className="moderation-chart__legend">{series.map((line, index) => <span key={`${line.label}-${index}`}><i style={{ borderTop: `2px ${index ? 'dashed' : 'solid'} ${colors[index % colors.length]}` }} />{line.label}</span>)}</div>
  </div>;
};
