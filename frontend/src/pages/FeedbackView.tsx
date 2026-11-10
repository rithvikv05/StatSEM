import React, { useState } from 'react';
import AppSidebar from '../components/AppSidebar';

interface FeedbackReport {
  id: string;
  type: 'Bug' | 'Feature' | 'Performance' | 'Question';
  title: string;
  description: string;
  status: 'Open' | 'Under Review' | 'Resolved';
  timestamp: string;
}

const INITIAL_REPORTS: FeedbackReport[] = [
  {
    id: 'rep-1',
    type: 'Feature',
    title: 'Support for higher-order formative constructs (type II/IV)',
    description: 'Two-stage indicator reuse approach directly configured in latent construct node properties.',
    status: 'Under Review',
    timestamp: '2 days ago',
  },
  {
    id: 'rep-2',
    type: 'Performance',
    title: 'Parallel bootstrap acceleration on Apple Silicon (M-series)',
    description: 'Multiprocessing pool scaling gracefully up to 10,000 resamples without memory pressure.',
    status: 'Resolved',
    timestamp: '1 week ago',
  },
];

export const FeedbackView: React.FC = () => {
  const [reports, setReports] = useState<FeedbackReport[]>(INITIAL_REPORTS);
  const [reportType, setReportType] = useState<FeedbackReport['type']>('Bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    const newReport: FeedbackReport = {
      id: `rep_${Date.now()}`,
      type: reportType,
      title: title.trim(),
      description: description.trim(),
      status: 'Open',
      timestamp: 'Just now',
    };

    setReports([newReport, ...reports]);
    setTitle('');
    setDescription('');
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <div className="app-body">
      <AppSidebar activeNav="feedback" />

      <main className="main-content">
        <div className="main-content__inner">
          <div className="page-header animate-fade-in">
            <div className="page-header__text">
              <h1 className="page-header__title">Feedback &amp; Reports</h1>
              <p className="page-header__subtitle">Submit bug reports, feature suggestions, or methodological inquiries.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="release-card animate-fade-in" style={{ padding: '20px', gap: '14px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {(['Bug', 'Feature', 'Performance', 'Question'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setReportType(t)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: reportType === t ? 'var(--color-accent)' : 'var(--color-border-default)',
                    backgroundColor: reportType === t ? 'var(--color-accent-subtle)' : 'var(--color-bg-surface)',
                    color: reportType === t ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Title or summary…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border-default)',
                background: 'var(--color-bg-surface)',
                color: 'var(--color-text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
            />

            <textarea
              placeholder="Detailed description, steps to reproduce, or desired behavior…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={4}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border-default)',
                background: 'var(--color-bg-surface)',
                color: 'var(--color-text-primary)',
                fontSize: '13px',
                outline: 'none',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: submitted ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
                {submitted ? 'Thank you! Report submitted.' : 'Your report helps improve StatSEM.'}
              </span>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ padding: '6px 16px', fontSize: '13px' }}
              >
                Submit Report
              </button>
            </div>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)', margin: '8px 0 4px 0' }}>
              Recent Reports
            </h3>
            <div className="doc-list animate-fade-in">
              {reports.map((rep) => (
                <div key={rep.id} className="doc-card" style={{ cursor: 'default' }}>
                  <div className="doc-card__header">
                    <span className="doc-card__title">
                      <span className="material-symbols-outlined" style={{ color: 'var(--color-accent)' }}>
                        {rep.type === 'Bug' ? 'bug_report' : rep.type === 'Feature' ? 'lightbulb' : 'speed'}
                      </span>
                      {rep.title}
                    </span>
                    <span className="doc-card__read-time">{rep.status}</span>
                  </div>
                  <p className="doc-card__desc">{rep.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default FeedbackView;
