import React, { useEffect, useMemo, useState } from 'react';
import { FileText, FileDown, Loader2 } from 'lucide-react';
import { Checkbox } from './Checkbox';
import { compileReportData, exportPdfReport, exportDocxReport, type ReportConfig } from '../utils/reportGenerator';

export interface ReportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: Omit<ReportConfig, 'includeDiagram' | 'includeMeasurement' | 'includeStructural' | 'includeCollinearity' | 'includeFit' | 'includeSettings' | 'sectionFilter'>;
  currentResultTab?: string;
  currentTableOnly?: boolean;
  currentSectionTitle?: string;
  onSuccessToast?: (msg: string) => void;
}

type ReportFormat = 'pdf' | 'docx';

const titleForTab: Record<string, string[]> = {
  path_coefficients: ['Path Coefficients'], specific_indirect_effects: ['Specific Indirect Effects'],
  total_indirect_effects: ['Total Indirect Effects'], total_effects: ['Total Effects'],
  outer_loadings: ['Outer Loadings'], outer_weights: ['Outer Weights'],
  construct_reliability: ['Construct Reliability'], htmt: ['Discriminant Validity: Heterotrait'],
  fornell_larcker: ['Discriminant Validity: Fornell'], cross_loadings: ['Discriminant Validity: Cross'],
  discriminant: ['Discriminant Validity:'], collinearity: ['Inner Model Collinearity', 'Outer Model Collinearity'],
  r_squared: ['Explained Variance'], f_squared: ['f^2 Effect Sizes'],
  model_fit: ['Model Fit Criteria'], run_details: ['Algorithm & Execution Settings'],
  moderation: ['Moderation:'],
  discriminant_htmt: ['Discriminant Validity: Heterotrait'], discriminant_fornell: ['Discriminant Validity: Fornell'],
  collinearity_inner: ['Inner Model Collinearity'], collinearity_outer: ['Outer Model Collinearity'],
  bootstrap_paths: ['Bootstrapping: Path Coefficients'], bootstrap_loadings: ['Bootstrapping: Outer Loadings'],
};

export const ReportExportModal: React.FC<ReportExportModalProps> = ({
  isOpen, onClose, config, currentResultTab, currentTableOnly = false, currentSectionTitle, onSuccessToast,
}) => {
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [includeDiagram, setIncludeDiagram] = useState(true);
  const sectionSignature = JSON.stringify(compileReportData({ ...config, includeMeasurement: true, includeStructural: true, includeCollinearity: true, includeFit: true, includeSettings: true }).sections.map(section => ({ id: section.title, label: section.title })));
  const availableSections = useMemo<Array<{ id: string; label: string }>>(() => JSON.parse(sectionSignature), [sectionSignature]);
  const [selected, setSelected] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setGenerating(false);
    if (currentTableOnly && currentResultTab) {
      setIncludeDiagram(false);
      const prefixes = currentSectionTitle ? [currentSectionTitle] : titleForTab[currentResultTab] || [];
      const matching = availableSections.filter(section => prefixes.some(prefix => section.id.startsWith(prefix))).map(section => section.id);
      setSelected(matching.length || currentSectionTitle ? matching : availableSections.map(section => section.id));
    } else {
      setIncludeDiagram(true);
      setSelected(availableSections.map(section => section.id));
    }
  }, [isOpen, currentResultTab, currentTableOnly, currentSectionTitle, availableSections]);

  if (!isOpen) return null;

  const allSelected = includeDiagram && selected.length === availableSections.length;
  const toggleAll = () => {
    setIncludeDiagram(!allSelected);
    setSelected(allSelected ? [] : availableSections.map(section => section.id));
  };
  const toggleSection = (id: string, checked: boolean) => {
    setSelected(previous => checked ? [...previous, id] : previous.filter(item => item !== id));
  };
  const handleExport = async () => {
    setGenerating(true);
    setError('');
    const fullConfig: ReportConfig = {
      ...config,
      includeDiagram,
      includeMeasurement: true,
      includeStructural: true,
      includeCollinearity: true,
      includeFit: true,
      includeSettings: true,
      sectionFilter: selected,
    };
    try {
      if (format === 'pdf') await exportPdfReport(fullConfig);
      else if (format === 'docx') await exportDocxReport(fullConfig);
      onSuccessToast?.(`${format.toUpperCase()} report exported`);
      onClose();
    } catch (err: any) {
      console.error('Report export failed:', err);
      setError(err?.message || 'Could not generate the report.');
    } finally {
      setGenerating(false);
    }
  };
  const formats: Array<[ReportFormat, string, React.ReactNode]> = [
    ['pdf', 'PDF', <FileText size={14} />], ['docx', 'Word', <FileDown size={14} />],
  ];

  return (
    <div className="modal-overlay active calculation-overlay" role="presentation">
      <div className="modal calculation-dialog" role="dialog" aria-modal="true" aria-labelledby="report-export-title" style={{ maxWidth: 460, width: 'calc(100% - 32px)' }}>
        <div className="modal__header">
          <div className="modal__title" id="report-export-title">Export report</div>
          {!generating && <button type="button" className="calculation-close" onClick={onClose} aria-label="Close">×</button>}
        </div>
        <div className="modal__body" style={{ padding: '14px 16px 12px' }}>
          {error && <p role="alert" className="calculation-error">{error}</p>}
          <div role="radiogroup" aria-label="Export format" style={{ display: 'flex', border: '1px solid var(--color-border-subtle)', borderRadius: 6, padding: 2, marginBottom: 14 }}>
            {formats.map(([id, label, icon]) => <button key={id} type="button" role="radio" aria-checked={format === id} onClick={() => setFormat(id)} style={{ flex: 1, border: 0, borderRadius: 4, padding: '7px 8px', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: format === id ? 'var(--color-accent)' : 'transparent', color: format === id ? '#fff' : 'var(--color-text-secondary)' }}>{icon}{label}</button>)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
            <span className="modal__label" style={{ fontWeight: 600 }}>Sections to include</span>
            <button type="button" onClick={toggleAll} style={{ border: 0, background: 'transparent', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{allSelected ? 'Clear all' : 'Select all'}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', rowGap: 7, maxHeight: 142, overflowY: 'auto', paddingRight: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}><Checkbox id="report-diagram" checked={includeDiagram} onChange={setIncludeDiagram} /><label htmlFor="report-diagram" style={{ cursor: 'pointer' }}>Model diagram</label></div>
            {availableSections.map(section => <div key={section.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}><Checkbox id={`report-${section.id}`} checked={selected.includes(section.id)} onChange={checked => toggleSection(section.id, checked)} /><label htmlFor={`report-${section.id}`} style={{ cursor: 'pointer' }}>{section.label}</label></div>)}
          </div>
        </div>
        <div className="modal__footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--color-border-subtle)' }}>
          <button type="button" className="modal__btn-cancel" onClick={onClose} disabled={generating}>Cancel</button>
          <button type="button" className="modal__btn-create" onClick={handleExport} disabled={generating || (!includeDiagram && selected.length === 0)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px' }}>
            {generating ? <><Loader2 size={14} className="animate-spin" />Generating…</> : <><FileDown size={14} />{`Export ${format.toUpperCase()}`}</>}
          </button>
        </div>
      </div>
    </div>
  );
};
