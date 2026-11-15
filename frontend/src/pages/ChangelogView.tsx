import React from 'react';
import AppSidebar from '../components/AppSidebar';
import { useStore } from '../store';
import { BETA_RELEASE_DATE } from '../utils/release-notes';

interface ReleaseEntry {
  version: string;
  date: string;
  tag: string;
  highlights: { title: string; description: string }[];
}

const RELEASES: ReleaseEntry[] = [
  {
    version: 'Beta testing',
    date: BETA_RELEASE_DATE,
    tag: 'Latest',
    highlights: [
      {
        title: 'Welcome',
        description: 'Thank you for trying StatSEM. We hope you enjoy exploring the app and using it to build and analyze your models.',
      },
      {
        title: 'Explore',
        description: 'Try the sample study, create a workspace, build a model, and explore the available analyses and results.',
      },
      {
        title: 'Share your feedback',
        description: 'Please let us know about any bugs, confusing interactions, or ideas for improvement you encounter during testing.',
      },
    ],
  },
];

export const ChangelogView: React.FC = () => {
  const openTab = useStore(state => state.openTab);
  return (
    <div className="app-body">
      <AppSidebar activeNav="changelog" />

      <main className="main-content">
        <div className="main-content__inner">
          <div className="page-header animate-fade-in">
            <div className="page-header__text">
              <h1 className="page-header__title">Changelog</h1>
              <p className="page-header__subtitle">Updates from the StatSEM beta.</p>
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
                <div className="release-card__footer">
                  <button className="release-card__changelog" type="button" onClick={() => openTab({ type: 'feedback', title: 'Feedback & Support' })}>
                    Send feedback <span className="material-symbols-outlined">arrow_forward</span>
                  </button>
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
