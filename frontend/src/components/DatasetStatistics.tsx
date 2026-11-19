import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ParsedDataset } from '../utils/dataset-parser';
import { api } from '../utils/api';
import { formatNumber, formatPValue } from '../utils/number-format';

const VariablePicker: React.FC<{ label: string; selected: number[]; options: Array<{ name: string; index: number }>; onChange: (values: number[]) => void }> = ({ label, selected, options, onChange }) => {
  const available = options.filter(option => !selected.includes(option.index));
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  useEffect(() => {
    if (!position) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !popup.current?.contains(target)) setPosition(null);
    };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPosition(null); trigger.current?.focus(); } };
    const reposition = (event: Event) => { if (!popup.current?.contains(event.target as Node)) setPosition(null); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', keyboard);
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', keyboard); window.removeEventListener('resize', reposition); document.removeEventListener('scroll', reposition, true); };
  }, [position]);
  const toggle = () => {
    if (position) { setPosition(null); return; }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const height = Math.min(200, Math.max(80, Math.max(spaceBelow, rect.top - 8)));
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 188)), top: spaceBelow >= height ? rect.bottom + 4 : Math.max(8, rect.top - height - 4), maxHeight: height });
  };
  return <section className="dataset-variable-picker">
    <div className="dataset-variable-picker__header"><span>{label}</span>
      <button ref={trigger} type="button" className="dataset-variable-picker__add" aria-label={`Add ${label.toLowerCase()}`} aria-expanded={!!position} aria-haspopup="menu" title={`Add ${label.toLowerCase()}`} onClick={toggle}><span className="material-symbols-outlined">add</span></button>
      {position && createPortal(<div ref={popup} role="menu" className="dataset-variable-picker__options" style={position}>{available.length ? available.map(option => <button key={option.index} role="menuitem" type="button" onClick={() => { onChange([...selected, option.index]); setPosition(null); trigger.current?.focus(); }}>{option.name}</button>) : <span>No more variables</span>}</div>, document.body)}
    </div>
    {selected.length > 0 && <div className="dataset-variable-picker__selected">{selected.map(index => <span key={index} className="dataset-variable-picker__chip">{options.find(option => option.index === index)?.name ?? `Variable ${index + 1}`}<button type="button" aria-label={`Remove ${options.find(option => option.index === index)?.name ?? 'variable'}`} onClick={() => onChange(selected.filter(value => value !== index))}>×</button></span>)}</div>}
  </section>;
};

