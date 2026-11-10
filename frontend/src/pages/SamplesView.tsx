import React, { useState } from 'react';
import { useStore } from '../store';
import AppSidebar from '../components/AppSidebar';
import { api } from '../utils/api';

interface SampleStudy {
  id: string;
  title: string;
  tag: string;
  constructs: number;
  indicators: number;
  sampleSize: number;
  description: string;
}

const SAMPLE_STUDIES: SampleStudy[] = [
  {
    id: 'corp-rep',
    title: 'Corporate Reputation Model',
    tag: 'Reflective-Formative',
    constructs: 6,
    indicators: 21,
    sampleSize: 344,
    description: 'Benchmark study from Hair et al. (2022). Examines how Competence and Likeability drive Customer Satisfaction and Loyalty.',
  },
  {
    id: 'acsi-ecsi',
    title: 'Customer Satisfaction Index (ACSI / ECSI)',
    tag: 'Reflective Paths',
    constructs: 7,
    indicators: 24,
    sampleSize: 250,
    description: 'Classic European customer satisfaction index with structural paths between Expectations, Quality, Value, and Retention.',
  },
  {
    id: 'tam',
    title: 'Technology Acceptance Model (TAM 3)',
    tag: 'Moderation / Interaction',
    constructs: 5,
    indicators: 18,
    sampleSize: 280,
    description: 'Venkatesh & Bala TAM 3 architecture with Perceived Usefulness, Perceived Ease of Use, Subjective Norm, and Job Relevance.',
  },
  {
    id: 'brand-equity',
    title: 'Consumer Brand Equity Model',
    tag: 'Hierarchical Component',
    constructs: 4,
    indicators: 16,
    sampleSize: 420,
    description: 'Higher-order formative construct model analyzing Brand Awareness, Associations, Perceived Quality, and Brand Loyalty.',
  },
  {
    id: 'job-perf',
    title: 'Job Performance & Leadership Study',
    tag: 'Mediation Model',
    constructs: 5,
    indicators: 15,
    sampleSize: 195,
    description: 'Organizational behavior study exploring how Transformational Leadership impacts Task Performance via Psychological Empowerment.',
  },
  {
    id: 'online-trust',
    title: 'E-Commerce Trust & Purchase Intention',
    tag: 'Multi-Group Ready',
    constructs: 6,
    indicators: 20,
    sampleSize: 512,
    description: 'Consumer trust model across Mobile vs. Desktop shoppers, evaluating Structural Assurance, Perceived Security, and Repeat Purchase.',
  },
  {
    id: 'healthcare',
    title: 'Healthcare Patient Loyalty Framework',
    tag: 'Non-Linear & Complex',
    constructs: 5,
    indicators: 19,
    sampleSize: 310,
    description: 'Service quality assessment in outpatient clinics evaluating Doctor-Patient Communication, Empathy, and Hospital Reputation.',
  },
  {
    id: 'green-purchase',
    title: 'Sustainable Consumption & Green Marketing',
    tag: 'Environmental SEM',
    constructs: 5,
    indicators: 17,
    sampleSize: 365,
    description: 'Pro-environmental behavioral research linking Environmental Concern, Green Value, and Willingness to Pay Premium Prices.',
  },
];

const SamplesView: React.FC = () => {
  const { workspaces, activeWorkspaceId, setActiveWorkspace, openTab, addWorkspace } = useStore();

  const handleOpenSample = async (study: SampleStudy) => {
    const existingWs = workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0];
    if (study.id === 'corp-rep' && existingWs?.path) {
      try {
        await api.loadCorporateReputationTemplate(existingWs.path);
      } catch (err) {
        console.warn('Template load warning:', err);
      }
    }

    if (existingWs) {
      setActiveWorkspace(existingWs.id);
      openTab({ type: 'workspace', title: existingWs.name, workspaceId: existingWs.id });
    } else {
      const sampleWsId = `sample_ws_${Date.now()}`;
      addWorkspace({
        id: sampleWsId,
        name: study.title,
        path: '',
      });
      setActiveWorkspace(sampleWsId);
      openTab({ type: 'workspace', title: study.title, workspaceId: sampleWsId });
    }
  };

  return (
    <div className="app-body">
      <AppSidebar activeNav="samples" />

      <main className="main-content">
        <div className="main-content__inner">
          <div className="page-header animate-fade-in">
            <div className="page-header__text">
              <h1 className="page-header__title">Sample Studies</h1>
              <p className="page-header__subtitle">Explore guided models and standard benchmark datasets to get started.</p>
            </div>
          </div>

          <div className="project-list animate-fade-in">
            {SAMPLE_STUDIES.map((study) => (
              <div
                key={study.id}
                className="project-card"
                onClick={() => handleOpenSample(study)}
                style={{ cursor: 'pointer' }}
              >
                <div className="project-card__content">
                  <div className="project-card__icon">
                    <span className="material-symbols-outlined">science</span>
                  </div>
                  <div className="project-card__info">
                    <div className="project-card__title-row">
                      <h3 className="project-card__title">{study.title}</h3>
                      <span className="project-card__badge project-card__badge--accent">{study.tag}</span>
                    </div>
                    <p className="project-card__desc">{study.description}</p>
                    <div className="project-card__meta">
                      <span>{study.constructs} constructs</span>
                      <span className="project-card__meta-dot">·</span>
                      <span>{study.indicators} indicators</span>
                      <span className="project-card__meta-dot">·</span>
                      <span>N = {study.sampleSize}</span>
                    </div>
                  </div>
                </div>
                <button
                  className="project-card__open-btn"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenSample(study);
                  }}
                >
                  <span>Open</span>
                  <span className="material-symbols-outlined">arrow_forward</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default SamplesView;
