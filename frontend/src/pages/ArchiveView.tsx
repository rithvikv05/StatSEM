import React, { useState } from 'react';
import { useStore, getStudyDatasets } from '../store';
import AppSidebar from '../components/AppSidebar';
import { formatModelType } from './Dashboard';

export const ArchiveView: React.FC = () => {
  const { 
    archivedWorkspaces, 
    restoreWorkspace, 
    studies, 
    models, 
    datasetsByStudy 
  } = useStore();

  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatDisplayDate = (isoStr?: string) => {
    try {
      const d = isoStr ? new Date(isoStr) : new Date();
      if (isNaN(d.getTime())) {
        return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const formatFullDate = (isoStr?: string) => {
    try {
      const d = isoStr ? new Date(isoStr) : new Date();
      if (isNaN(d.getTime())) {
        return new Date().toLocaleString();
      }
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } catch {
      return new Date().toLocaleString();
    }
  };

  return (
    <div className="app-body">
      <AppSidebar activeNav="archive" />

      {/* Main Content */}
      <main className="ws-main">
        <div className="ws-inner">
          <div className="ws-header animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="ws-header__left" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 className="ws-title-editable" style={{ cursor: 'default' }}>Archive</h1>
            </div>
            <div className="ws-header__actions">
              <span
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: 'var(--color-accent)',
                  letterSpacing: '-0.02em',
                }}
                title={`${archivedWorkspaces.length} archived workspace${archivedWorkspaces.length === 1 ? '' : 's'}`}
              >
                {archivedWorkspaces.length}
              </span>
            </div>
          </div>

          <div style={{ flex: '1', display: 'flex', flexDirection: 'column', marginTop: '12px' }}>
            <div className="studies-list">
              {archivedWorkspaces.length ? archivedWorkspaces.map(workspace => {
                const isExpanded = expandedWorkspaces.has(workspace.id);
                const archivedStudies = studies.filter(study => study.workspaceId === workspace.id);
                return (
                  <div className="study-entry archive-entry" key={workspace.id}>
                    <div className="study-row" onClick={() => toggleExpand(workspace.id)}>
                      <div className="study-row__left">
                        <span className="material-symbols-outlined study-folder">inventory_2</span>
                        <span className="study-row__name">{workspace.name}</span>
                      </div>
                      <div className="study-row__meta" style={{ gap: '8px', alignItems: 'center' }}>
                        <span
                          className="file-row__time"
                          style={{
                            fontSize: '11.5px',
                            color: 'var(--color-text-muted)',
                            marginRight: '2px',
                            cursor: 'default',
                          }}
                          title={formatFullDate(workspace.archivedAt)}
                        >
                          {formatDisplayDate(workspace.archivedAt)}
                        </span>
                        <button 
                          className="archive-restore-btn" 
                          type="button" 
                          onClick={event => { 
                            event.stopPropagation(); 
                            restoreWorkspace(workspace.id); 
                          }}
                        >
                          Restore
                        </button>
                        <span className="study-row__chevron" style={{ marginLeft: '-2px' }}>
                          <span className="material-symbols-outlined study-chevron">
                            {isExpanded ? 'expand_less' : 'expand_more'}
                          </span>
                        </span>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="study-children archive-children">
                        {archivedStudies.length ? archivedStudies.map(study => (
                          <div key={study.id}>
                            <div className="file-row archive-readonly">
                              <div className="file-row__left">
                                <span className="material-symbols-outlined">folder</span>
                                <span>{study.name}</span>
                                <span className="file-badge file-badge--default">Study</span>
                              </div>
                              <div className="file-row__meta">
                                <span className="file-row__time">{study.lastModified}</span>
                              </div>
                            </div>
                            {getStudyDatasets(datasetsByStudy, study.id).map(ds => (
                              <div className="file-row archive-readonly archive-file" key={ds.id || ds.filename}>
                                <div className="file-row__left">
                                  <span className="material-symbols-outlined">dataset</span>
                                  <span>{ds.filename}</span>
                                  <span className="file-badge file-badge--default">{ds.rows.length} rows</span>
                                </div>
                              </div>
                            ))}
                            {models.filter(model => model.studyId === study.id).map(model => (
                              <div className="file-row archive-readonly archive-file" key={model.id}>
                                <div className="file-row__left">
                                  <span className="material-symbols-outlined">account_tree</span>
                                  <span>{model.name}</span>
                                  <span className="file-badge file-badge--model-tag">{formatModelType(model.type)}</span>
                                </div>
                                <div className="file-row__meta">
                                  <span className="file-row__time">{model.lastModified}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )) : (
                          <div className="archive-empty">No studies in this workspace.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              }) : (
                <div className="empty-state" style={{ padding: '32px 16px', textAlign: 'center' }}>
                  No archived workspaces.
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ArchiveView;