const numeric = (value: unknown): number | null => {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const fmt = (value: unknown) => formatNumber(value, 4, 'point');
const pval = (value: unknown) => formatPValue(value, 4, 'point');

async function fingerprint(dataset: ParsedDataset, columns: number[]): Promise<string> {
  let a = 2166136261, b = 2246822519;
  const add = (value: string) => { for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 3266489917); } };
  add(JSON.stringify(columns.map(index => dataset.variables[index]?.name)));
  for (let i = 0; i < dataset.rows.length; i++) {
    add(JSON.stringify(columns.map(index => dataset.rows[i]?.[index] ?? null)));
    if (i % 4096 === 4095) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}-${dataset.rows.length}`;
}

type SavedRun = { id: string; data: { test: string; result: any; levels: string[]; levels2?: string[]; outcomeNames?: string[]; factorNames?: string[]; columns: number[]; signature: string; description: string }; created_at: string };
export const DatasetStatistics: React.FC<{ dataset: ParsedDataset; projectPath?: string }> = ({ dataset, projectPath }) => {
  const variables = dataset.variables;
  const numericColumns = variables.map((v, i) => ({ ...v, index: i })).filter(v => v.type === 'numeric');
  const [view, setView] = useState<'normality' | 'tests'>('normality');
  const [outcome, setOutcome] = useState(numericColumns[0]?.index ?? 0);
  const [second, setSecond] = useState(numericColumns[1]?.index ?? numericColumns[0]?.index ?? 0);
  const [group, setGroup] = useState(0);
  const [group2, setGroup2] = useState<number | null>(null);
  const [interaction, setInteraction] = useState(true);
  const [test, setTest] = useState('welch');
  const [extraOutcomes, setExtraOutcomes] = useState<number[]>([]);
  const [covariates, setCovariates] = useState<number[]>([]);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [normalityMap, setNormalityMap] = useState<Record<number, any>>({});
  const [normalityErrors, setNormalityErrors] = useState<Record<number, string>>({});
  const [normalityProgress, setNormalityProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const [selectedRun, setSelectedRun] = useState('');
  const [savedStatus, setSavedStatus] = useState('');
  const [savedStale, setSavedStale] = useState<boolean | null>(null);
  const runVersion = useRef(0);
  const levels = useMemo(() => {
    const found = new Set<string>();
    for (const row of dataset.rows) {
      if (row[group] != null && String(row[group]).trim() !== '') found.add(String(row[group]));
      if (found.size > 30) break;
    }
    return Array.from(found).sort();
  }, [dataset.rows, group]);
  const levels2 = useMemo(() => {
    if (group2 === null) return [];
    const found = new Set<string>();
    for (const row of dataset.rows) {
      if (row[group2] != null && String(row[group2]).trim() !== '') found.add(String(row[group2]));
      if (found.size > 12) break;
    }
    return Array.from(found).sort();
  }, [dataset.rows, group2]);
  useEffect(() => { setA(levels[0] ?? ''); setB(levels[1] ?? ''); }, [levels]);
  useEffect(() => {
    let cancelled = false;
    if (projectPath && dataset.id) api.listDatasetStatistics(projectPath, dataset.id).then(runs => { if (!cancelled) setSavedRuns(runs); }).catch(err => { if (!cancelled) setSavedStatus(err.message); });
    return () => { cancelled = true; };
  }, [projectPath, dataset.id]);
  const saved = savedRuns.find(run => run.id === selectedRun);
  useEffect(() => {
    let cancelled = false;
    setSavedStale(null);
    if (saved) void fingerprint(dataset, saved.data.columns).then(hash => { if (!cancelled) setSavedStale(hash !== saved.data.signature); });
    return () => { cancelled = true; };
  }, [dataset.rows, dataset.variables, saved]);
  useEffect(() => { runVersion.current++; setBusy(false); setResult(null); setError(''); }, [dataset.rows, dataset.variables, outcome, second, group, group2, interaction, test, a, b, extraOutcomes, covariates]);
  useEffect(() => {
    let cancelled = false;
    setNormalityMap({}); setNormalityErrors({}); setNormalityProgress(0);
    const runAll = async () => {
      for (const variable of numericColumns) {
        if (cancelled) return;
        const values = dataset.rows.map(row => numeric(row[variable.index])).filter((v): v is number => v !== null);
        try {
          const value = await api.datasetStatistics({ test: 'normality', values });
          if (!cancelled) setNormalityMap(previous => ({ ...previous, [variable.index]: value }));
        } catch (err) {
          if (!cancelled) setNormalityErrors(previous => ({ ...previous, [variable.index]: err instanceof Error ? err.message : 'Assessment failed' }));
        }
        if (!cancelled) setNormalityProgress(previous => previous + 1);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    };
    void runAll();
    return () => { cancelled = true; };
  }, [dataset.rows, dataset.variables]);
  const normality = saved?.data.test === 'normality' ? saved.data.result : normalityMap[outcome];
  const normalityError = normalityErrors[outcome];
  const run = async () => {
    setBusy(true); setError(''); setResult(null); setSelectedRun(''); setSavedStatus('');
    const version = ++runVersion.current;
    try {
      let payload: Record<string, unknown>;
      if (test === 'paired') {
        const pairs = dataset.rows.map(row => [numeric(row[outcome]), numeric(row[second])] as const).filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[1] !== null);
        if (outcome === second) throw new Error('Select two different variables.');
        payload = { test, a: pairs.map(pair => pair[0]), b: pairs.map(pair => pair[1]) };
      } else if (['ancova', 'manova', 'mancova'].includes(test) || (test === 'anova' && group2 !== null)) {
        if (levels.length > 30 || levels.length < 2) throw new Error('Choose a grouping variable with 2 to 30 groups.');
        const outcomes = test === 'ancova' || test === 'anova' ? [outcome] : [outcome, ...extraOutcomes];
        const covs = test === 'manova' || test === 'anova' ? [] : covariates;
        const columns = [...outcomes, ...covs];
        if (new Set(columns).size !== columns.length || columns.includes(group) || (group2 !== null && (group === group2 || columns.includes(group2)))) throw new Error('Choose distinct outcome, covariate and group variables.');
        if (['manova', 'mancova'].includes(test) && outcomes.length < 2) throw new Error('Select at least two outcome variables.');
        if (['ancova', 'mancova'].includes(test) && !covs.length) throw new Error('Select at least one covariate.');
        if (group2 !== null && (levels.length > 12 || levels2.length < 2 || levels2.length > 12 || levels.length * levels2.length > 40)) throw new Error('Each factor needs 2 to 12 levels and at most 40 combinations.');
        const complete = dataset.rows.flatMap(row => {
          const level = row[group] == null ? -1 : levels.indexOf(String(row[group]));
          const values = columns.map(index => numeric(row[index]));
          const level2 = group2 === null || row[group2] == null ? -1 : levels2.indexOf(String(row[group2]));
          return level < 0 || (group2 !== null && level2 < 0) || values.some(value => value === null) ? [] : [{ level, level2, values: values as number[] }];
        });
        payload = { test: group2 === null ? test : 'factorial', interaction, group_codes: complete.map(row => row.level), ...(group2 !== null ? { group2_codes: complete.map(row => row.level2) } : {}), outcomes: outcomes.map((_, i) => complete.map(row => row.values[i])), covariates: covs.map((_, i) => complete.map(row => row.values[outcomes.length + i])) };
      } else {
        if (levels.length > 30) throw new Error('Select a grouping variable with at most 30 groups.');
        const valuesFor = (level: string) => dataset.rows.filter(row => row[group] != null && String(row[group]) === level).map(row => numeric(row[outcome])).filter((v): v is number => v !== null);
        if (group === outcome) throw new Error('The group and outcome variables must be different.');
        if (test === 'welch') {
          if (!a || !b || a === b) throw new Error('Select two different groups.');
          payload = { test, a: valuesFor(a), b: valuesFor(b) };
        } else {
          if (levels.length > 30) throw new Error('Select a grouping variable with at most 30 groups.');
          payload = { test, groups: levels.map(valuesFor) };
        }
      }
      const output = await api.datasetStatistics(payload);
      if (version === runVersion.current) {
        setResult(output);
        if (projectPath && dataset.id) {
          const used = test === 'paired' ? [outcome, second] : ['ancova', 'manova', 'mancova'].includes(test) || (test === 'anova' && group2 !== null) ? [outcome, ...(['ancova','anova'].includes(test) ? [] : extraOutcomes), ...(['manova','anova'].includes(test) ? [] : covariates), group, ...(group2 === null ? [] : [group2])] : [outcome, group];
          const signature = await fingerprint(dataset, used);
          if (version !== runVersion.current) return;
          const id = `dataset_${crypto.randomUUID()}`;
          const description = `${test.toUpperCase()} · ${used.map(index => variables[index]?.name || 'Variable').join(', ')}${test === 'welch' ? ` · ${a} vs ${b}` : ''}`;
          const data = { test, result: output, levels, levels2, outcomeNames: [outcome, ...(['manova','mancova'].includes(test) ? extraOutcomes : [])].map(index => variables[index]?.name), factorNames: [variables[group]?.name, ...(group2 === null ? [] : [variables[group2]?.name])], columns: used, signature, description };
          const response = await api.saveProjectResults({ projectPath, modelId: `dataset:${dataset.id}`, datasetId: dataset.id, algorithm: 'dataset_statistics', analysisType: id, results: data });
          if (response.error || response.status !== 'saved') setSavedStatus(`Could not save result: ${response.error || 'Unknown error'}`);
          else setSavedRuns(previous => [{ id, data, created_at: response.created_at || new Date().toISOString() }, ...previous]);
        } else setSavedStatus('Result is available for this session. Save the dataset in a study to keep it.');
      }
    } catch (err) { if (version === runVersion.current) setError(err instanceof Error ? err.message : 'Calculation failed'); }
    finally { if (version === runVersion.current) setBusy(false); }
  };
  const display = saved?.data.test !== 'normality' && saved ? saved.data.result : result;
  const displayTest = saved?.data.test ?? test;
  const displayLevels = saved?.data.levels ?? levels;
  const displayLevels2 = saved?.data.levels2 ?? levels2;
  const displayOutcomes = saved?.data.outcomeNames ?? [outcome, ...(['manova', 'mancova'].includes(test) ? extraOutcomes : [])].map(index => variables[index]?.name);
  const displayFactors = saved?.data.factorNames ?? [variables[group]?.name, ...(group2 === null ? [] : [variables[group2]?.name])];
  const saveNormality = async () => {
    if (!projectPath || !dataset.id || !normalityMap[outcome]) { setSavedStatus('Save the dataset in a study to keep this assessment.'); return; }
    try {
      setSavedStatus('Saving assessment…');
      const data = { test: 'normality', result: normalityMap[outcome], levels: [], columns: [outcome], signature: await fingerprint(dataset, [outcome]), description: `Normality · ${variables[outcome]?.name}` };
      const id = `dataset_${crypto.randomUUID()}`;
      const response = await api.saveProjectResults({ projectPath, modelId: `dataset:${dataset.id}`, datasetId: dataset.id, algorithm: 'dataset_statistics', analysisType: id, results: data });
      if (response.error || response.status !== 'saved') throw new Error(response.error || 'Unknown error');
      setSavedRuns(previous => [{ id, data, created_at: response.created_at || new Date().toISOString() }, ...previous]);
      setSavedStatus('Assessment saved');
    } catch (err) { setSavedStatus(`Could not save assessment: ${err instanceof Error ? err.message : 'Unknown error'}`); }
  };
  const tables = (data: any, groupNames: string[]) => {
    const simple = Object.entries(data).filter(([key, value]) => !['group_summaries', 'diagnostics', 'post_hoc', 'adjusted_comparisons', 'terms', 'histogram', 'qq'].includes(key) && (typeof value === 'number' || typeof value === 'string'));
    const output: Array<{ name: string; rows: (string | number)[][] }> = [{ name: 'Results', rows: [['Measure', 'Value'], ...simple.map(([key, value]) => [key.replaceAll('_', ' '), value as string | number])] }];
    if (data.group_summaries?.length) output.push({ name: 'Groups', rows: [['Group', 'n', 'Mean', 'SD'], ...data.group_summaries.map((item: any, i: number) => [groupNames[i] || String(i + 1), item.n, item.mean, item.sd])] });
    if (data.post_hoc?.length) output.push({ name: 'Post-hoc', rows: [['Group A', 'Group B', 'Mean difference', 'df', 'p-value', 'Holm adjusted p'], ...data.post_hoc.map((item: any) => [groupNames[item.group_a], groupNames[item.group_b], item.difference, item.df, item.p_value, item.adjusted_p_value])] });
    if (data.terms?.length) output.push({ name: 'Model effects', rows: [['Effect', 'Wilks lambda', 'F', 'Numerator df', 'Denominator df', 'p-value', 'Partial eta squared'], ...data.terms.map((item: any) => [item.term === 'factor_a' ? displayFactors[0] : item.term === 'factor_b' ? displayFactors[1] : 'Interaction', item.wilks_lambda ?? '', item.f, item.df_hypothesis, item.df_error, item.p_value, item.partial_eta_squared ?? ''])] });
    if (data.adjusted_comparisons?.length) output.push({ name: 'Adjusted comparisons', rows: [['Factor', 'Outcome', 'Group A', 'Group B', 'Difference', 'df', 'p-value', 'Holm adjusted p'], ...data.adjusted_comparisons.map((item: any) => [displayFactors[item.factor] || 'Group', displayOutcomes[item.outcome] || `Outcome ${item.outcome + 1}`, (item.factor === 1 ? displayLevels2 : groupNames)[item.group_a], (item.factor === 1 ? displayLevels2 : groupNames)[item.group_b], item.difference, item.df, item.p_value, item.adjusted_p_value])] });
    const diagnostics = data.diagnostics || {};
    const diagRows: (string | number)[][] = [['Diagnostic', 'Statistic', 'p-value']];
    for (const [key, value] of Object.entries(diagnostics)) {
      const entries = Array.isArray(value) ? value : [value];
      entries.forEach((item: any, index: number) => { if (item) diagRows.push([`${key.replaceAll('_', ' ')}${entries.length > 1 ? ` ${index + 1}` : ''}`, item.statistic, item.p_value]); });
    }
    if (diagRows.length > 1) output.push({ name: 'Diagnostics', rows: diagRows });
    if (data.histogram) output.push({ name: 'Histogram', rows: [['Bin', 'Count'], ...data.histogram.map((count: number, i: number) => [i + 1, count])] });
    if (data.qq) output.push({ name: 'Q-Q data', rows: [['Normal quantile', 'Observed value'], ...data.qq] });
    if (data.histogram) output.push({ name: 'Distribution tests', rows: [['Test', 'Statistic', 'p-value'], ['Shapiro–Wilk', data.shapiro_wilk?.statistic ?? '', data.shapiro_wilk?.p_value ?? ''], ['K–S (Lilliefors)', data.lilliefors?.statistic ?? '', data.lilliefors?.p_value ?? ''], ['Jarque–Bera', data.statistic ?? '', data.p_value ?? '']] });
    return output;
  };
  const exportData = async (format: 'csv' | 'xlsx') => {
    const data = view === 'normality' ? normality : display;
    if (!data) return;
    const sections = tables(data, displayLevels);
    sections.unshift({ name: 'Details', rows: [['Dataset', dataset.filename], ['Analysis', saved?.data.description || (view === 'normality' ? `Distribution · ${variables[outcome]?.name}` : `${test.toUpperCase()} · ${variables[outcome]?.name}`)], ['Saved result status', saved ? savedStale === null ? 'Not checked' : savedStale ? 'Dataset changed' : 'Data matches' : 'Current calculation']] });
    let blob: Blob;
    if (format === 'csv') {
      const quote = (v: string | number) => `"${String(v ?? '').replaceAll('"', '""')}"`;
      blob = new Blob([sections.map(section => [quote(section.name), ...section.rows.map(row => row.map(quote).join(','))].join('\r\n')).join('\r\n\r\n')], { type: 'text/csv;charset=utf-8' });
    } else {
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      sections.forEach(section => { const sheet = workbook.addWorksheet(section.name); section.rows.forEach(row => sheet.addRow(row)); });
      blob = new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `dataset-statistics.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const selector = (value: number, onChange: (value: number) => void, choices = numericColumns) => <select value={value} onChange={e => { onChange(Number(e.target.value)); setSelectedRun(''); setResult(null); }}>{choices.map(v => <option key={v.index} value={v.index}>{v.name}</option>)}</select>;
  return <div className="dataset-statistics">
    <div className="subheader__switcher" role="group" aria-label="Dataset analysis">
      <button type="button" className={`subheader__switcher-btn ${view === 'normality' ? 'active' : ''}`} onClick={() => { setView('normality'); setSelectedRun(''); setError(''); }}>Distribution</button>
      <button type="button" className={`subheader__switcher-btn ${view === 'tests' ? 'active' : ''}`} onClick={() => { setView('tests'); setSelectedRun(''); setError(''); }}>Group tests</button>
    </div>
    <div className="dataset-statistics__controls">
      {savedRuns.some(item => view === 'normality' ? item.data.test === 'normality' : item.data.test !== 'normality') && <label>Saved results<select value={selectedRun} onChange={e => setSelectedRun(e.target.value)}><option value="">Current calculation</option>{savedRuns.filter(item => view === 'normality' ? item.data.test === 'normality' : item.data.test !== 'normality').map(item => <option key={item.id} value={item.id}>{item.data.description} · {new Date(item.created_at).toLocaleString()}</option>)}</select></label>}
      {view === 'normality' && !saved && normality && <button type="button" className="results-tool-btn" onClick={() => void saveNormality()}>Save assessment</button>}
      {(view === 'normality' ? normality : display) && <><button type="button" className="results-tool-btn" onClick={() => void exportData('csv')}>Export CSV</button><button type="button" className="results-tool-btn" onClick={() => void exportData('xlsx')}>Export Excel</button></>}
    </div>
    <div className="dataset-statistics__controls">
      {view === 'tests' && <label>Test<select value={test} onChange={e => { setTest(e.target.value); setGroup2(null); setSelectedRun(''); setResult(null); }}><option value="welch">Independent t-test (Welch)</option><option value="paired">Paired t-test</option><option value="anova">ANOVA</option><option value="ancova">ANCOVA</option><option value="manova">MANOVA</option><option value="mancova">MANCOVA</option></select></label>}
      <label>{view === 'normality' ? 'Variable' : 'Outcome'}{selector(outcome, setOutcome)}</label>
      {view === 'tests' && (test === 'paired'
        ? <label>Paired variable{selector(second, setSecond)}</label>
        : <label>Group variable{selector(group, setGroup, variables.map((v, index) => ({ ...v, index })))}</label>)}
      {view === 'tests' && ['anova', 'ancova', 'manova', 'mancova'].includes(test) && <label>Second factor<select value={group2 ?? ''} onChange={e => { setGroup2(e.target.value === '' ? null : Number(e.target.value)); setSelectedRun(''); }}><option value="">None</option>{variables.map((v, index) => index !== group ? <option key={index} value={index}>{v.name}</option> : null)}</select></label>}
      {view === 'tests' && group2 !== null && ['anova', 'ancova', 'manova', 'mancova'].includes(test) && <label>Factor interaction<select value={interaction ? 'yes' : 'no'} onChange={e => { setSelectedRun(''); setInteraction(e.target.value === 'yes'); }}><option value="yes">Include</option><option value="no">Exclude</option></select></label>}
      {view === 'tests' && test === 'welch' && <><label>Group A<select value={a} onChange={e => { setA(e.target.value); setResult(null); }}>{levels.map(level => <option key={level}>{level}</option>)}</select></label><label>Group B<select value={b} onChange={e => { setB(e.target.value); setResult(null); }}>{levels.map(level => <option key={level}>{level}</option>)}</select></label></>}
      {view === 'tests' && <button type="button" className="results-tool-btn results-tool-btn--accent" disabled={busy} onClick={() => void run()}>{busy ? 'Calculating…' : 'Calculate'}</button>}
    </div>
    {view === 'tests' && ['ancova', 'manova', 'mancova'].includes(test) && <div className="dataset-statistics__choices">
      {test !== 'ancova' && <VariablePicker label="Additional outcomes" selected={extraOutcomes} options={numericColumns.filter(v => (v.index !== outcome && (test === 'manova' || !covariates.includes(v.index)) && v.index !== group && v.index !== group2) || extraOutcomes.includes(v.index))} onChange={values => { setSelectedRun(''); setExtraOutcomes(values); }} />}
      {test !== 'manova' && <VariablePicker label="Covariates" selected={covariates} options={numericColumns.filter(v => (v.index !== outcome && (test === 'ancova' || !extraOutcomes.includes(v.index)) && v.index !== group && v.index !== group2) || covariates.includes(v.index))} onChange={values => { setSelectedRun(''); setCovariates(values); }} />}
    </div>}
    {error && <p className="dataset-statistics__note" role="alert">{error}</p>}
    {savedStatus && <p className="dataset-statistics__note" role="status">{savedStatus}</p>}
    {saved && <p className="dataset-statistics__note">{saved.data.description} · {savedStale === null ? 'Checking dataset…' : savedStale ? 'The data used for this result has changed. Recalculate for current data.' : 'Data matches this saved result.'}</p>}
    {view === 'normality' && <p className="dataset-statistics__note">{normalityProgress < numericColumns.length ? `Assessing variables: ${normalityProgress} of ${numericColumns.length}` : `Assessed ${normalityProgress} numeric variables`}</p>}
    {view === 'normality' && normalityError && <p className="dataset-statistics__note" role="alert">{normalityError}</p>}
    {view === 'normality' && normality && <>
      <p className="dataset-statistics__note">Skewness and excess kurtosis describe shape. Normality tests are sensitive to sample size and ties; inspect the plots alongside the test results.</p>
      <table className="dataset-table"><thead><tr><th>Observations</th><th>Mean</th><th>SD</th><th>Skewness</th><th>Excess kurtosis</th></tr></thead><tbody><tr><td>{normality.n}</td><td>{fmt(normality.mean)}</td><td>{fmt(normality.sd)}</td><td>{fmt(normality.skewness)}</td><td>{fmt(normality.excess_kurtosis)}</td></tr></tbody></table>
      <h3>Normality tests</h3>
      <table className="dataset-table"><thead><tr><th>Test</th><th>Statistic</th><th>p-value</th></tr></thead><tbody>
        <tr><td>Shapiro–Wilk</td><td>{fmt(normality.shapiro_wilk?.statistic)}</td><td>{pval(normality.shapiro_wilk?.p_value)}</td></tr>
        <tr><td>Kolmogorov–Smirnov (Lilliefors)</td><td>{fmt(normality.lilliefors?.statistic)}</td><td>{pval(normality.lilliefors?.p_value)}</td></tr>
        <tr><td>Jarque–Bera</td><td>{fmt(normality.statistic)}</td><td>{pval(normality.p_value)}</td></tr>
      </tbody></table>
      <p className="dataset-statistics__note">Shapiro–Wilk is available for 3–5,000 observations; Lilliefors corrects K–S for the fitted mean and standard deviation and requires at least five; Jarque–Bera requires at least eight. A dash indicates an unavailable test.</p>
      <div className="dataset-statistics__plots">
        <section><h3>Distribution and fitted normal curve</h3>{(() => {
          const bins = normality.histogram.length, width = (normality.max - normality.min) / bins;
          const expected = (x: number) => normality.n * width / (normality.sd * Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * ((x - normality.mean) / normality.sd) ** 2);
          const scale = Math.max(...normality.histogram, expected(normality.mean));
          const curve = Array.from({ length: 101 }, (_, i) => { const x = normality.min + i / 100 * (normality.max - normality.min); return `${i ? 'L' : 'M'} ${10 + i * 3} ${125 - expected(x) / scale * 110}`; }).join(' ');
          return <svg viewBox="0 0 320 140" role="img" aria-label="Histogram with fitted normal curve">{normality.histogram.map((count: number, i: number) => <rect key={i} x={i * 300 / bins + 10} y={125 - count / scale * 110} width={Math.max(1, 300 / bins - 1)} height={count / scale * 110} fill="var(--color-accent)" opacity="0.45" />)}<path d={curve} fill="none" stroke="var(--color-accent)" strokeWidth={2} /></svg>;
        })()}<p>{fmt(normality.min)} to {fmt(normality.max)}</p></section>
        <section><h3>Normal Q–Q plot</h3>{(() => {
          const xmin = normality.qq[0][0], xmax = normality.qq[normality.qq.length - 1][0];
          const lower = Math.min(normality.min, normality.mean + normality.sd * xmin);
          const upper = Math.max(normality.max, normality.mean + normality.sd * xmax);
          const xpos = (x: number) => 10 + (x - xmin) / (xmax - xmin) * 300;
          const ypos = (y: number) => 125 - (y - lower) / (upper - lower) * 110;
          return <svg viewBox="0 0 320 140" role="img" aria-label="Observed quantiles against normal quantiles"><line x1="10" y1={ypos(normality.mean + normality.sd * xmin)} x2="310" y2={ypos(normality.mean + normality.sd * xmax)} stroke="var(--color-border-strong)" />{normality.qq.map(([x,y]: number[],i: number) => <circle key={i} cx={xpos(x)} cy={ypos(y)} r="1.8" fill="var(--color-accent)" />)}</svg>;
        })()}<p>Theoretical normal quantiles · observed values</p></section>
      </div>
    </>}
    {view === 'tests' && display && <><p className="dataset-statistics__note">{display.terms || ['ancova','manova','mancova'].includes(displayTest) ? 'Group effects use a linear model. Assumptions include independent observations, appropriate residual distributions, and equal variance or covariance across groups. Covariate models assume common slopes. Multivariate p-values use the Wilks’ lambda F approximation. Rows missing model variables are excluded.' : <>{displayTest === 'anova' ? 'One-way ANOVA assumes independent observations, normally distributed residuals and equal group variances.' : 'Two-sided test. ' + (displayTest === 'paired' ? 'The test assumes independent pairs and approximately normal differences.' : 'Welch’s test assumes independent observations and approximately normal group distributions.')} Missing observations {displayTest === 'paired' ? 'are removed as pairs' : 'are excluded within each group'}.</>}</p>
      <table className="dataset-table"><thead><tr>{Object.keys(display).filter(key => !['group_summaries', 'diagnostics', 'post_hoc', 'adjusted_comparisons', 'terms', 'interaction'].includes(key)).map(key => <th key={key}>{key.replaceAll('_', ' ')}</th>)}</tr></thead><tbody><tr>{Object.entries(display).filter(([key]) => !['group_summaries', 'diagnostics', 'post_hoc', 'adjusted_comparisons', 'terms', 'interaction'].includes(key)).map(([key, value]) => <td key={key}>{key === 'p_value' ? pval(value) : fmt(value)}</td>)}</tr></tbody></table>
      {display.terms?.length > 0 && <section><h3>Model effects</h3><p className="dataset-statistics__note">Effects use sum-to-zero factor coding and compare the full model with each effect removed. Main effects describe equal-weighted marginal effects; interpret them alongside any interaction.</p><table className="dataset-table"><thead><tr><th>Effect</th>{display.terms.some((item: any) => item.wilks_lambda != null) && <th>Wilks’ lambda</th>}<th>F</th><th>Numerator df</th><th>Denominator df</th><th>p-value</th></tr></thead><tbody>{display.terms.map((item: any) => <tr key={item.term}><td>{item.term === 'factor_a' ? displayFactors[0] : item.term === 'factor_b' ? displayFactors[1] : 'Interaction'}</td>{display.terms.some((row: any) => row.wilks_lambda != null) && <td>{fmt(item.wilks_lambda)}</td>}<td>{fmt(item.f)}</td><td>{fmt(item.df_hypothesis)}</td><td>{fmt(item.df_error)}</td><td>{pval(item.p_value)}</td></tr>)}</tbody></table></section>}
      {display.group_summaries && <table className="dataset-table"><thead><tr><th>Group</th><th>n</th><th>Mean</th><th>SD</th></tr></thead><tbody>{display.group_summaries.map((item: any, i: number) => <tr key={displayLevels[i]}><td>{displayLevels[i]}</td><td>{item.n}</td><td>{fmt(item.mean)}</td><td>{fmt(item.sd)}</td></tr>)}</tbody></table>}
      {display.post_hoc?.length > 0 && <section><h3>Pairwise comparisons</h3><p className="dataset-statistics__note">Two-sided Welch comparisons; p-values use Holm adjustment across all group pairs. Undefined comparisons are omitted.</p><table className="dataset-table"><thead><tr><th>Group A</th><th>Group B</th><th>Mean difference</th><th>df</th><th>p-value</th><th>Adjusted p</th></tr></thead><tbody>{display.post_hoc.map((row: any) => <tr key={`${row.group_a}-${row.group_b}`}><td>{displayLevels[row.group_a]}</td><td>{displayLevels[row.group_b]}</td><td>{fmt(row.difference)}</td><td>{fmt(row.df)}</td><td>{pval(row.p_value)}</td><td>{pval(row.adjusted_p_value)}</td></tr>)}</tbody></table></section>}
      {display.adjusted_comparisons?.length > 0 && <section><h3>Adjusted pairwise comparisons</h3><p className="dataset-statistics__note">Model-based two-sided contrasts use the pooled residual variance. Covariates are held equal and other factors are averaged equally; Holm adjustment covers all displayed outcomes and factor pairs. Inspect interactions before interpreting marginal comparisons.</p><table className="dataset-table"><thead><tr><th>Factor</th><th>Outcome</th><th>Group A</th><th>Group B</th><th>Difference</th><th>df</th><th>p-value</th><th>Adjusted p</th></tr></thead><tbody>{display.adjusted_comparisons.map((row: any, i: number) => <tr key={i}><td>{displayFactors[row.factor] || 'Group'}</td><td>{displayOutcomes[row.outcome] || `Outcome ${row.outcome + 1}`}</td><td>{(row.factor === 1 ? displayLevels2 : displayLevels)[row.group_a]}</td><td>{(row.factor === 1 ? displayLevels2 : displayLevels)[row.group_b]}</td><td>{fmt(row.difference)}</td><td>{fmt(row.df)}</td><td>{pval(row.p_value)}</td><td>{pval(row.adjusted_p_value)}</td></tr>)}</tbody></table></section>}
      {display.diagnostics && <section><h3>Assumption diagnostics</h3><p className="dataset-statistics__note">These checks do not establish the assumptions. Normality uses the Jarque–Bera approximation; variance homogeneity uses the median-based Brown–Forsythe test. The group-by-covariate interaction tests common slopes in ANCOVA. Missing entries mean the diagnostic is undefined.</p><table className="dataset-table"><thead><tr><th>Diagnostic</th><th>Statistic</th><th>p-value</th></tr></thead><tbody>{Object.entries(display.diagnostics).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map((item: any, index: number) => <tr key={`${key}-${index}`}><td>{key.replaceAll('_',' ')}{Array.isArray(value) ? ` ${index + 1}` : ''}</td><td>{item ? fmt(item.statistic) : '—'}</td><td>{item ? pval(item.p_value) : '—'}</td></tr>))}</tbody></table></section>}
    </>}
  </div>;
};
