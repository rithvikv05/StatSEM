import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Copy, Check, Download, FileText, Sparkles, BookOpen } from 'lucide-react';

interface NarrativeDraftPanelProps {
  results: any;
  projectPath?: string;
  modelId?: string;
  onExportPdf?: () => void;
  onExportExcel?: () => void;
}

export const NarrativeDraftPanel: React.FC<NarrativeDraftPanelProps> = ({
  results,
  projectPath,
  modelId,
  onExportPdf,
  onExportExcel,
}) => {
  const [style, setStyle] = useState<'apa' | 'plain'>('apa');
  const [loading, setLoading] = useState(false);
  const [narrativeData, setNarrativeData] = useState<{
    full_text?: string;
    sections?: Record<string, { title: string; content: string }>;
  } | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!results && !projectPath) return;

    let active = true;
    setLoading(true);

    api.generateNarrative({ results, projectPath, modelId, style })
      .then((data) => {
        if (!active) return;
        setLoading(false);
        if (data && !data.error) {
          setNarrativeData(data);
        }
      })
      .catch((err) => {
        if (!active) return;
        setLoading(false);
        console.error('Failed to load narrative write-up:', err);
      });

    return () => {
      active = false;
    };
  }, [results, projectPath, modelId, style]);

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const downloadMarkdown = () => {
    if (!narrativeData?.full_text) return;
    const blob = new Blob([narrativeData.full_text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `academic_results_writeup_${style}.md`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const sections = narrativeData?.sections || {};

  return (
    <div className="results-content-pane" style={{ animation: 'fadeIn 0.25s ease-in-out' }}>
      {/* Header Banner */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              Automated Academic Methodology &amp; Results Text Generator
            </h3>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 6,
              background: 'rgba(99, 102, 241, 0.1)',
              color: 'var(--color-accent)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
            }}>
              <Sparkles size={12} />
              Draft My Paper
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Modular, publication-ready academic paragraphs following Hair et al. (2022) with exact dataset values.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Style Selector */}
          <div style={{
            display: 'flex',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 6,
            padding: 2,
          }}>
            <button
              type="button"
              onClick={() => setStyle('apa')}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 4,
                border: 'none',
                background: style === 'apa' ? 'var(--color-accent)' : 'transparent',
                color: style === 'apa' ? '#fff' : 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              APA 7th Edition
            </button>
            <button
              type="button"
              onClick={() => setStyle('plain')}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 4,
                border: 'none',
                background: style === 'plain' ? 'var(--color-accent)' : 'transparent',
                color: style === 'plain' ? '#fff' : 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              Plain English
            </button>
          </div>

          <button
            type="button"
            className="results-tool-btn results-tool-btn--accent"
            onClick={() => narrativeData?.full_text && copyToClipboard(narrativeData.full_text, 'all')}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {copiedKey === 'all' ? <Check size={14} /> : <Copy size={14} />}
            {copiedKey === 'all' ? 'Copied Full Draft!' : 'Copy Full Draft'}
          </button>

          <button
            type="button"
            className="results-tool-btn"
            onClick={downloadMarkdown}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Download size={14} />
            Download .md
          </button>

          {onExportPdf && (
            <button
              type="button"
              className="results-tool-btn"
              onClick={onExportPdf}
            >
              Export PDF
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{
          padding: '48px 20px',
          textAlign: 'center',
          background: 'var(--color-bg-surface)',
          borderRadius: 10,
          border: '1px solid var(--color-border-subtle)',
          color: 'var(--color-text-muted)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Synthesizing academic narrative from empirical results...</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Object.entries(sections).map(([secKey, sec]: [string, any]) => (
            <div
              key={secKey}
              style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 10,
                padding: '18px 22px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)',
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
                borderBottom: '1px solid var(--color-border-subtle)',
                paddingBottom: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BookOpen size={16} style={{ color: 'var(--color-accent)' }} />
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {sec.title}
                  </h4>
                </div>

                <button
                  type="button"
                  onClick={() => copyToClipboard(sec.content, secKey)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--color-border-subtle)',
                    background: copiedKey === secKey ? 'rgba(16, 185, 129, 0.1)' : 'var(--color-bg-base)',
                    color: copiedKey === secKey ? '#10b981' : 'var(--color-text-primary)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {copiedKey === secKey ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === secKey ? 'Copied Section!' : 'Copy Section'}
                </button>
              </div>

              <div style={{
                fontSize: 13.5,
                lineHeight: 1.7,
                color: 'var(--color-text-secondary)',
                whiteSpace: 'pre-wrap',
                fontFamily: style === 'apa' ? "'Georgia', serif" : 'inherit',
              }}>
                {sec.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Benchmark Reference Banner */}
      <div style={{
        marginTop: 20,
        padding: '14px 18px',
        borderRadius: 8,
        background: 'rgba(99, 102, 241, 0.04)',
        border: '1px solid rgba(99, 102, 241, 0.15)',
        fontSize: 12,
        color: 'var(--color-text-muted)',
        lineHeight: 1.6,
      }}>
        <strong>Academic Citation Reference:</strong> The narrative formulations strictly adhere to Hair, J. F., Hult, G. T. M., Ringle, C. M., &amp; Sarstedt, M. (2022). <em>A Primer on Partial Least Squares Structural Equation Modeling (PLS-SEM)</em> (3rd ed.). SAGE Publications; and Henseler, J., Ringle, C. M., &amp; Sarstedt, M. (2015). A new criterion for assessing discriminant validity in variance-based structural equation modeling. <em>Journal of the Academy of Marketing Science</em>, 43(1), 115–135.
      </div>
    </div>
  );
};
