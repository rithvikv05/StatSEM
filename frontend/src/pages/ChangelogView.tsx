import React from 'react';
import AppSidebar from '../components/AppSidebar';

interface ReleaseEntry {
  version: string;
  date: string;
  tag: string;
  highlights: { title: string; description: string }[];
}

const RELEASES: ReleaseEntry[] = [
  {
    version: 'v1.1.0',
    date: 'November 18, 2024',
    tag: 'Latest Release',
    highlights: [
      {
        title: 'HTMT2 Discriminant Validity Metric',
        description: 'Implemented Henseler et al. (2023) unbiased geometric mean ratios for accurate discriminant validity checking between correlated latent constructs.',
      },
      {
        title: 'AVX-512 Matrix Subsystem Acceleration',
        description: 'Vectorized dense solver delivering 4.8x acceleration in inverse covariance decomposition and parallel bootstrap resamples.',
      },
      {
        title: 'Consistent PLSc Mode',
        description: 'Added asymptotic normality correction for composite structures with parallel multi-core resampling.',
      },
      {
        title: 'Customizable Pastel Color Schemes',
        description: 'Application-wide custom accent hue selector with pastel palettes and native theme persistence.',
      },
    ],
  },
  {
    version: 'v1.0.4',
    date: 'October 29, 2024',
    tag: 'Maintenance',
    highlights: [
      {
        title: 'Interactive Canvas Variable Drag-and-Drop',
        description: 'Direct indicator assignment from dataset panel onto canvas constructs with automatic type inferencing.',
      },
      {
        title: 'High-Resolution Vector Export (SVG / PDF / PNG)',
        description: 'Lossless publication-ready diagram exports with DPI scaling and custom font embedding.',
      },
      {
        title: 'CSV Delimiter & Encoding Auto-Detection',
        description: 'Robust parser detecting UTF-8, Latin-1, commas, semicolons, and tab delimiters automatically.',
      },
    ],
  },
  {
    version: 'v1.0.0',
    date: 'September 12, 2024',
    tag: 'Initial Release',
    highlights: [
      {
        title: 'Core PLS-SEM Algorithm Engine',
        description: 'Path weighting, centroid, and factor weighting schemes with iterative Wold estimation.',
      },
      {
        title: 'Complete Measurement Model Evaluation',
        description: 'Indicator reliability, composite reliability (rho_A, rho_C), Cronbach’s alpha, and AVE convergence metrics.',
      },
      {
        title: 'Multi-Core Bootstrapping Subsystem',
        description: 'Parallelized studentized t-values, p-values, and percentile confidence interval estimation.',
      },
    ],
  },
];

export const ChangelogView: React.FC = () => {
  return (
    <div className="app-body">
      <AppSidebar activeNav="changelog" />

      <main className="main-content">
        <div className="main-content__inner">
          <div className="page-header animate-fade-in">
            <div className="page-header__text">
              <h1 className="page-header__title">Technical Changelog</h1>
              <p className="page-header__subtitle">Version release history, algorithm optimizations, and platform updates.</p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {RELEASES.map((rel) => (
              <div key={rel.version} className="release-card animate-fade-in">
                <div className="release-card__header">
                  <div className="release-card__header-left">
                    <h2 className="release-card__title">{rel.version}</h2>
                    <span className="release-card__date" style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                      {rel.date}
                    </span>
                  </div>
                  <span className="release-card__version">{rel.tag}</span>
                </div>

                <div className="release-card__items">
                  {rel.highlights.map((item, idx) => (
                    <div key={idx} className="release-item">
                      <div>
                        <span className="release-item__title">{item.title}: </span>
                        {item.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default ChangelogView;
