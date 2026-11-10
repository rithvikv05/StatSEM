import React, { useState } from 'react';
import AppSidebar from '../components/AppSidebar';

interface DocItem {
  id: string;
  category: string;
  title: string;
  description: string;
  tags: string[];
  readTime: string;
}

const DOC_ITEMS: DocItem[] = [
  {
    id: 'intro',
    category: 'Getting Started',
    title: 'Introduction to Partial Least Squares SEM (PLS-SEM)',
    description: 'Foundations of variance-based structural equation modeling, composite models, and exploratory research frameworks.',
    tags: ['Overview', 'Fundamentals'],
    readTime: '5 min read',
  },
  {
    id: 'first-model',
    category: 'Getting Started',
    title: 'Building Your First Path Model in StatSEM',
    description: 'A step-by-step guide to dragging latent constructs, assigning reflective/formative indicators, and drawing structural paths.',
    tags: ['Canvas', 'Tutorial'],
    readTime: '8 min read',
  },
  {
    id: 'data-prep',
    category: 'Data Management',
    title: 'Data Preparation & CSV Guidelines',
    description: 'Importing numerical matrices, handling missing data with mean replacement or EM imputation, and verifying indicator coding.',
    tags: ['Datasets', 'CSV', 'Cleaning'],
    readTime: '6 min read',
  },
  {
    id: 'measurement',
    category: 'Assessment',
    title: 'Reflective Measurement Model Evaluation',
    description: 'Assessing indicator reliability (outer loadings > 0.708), internal consistency (Cronbach’s alpha, composite reliability rho_A, rho_C), and convergent validity (AVE > 0.50).',
    tags: ['Reliability', 'Validity', 'AVE'],
    readTime: '10 min read',
  },
  {
    id: 'htmt2',
    category: 'Assessment',
    title: 'Discriminant Validity: HTMT & HTMT2 Inference',
    description: 'Applying Henseler et al. Heterotrait-Monotrait ratios and HTMT2 geometric mean corrections with bootstrapping inference.',
    tags: ['HTMT2', 'Discriminant'],
    readTime: '7 min read',
  },
  {
    id: 'structural',
    category: 'Assessment',
    title: 'Structural Model Assessment & Hypotheses Testing',
    description: 'Evaluating collinearity (VIF < 3), path coefficients significance, coefficient of determination (R²), and effect size (f²).',
    tags: ['Structural', 'Hypotheses', 'R²'],
    readTime: '9 min read',
  },
  {
    id: 'bootstrapping',
    category: 'Advanced Analysis',
    title: 'Parallel Bootstrapping & Confidence Intervals',
    description: 'Configuring 5,000+ subsamples, percentile vs. bias-corrected BCa intervals, and multi-core matrix acceleration.',
    tags: ['Bootstrap', 'Confidence', 'Performance'],
    readTime: '8 min read',
  },
  {
    id: 'r-bridge',
    category: 'Advanced Analysis',
    title: 'SEMinR R-Bridge & Syntax Export',
    description: 'Seamless two-way integration with R: exporting models directly to clean SEMinR scripts and running external packages.',
    tags: ['R', 'SEMinR', 'Export'],
    readTime: '6 min read',
  },
];

export const DocsView: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const categories = ['All', 'Getting Started', 'Data Management', 'Assessment', 'Advanced Analysis'];

  const filteredDocs = DOC_ITEMS.filter((doc) => {
    const matchesCategory = selectedCategory === 'All' || doc.category === selectedCategory;
    const matchesSearch =
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="app-body">
      <AppSidebar activeNav="docs" />

      <main className="main-content">
        <div className="main-content__inner">
          <div className="page-header animate-fade-in">
            <div className="page-header__text">
              <h1 className="page-header__title">Documentation</h1>
              <p className="page-header__subtitle">Guides, statistical formulas, and practical tutorials for PLS-SEM analysis.</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px 10px',
                width: '280px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-text-muted)', marginRight: '6px' }}>
                search
              </span>
              <input
                type="text"
                placeholder="Filter guides…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--color-text-primary)',
                  fontSize: '13px',
                  width: '100%',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0 }}
                >
                  ×
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: selectedCategory === cat ? 'var(--color-accent)' : 'var(--color-border-default)',
                    backgroundColor: selectedCategory === cat ? 'var(--color-accent-subtle)' : 'var(--color-bg-surface)',
                    color: selectedCategory === cat ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="doc-list animate-fade-in">
            {filteredDocs.map((doc) => (
              <div key={doc.id} className="doc-card">
                <div className="doc-card__header">
                  <span className="doc-card__title">
                    <span className="material-symbols-outlined">description</span>
                    {doc.title}
                  </span>
                  <span className="doc-card__read-time">{doc.readTime}</span>
                </div>
                <p className="doc-card__desc">{doc.description}</p>
              </div>
            ))}
            {filteredDocs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                No documentation guides match "{searchQuery}"
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default DocsView;
