import React, { useState } from 'react';
import { FileText, FileDown, Printer, Check, Loader2 } from 'lucide-react';
import { Checkbox } from './Checkbox';
import { exportPdfReport, exportDocxReport, openPrintableReport, type ReportConfig } from '../utils/reportGenerator';

export interface ReportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: Omit<ReportConfig, 'includeDiagram' | 'includeMeasurement' | 'includeStructural' | 'includeCollinearity' | 'includeFit' | 'includeSettings'>;
  onSuccessToast?: (msg: string) => void;
}

type ReportFormat = 'pdf' | 'docx' | 'print';

export const ReportExportModal: React.FC<ReportExportModalProps> = ({
  isOpen,
  onClose,
  config,
  onSuccessToast,
}) => {
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [includeDiagram, setIncludeDiagram] = useState(true);
  const [includeMeasurement, setIncludeMeasurement] = useState(true);
  const [includeStructural, setIncludeStructural] = useState(true);
  const [includeCollinearity, setIncludeCollinearity] = useState(true);
  const [includeFit, setIncludeFit] = useState(true);
  const [includeSettings, setIncludeSettings] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleExport = async () => {
    setGenerating(true);
    setError('');

    const fullConfig: ReportConfig = {
      ...config,
      includeDiagram,
      includeMeasurement,
      includeStructural,
      includeCollinearity,
      includeFit,
      includeSettings,
    };

    try {
      if (format === 'pdf') {
        await exportPdfReport(fullConfig);
        onSuccessToast?.('PDF report generated and exported successfully');
      } else if (format === 'docx') {
        await exportDocxReport(fullConfig);
        onSuccessToast?.('Word document (.docx) generated and exported successfully');
      } else {
        await openPrintableReport(fullConfig);
        onSuccessToast?.('Print preview opened');
      }
      onClose();
    } catch (err: any) {
      console.error('Report export failed:', err);
      setError(err?.message || 'Failed to generate report. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="modal-overlay active calculation-overlay" role="presentation">
      <div
        className="modal calculation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-export-title"
        style={{ maxWidth: '560px', width: '90%' }}
      >
        {/* Header */}
        <div className="modal__header">
          <div>
            <div className="modal__title" id="report-export-title">
              Export Comprehensive Model Report
            </div>
            <div className="modal__subtitle">
              Export all results, calculation tables, and model diagram in publication-ready format.
            </div>
          </div>
          {!generating && (
            <button type="button" className="calculation-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>

        {/* Body */}
        <div className="modal__body" style={{ padding: '20px' }}>
          {error && <p role="alert" className="calculation-error">{error}</p>}

          {/* Format Selector Cards */}
          <div style={{ marginBottom: '20px' }}>
            <span className="modal__label" style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
              Export Format
            </span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '10px',
              }}
            >
              {/* PDF Card */}
              <button
                type="button"
                onClick={() => setFormat('pdf')}
                style={{
                  padding: '12px 10px',
                  borderRadius: '8px',
                  border: format === 'pdf' ? '2px solid var(--color-accent, #2563eb)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                  backgroundColor: format === 'pdf' ? 'var(--color-accent-subtle, #eff6ff)' : 'var(--color-bg-surface, #ffffff)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <FileText size={18} color={format === 'pdf' ? 'var(--color-accent, #2563eb)' : '#64748b'} />
                  {format === 'pdf' && <Check size={14} color="var(--color-accent, #2563eb)" strokeWidth={3} />}
                </div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-primary, #0f172a)' }}>
                  PDF Report
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #64748b)' }}>
                  Formatted PDF document
                </div>
              </button>

              {/* Word (DOCX) Card */}
              <button
                type="button"
                onClick={() => setFormat('docx')}
                style={{
                  padding: '12px 10px',
                  borderRadius: '8px',
                  border: format === 'docx' ? '2px solid var(--color-accent, #2563eb)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                  backgroundColor: format === 'docx' ? 'var(--color-accent-subtle, #eff6ff)' : 'var(--color-bg-surface, #ffffff)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <FileDown size={18} color={format === 'docx' ? 'var(--color-accent, #2563eb)' : '#64748b'} />
                  {format === 'docx' && <Check size={14} color="var(--color-accent, #2563eb)" strokeWidth={3} />}
                </div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-primary, #0f172a)' }}>
                  Word (.docx)
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #64748b)' }}>
                  Editable tables & text
                </div>
              </button>

              {/* Print / HTML Card */}
              <button
                type="button"
                onClick={() => setFormat('print')}
                style={{
                  padding: '12px 10px',
                  borderRadius: '8px',
                  border: format === 'print' ? '2px solid var(--color-accent, #2563eb)' : '1px solid var(--color-border-subtle, #e2e8f0)',
                  backgroundColor: format === 'print' ? 'var(--color-accent-subtle, #eff6ff)' : 'var(--color-bg-surface, #ffffff)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Printer size={18} color={format === 'print' ? 'var(--color-accent, #2563eb)' : '#64748b'} />
                  {format === 'print' && <Check size={14} color="var(--color-accent, #2563eb)" strokeWidth={3} />}
                </div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text-primary, #0f172a)' }}>
                  Print / Preview
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #64748b)' }}>
                  Interactive preview
                </div>
              </button>
            </div>
          </div>

          {/* Sections to Include */}
          <div style={{ marginBottom: '16px' }}>
            <span className="modal__label" style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
              Sections to Include
            </span>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: 'var(--color-bg-raised, #f8fafc)',
                border: '1px solid var(--color-border-subtle, #e2e8f0)',
              }}
            >
              <div className="calculation-check" style={{ margin: 0 }}>
                <Checkbox id="rep-diagram" checked={includeDiagram} onChange={setIncludeDiagram} />
                <label htmlFor="rep-diagram" style={{ cursor: 'pointer', fontSize: '13px' }}>
                  Model Canvas Diagram (Visual graph with constructs, indicators & paths)
                </label>
              </div>

              <div className="calculation-check" style={{ margin: 0 }}>
                <Checkbox id="rep-struct" checked={includeStructural} onChange={setIncludeStructural} />
                <label htmlFor="rep-struct" style={{ cursor: 'pointer', fontSize: '13px' }}>
                  Structural Model (Path coefficients, direct effects, total/indirect effects, R², f²)
                </label>
              </div>

              <div className="calculation-check" style={{ margin: 0 }}>
                <Checkbox id="rep-meas" checked={includeMeasurement} onChange={setIncludeMeasurement} />
                <label htmlFor="rep-meas" style={{ cursor: 'pointer', fontSize: '13px' }}>
                  Measurement Model (Outer loadings, weights, Cronbach's α, CR, rho_A, AVE, HTMT, Fornell-Larcker)
                </label>
              </div>

              <div className="calculation-check" style={{ margin: 0 }}>
                <Checkbox id="rep-coll" checked={includeCollinearity} onChange={setIncludeCollinearity} />
                <label htmlFor="rep-coll" style={{ cursor: 'pointer', fontSize: '13px' }}>
                  Collinearity Diagnostics (Inner VIF and Outer VIF)
                </label>
              </div>

              <div className="calculation-check" style={{ margin: 0 }}>
                <Checkbox id="rep-fit" checked={includeFit} onChange={setIncludeFit} />
                <label htmlFor="rep-fit" style={{ cursor: 'pointer', fontSize: '13px' }}>
                  Model Fit Criteria (SRMR, d_ULS, d_G, Chi-Square, NFI)
                </label>
              </div>

              <div className="calculation-check" style={{ margin: 0 }}>
                <Checkbox id="rep-sett" checked={includeSettings} onChange={setIncludeSettings} />
                <label htmlFor="rep-sett" style={{ cursor: 'pointer', fontSize: '13px' }}>
                  Algorithm Execution Details & Run Parameters
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="modal__footer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            padding: '14px 20px',
            borderTop: '1px solid var(--color-border-subtle, #e2e8f0)',
          }}
        >
          <button type="button" className="modal__btn-cancel" onClick={onClose} disabled={generating}>
            Cancel
          </button>
          <button
            type="button"
            className="modal__btn-create"
            onClick={handleExport}
            disabled={generating}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 18px',
            }}
          >
            {generating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Generating Report…</span>
              </>
            ) : (
              <>
                <FileDown size={14} />
                <span>
                  {format === 'pdf'
                    ? 'Export PDF Report'
                    : format === 'docx'
                    ? 'Export Word Document'
                    : 'Open Print Preview'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
