import React, { useEffect, useRef, useState } from 'react';
import AppSidebar from '../components/AppSidebar';
import { api } from '../utils/api';
import './power-planner.css';

type Plan = { test: string; tails: string; effect_size: string; alpha: string; power: string; predictors: string; tested_predictors: string; groups: string; allocation_ratio: string; degrees_of_freedom: string };
const defaults: Plan = { test: 'regression', tails: 'two', effect_size: '0.15', alpha: '0.05', power: '0.80', predictors: '3', tested_predictors: '3', groups: '3', allocation_ratio: '1', degrees_of_freedom: '1' };
const labels: Record<string, string> = { regression: 'Multiple regression · F test', anova: 'One-way ANOVA · omnibus', independent_t: 'Independent samples t-test', paired_t: 'Paired samples t-test', one_sample_t: 'One-sample t-test', independent_z: 'Independent means · z-test', one_sample_z: 'One-sample mean · z-test', chi_square: 'Chi-square goodness of fit or independence' };

export default function PowerPlanner() {
  const [plan, setPlan] = useState<Plan>(() => { try { return { ...defaults, ...JSON.parse(sessionStorage.getItem('statsem-study-planner') || '{}') }; } catch { return defaults; } });
  const [result, setResult] = useState<any>(() => { try { return JSON.parse(sessionStorage.getItem('statsem-study-planner-result') || 'null'); } catch { return null; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  useEffect(() => { try { sessionStorage.setItem('statsem-study-planner', JSON.stringify(plan)); } catch { /* Storage can be unavailable. */ } }, [plan]);
  useEffect(() => { try { sessionStorage.setItem('statsem-study-planner-result', JSON.stringify(result)); } catch { /* Storage can be unavailable. */ } }, [result]);
  const update = (key: keyof Plan, value: string) => { requestVersion.current++; setBusy(false); setPlan(previous => ({ ...previous, [key]: value })); setResult(null); setError(''); };
  const run = async () => {
    setBusy(true); setResult(null); setError('');
    const version = ++requestVersion.current;
    try {
      const numeric = (key: Exclude<keyof Plan, 'test' | 'tails'>) => {
        if (!plan[key].trim()) throw new Error('Complete all required fields.');
        const value = Number(plan[key]);
        if (!Number.isFinite(value)) throw new Error('Enter valid numeric values.');
        return value;
      };
      const payload: Record<string, unknown> = { test: plan.test, tails: plan.tails, effect_size: numeric('effect_size'), alpha: numeric('alpha'), power: numeric('power') };
      if (plan.test === 'regression') { payload.predictors = numeric('predictors'); payload.tested_predictors = numeric('tested_predictors'); }
      if (plan.test === 'anova') payload.groups = numeric('groups');
      if (['independent_t','independent_z'].includes(plan.test)) payload.allocation_ratio = numeric('allocation_ratio');
      if (plan.test === 'chi_square') payload.degrees_of_freedom = numeric('degrees_of_freedom');
      const output = await api.planPower(payload);
      if (version === requestVersion.current) setResult(output);
    } catch (err) { if (version === requestVersion.current) setError(err instanceof Error ? err.message : 'Could not calculate sample size'); }
    finally { if (version === requestVersion.current) setBusy(false); }
  };
  const input = (key: Exclude<keyof Plan, 'test' | 'tails'>, label: string, help: string) => <label className="power-planner__field"><span>{label}</span><input type="number" step="any" value={plan[key]} onChange={e => update(key, e.target.value)} /><small>{help}</small></label>;
  const exportCsv = () => {
    if (!result) return;
    const fields: Array<[string, unknown]> = [['Test', labels[plan.test]], ['Effect size', plan.effect_size], ['Alpha', plan.alpha], ['Target power', plan.power], ['Alternative', result.tails], ['Total sample size', result.sample_size], ['Group 1', result.group_1], ['Group 2', result.group_2], ['Per group', result.per_group], ['Achieved power', result.achieved_power], ['Numerator df', result.df1], ['Denominator df', result.df2], ['Critical t', result.critical_t], ['Critical F', result.critical_f], ['Critical z', result.critical_z], ['Critical chi-square', result.critical_chi_square], ['Noncentrality parameter', result.noncentrality]];
    if (plan.test === 'regression') fields.push(['Total predictors', plan.predictors], ['Tested predictors', plan.tested_predictors]);
    if (plan.test === 'anova') fields.push(['Groups', plan.groups]);
    const csv=fields.filter(([,value]) => value != null).map(row => row.map(value => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); const link=document.createElement('a'); link.href=url; link.download='study-plan.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  return <div className="app-body"><AppSidebar activeNav="workspace" /><main className="ws-main"><div className="ws-inner">
    <header className="ws-header"><div className="ws-header__left"><h1 className="ws-title-editable">Study Planner</h1></div></header>
    <div className="power-planner">
      <div className="power-planner__intro"><h2>A priori sample size</h2><p>Choose a test and the effect you want your study to detect. The planner finds the smallest supported sample that reaches your target power.</p></div>
      <div className="power-planner__layout">
        <section className="power-planner__panel"><h3>Study design</h3>
          <label className="power-planner__field"><span>Statistical test</span><select value={plan.test} onChange={e => { const value=e.target.value; requestVersion.current++; setBusy(false); setPlan(previous => ({ ...previous, test: value, effect_size: value === 'regression' ? '0.15' : value === 'anova' ? '0.25' : value === 'chi_square' ? '0.3' : '0.5' })); setResult(null); setError(''); }}>{Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          {input('effect_size', plan.test === 'regression' ? 'Effect size f²' : plan.test === 'anova' ? 'Effect size f' : plan.test === 'chi_square' ? 'Effect size w' : 'Effect size d', plan.test === 'regression' ? 'Cohen’s f² for the predictors tested, conditional on any others.' : plan.test === 'anova' ? 'Cohen’s f across groups.' : plan.test === 'chi_square' ? 'Cohen’s w for the chi-square test.' : plan.test === 'paired_t' ? 'Mean difference divided by the SD of paired differences.' : 'Mean difference divided by the assumed common SD.')}
          {['one_sample_t','paired_t','independent_t','one_sample_z','independent_z'].includes(plan.test) && <label className="power-planner__field"><span>Alternative hypothesis</span><select value={plan.tails} onChange={e => update('tails', e.target.value)}><option value="two">Two-sided</option><option value="one">One-sided</option></select><small>For a one-sided test, the assumed effect must be in the prespecified direction.</small></label>}
          <div className="power-planner__row">{input('alpha', 'Significance level α', 'Probability of a false positive.')}{input('power', 'Target power', 'Probability of detecting the assumed effect.')}</div>
          {plan.test === 'regression' && <>{input('predictors', 'Total predictors', 'All predictors in the full regression model.')}{input('tested_predictors', 'Predictors tested', 'Use the total for the overall model, or fewer to test an R² increase.')}</>}
          {plan.test === 'anova' && input('groups', 'Number of groups', 'Groups are planned at equal size.')}
          {['independent_t','independent_z'].includes(plan.test) && input('allocation_ratio', 'Group 2 / group 1', 'Expected sample size ratio.')}
          {plan.test === 'chi_square' && input('degrees_of_freedom', 'Degrees of freedom', 'For example, (rows − 1) × (columns − 1) for an independence test.')}
          <button className="results-tool-btn results-tool-btn--accent power-planner__calculate" type="button" disabled={busy} onClick={() => void run()}>{busy ? 'Calculating…' : 'Calculate sample size'}</button>
          {error && <p className="power-planner__error" role="alert">{error}</p>}
        </section>
        <section className="power-planner__panel"><h3>Sample size</h3>{result ? <>
          <div className="power-planner__result">{result.sample_size.toLocaleString()} <span>{plan.test === 'paired_t' ? 'pairs' : 'participants'}</span></div>
          <table className="scientific-table"><tbody>
            {result.group_1 != null && <><tr><td>Group 1</td><td>{result.group_1}</td></tr><tr><td>Group 2</td><td>{result.group_2}</td></tr></>}
            {result.per_group != null && <tr><td>Per group</td><td>{result.per_group}</td></tr>}
            <tr><td>Achieved power</td><td>{Number(result.achieved_power).toFixed(4)}</td></tr>{result.critical_f != null && result.critical_t == null && <tr><td>Numerator df</td><td>{result.df1}</td></tr>}{result.critical_chi_square != null && <tr><td>Degrees of freedom</td><td>{result.df1}</td></tr>}{result.critical_t != null && <tr><td>Degrees of freedom</td><td>{result.df2}</td></tr>}{result.critical_f != null && result.critical_t == null && <tr><td>Denominator df</td><td>{result.df2}</td></tr>}<tr><td>{result.critical_z != null ? 'Critical z' : result.critical_chi_square != null ? 'Critical χ²' : result.critical_t != null ? 'Critical t' : 'Critical F'}</td><td>{Number(result.critical_z ?? result.critical_chi_square ?? result.critical_t ?? result.critical_f).toFixed(4)}</td></tr><tr><td>Noncentrality parameter</td><td>{Number(result.noncentrality).toFixed(4)}</td></tr>
          </tbody></table>
          {result.curve?.length > 1 && <div className="power-planner__chart"><h3>Power by sample size</h3>{(() => {
            const min = result.curve[0].sample_size, max = result.curve[result.curve.length - 1].sample_size;
            const x = (n: number) => 34 + (n - min) / (max - min || 1) * 246;
            const y = (p: number) => 118 - p * 100;
            const line = result.curve.map((point: any, i: number) => `${i ? 'L' : 'M'}${x(point.sample_size)} ${y(point.power)}`).join(' ');
            return <svg viewBox="0 0 300 145" role="img" aria-label="Power increases with sample size"><line x1="34" y1="118" x2="280" y2="118" stroke="var(--color-border-strong)" /><line x1="34" y1={y(Number(result.target_power))} x2="280" y2={y(Number(result.target_power))} stroke="var(--color-text-muted)" strokeDasharray="4 4" /><path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" /><circle cx={x(result.sample_size)} cy={y(result.achieved_power)} r="3" fill="var(--color-accent)" /><text x="4" y="21" fontSize="9" fill="var(--color-text-muted)">1.0</text><text x="4" y="120" fontSize="9" fill="var(--color-text-muted)">0.0</text><text x="34" y="133" fontSize="9" fill="var(--color-text-muted)">{min}</text><text x="280" y="133" textAnchor="end" fontSize="9" fill="var(--color-text-muted)">{max}</text></svg>;
          })()}<p>Total sample size · dashed line shows target power.</p></div>}
          <p>The result is the minimum integer sample meeting the target under the assumptions shown.</p>
          <button type="button" className="results-tool-btn" onClick={exportCsv}>Export CSV</button>
        </> : <p>Enter your study assumptions and calculate to see the required sample size.</p>}</section>
      </div>
      <p className="power-planner__note">Currently available for the tests listed above and a priori sample-size planning. Independent t-tests assume a common group variance; z-tests assume known standard deviations. ANOVA assumes independent groups and common variance. Chi-square uses the large-sample approximation. Allow separately for missing data or dropout.</p>
    </div>
  </div></main></div>;
}
