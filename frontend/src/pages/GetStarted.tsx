import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import WorkspaceModal from '../components/WorkspaceModal';
import AppSidebar from '../components/AppSidebar';
import InputDialog from '../components/InputDialog';
import { api } from '../utils/api';
import { promptOpenWorkspaceFolder } from '../utils/workspace-import';

const GetStarted = () => {
  const navigate = useNavigate();
  const {
    workspaces,
    activeWorkspaceId,
    addWorkspace,
    setActiveWorkspace,
    openTab,
    togglePinWorkspace,
    archivedWorkspaces,
    studies,
    settings,
  } = useStore();
  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    if (Boolean(a.isPinned) !== Boolean(b.isPinned)) return a.isPinned ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const [inputDialogConfig, setInputDialogConfig] = useState<{isOpen: boolean; title: string; placeholder: string; submitLabel: string; initialValue?: string; onSubmit: (val: string) => void}>({
    isOpen: false, title: '', placeholder: '', submitLabel: '', onSubmit: () => {}
  });
  const importDropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isImportMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (importDropdownRef.current && !importDropdownRef.current.contains(e.target as Node)) {
        setIsImportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isImportMenuOpen]);

  const rename = (title: string, initialValue: string, onSubmit: (name: string) => void) => {
    setInputDialogConfig({
      isOpen: true,
      title,
      placeholder: 'Enter new name...',
      submitLabel: 'Save',
      initialValue,
      onSubmit: (newName) => {
        if (newName.trim()) onSubmit(newName.trim());
      }
    });
  };

  const handleOpenWorkspaceItem = (ws: { id: string; name: string; path?: string }) => {
    setActiveWorkspace(ws.id);
    openTab({ type: 'workspace', title: ws.name, workspaceId: ws.id });
    if (ws.path) {
      api.openWorkspace(ws.path).catch((err) => {
        console.warn('Failed opening workspace path:', err);
      });
    }
  };

  const handleExportWorkspace = async (ws: { id: string; name: string; path?: string }) => {
    if (!ws.path) {
      alert('This workspace does not have a saved directory path on disk.');
      return;
    }
    try {
      let selected: string | null = null;
      const safeName = (ws.name || 'Workspace').replace(/[/\\?%*:|"<>]/g, '_');
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        selected = await save({
          title: 'Export Workspace Archive',
          defaultPath: `${safeName}.zip`,
          filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        });
      } catch {
        selected = window.prompt('Enter destination file path for .zip archive:', `${safeName}.zip`);
      }

      if (!selected) return;

      const outZipPath = selected.endsWith('.zip') ? selected : `${selected}.zip`;
      const res = await api.exportWorkspaceZip(ws.path, outZipPath);
      if (res?.error) {
        alert(`Export failed: ${res.error}`);
      }
    } catch (err: any) {
      console.error('Failed to export workspace:', err);
      alert(`Failed to export workspace: ${err?.message || err}`);
    }
  };

  const handleOpenSampleStudy = () => {
    openTab({ id: 'tab-samples', type: 'samples', title: 'Sample Studies' });
  };

  const handleOpenWebsite = () => {
    const url = settings?.websiteUrl || 'https://statsem.org';
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleOpenWorkspace = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Open Workspace Folder'
      });
      if (selected && typeof selected === 'string') {
        const res = await api.openWorkspace(selected);
        if (res?.error) {
          alert(res.error);
          return;
        }
        const wsName = res?.workspace?.name || selected.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || 'Workspace';
        const existing = workspaces.find(w => w.path === selected);
        const wsId = existing ? existing.id : selected;
        if (!existing) {
          addWorkspace({
            id: wsId,
            name: wsName,
            path: selected
          });
        }
        setActiveWorkspace(wsId);
        openTab({ type: 'workspace', title: wsName, workspaceId: wsId });
      }
    } catch (err) {
      console.warn('Tauri open dialog error:', err);
      const fallback = window.prompt('Enter workspace directory path:');
      if (fallback) {
        const res = await api.openWorkspace(fallback);
        if (res?.error) {
          alert(res.error);
          return;
        }
        const wsName = res?.workspace?.name || fallback.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || 'Workspace';
        const existing = workspaces.find(w => w.path === fallback);
        const wsId = existing ? existing.id : fallback;
        if (!existing) {
          addWorkspace({
            id: wsId,
            name: wsName,
            path: fallback
          });
        }
        setActiveWorkspace(wsId);
        openTab({ type: 'workspace', title: wsName, workspaceId: wsId });
      }
    }
  };

  return (
    <>
      <div className="app-body">
        <AppSidebar />

        <main className="main-content">
          <div className="main-content__inner">

            <div className="page-header animate-fade-in">
              <div className="page-header__text">
                <h1 className="page-header__title">Get Started</h1>
                <p className="page-header__subtitle">Welcome to StatSEM. Set up your workspace or explore guided sample models to begin.</p>
              </div>
              <div className="page-header__actions">
                <div style={{ position: 'relative', zIndex: 100, display: 'inline-flex' }} ref={importDropdownRef}>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => setIsImportMenuOpen((prev) => !prev)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span className="material-symbols-outlined">folder_open</span>
                    <span>Import / Open</span>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', marginLeft: '-2px' }}>
                      {isImportMenuOpen ? 'arrow_drop_up' : 'arrow_drop_down'}
                    </span>
                    <kbd className="kbd">⌘O</kbd>
                  </button>

                  {isImportMenuOpen && (
                    <div className="no-drag import-dropdown-menu">
                      <button
                        type="button"
                        className="import-dropdown-item"
                        onClick={() => {
                          setIsImportMenuOpen(false);
                          promptOpenWorkspaceFolder('folder');
                        }}
                      >
                        <span className="material-symbols-outlined import-dropdown-item__icon">
                          folder_open
                        </span>
                        <div className="import-dropdown-item__text">
                          <div className="import-dropdown-item__title">Open Workspace Folder</div>
                          <div className="import-dropdown-item__subtitle">Existing workspace folder</div>
                        </div>
                      </button>

                      <div className="import-dropdown-divider" />

                      <button
                        type="button"
                        className="import-dropdown-item"
                        onClick={() => {
                          setIsImportMenuOpen(false);
                          promptOpenWorkspaceFolder('zip');
                        }}
                      >
                        <span className="material-symbols-outlined import-dropdown-item__icon">
                          archive
                        </span>
                        <div className="import-dropdown-item__text">
                          <div className="import-dropdown-item__title">Import Archive (.zip)</div>
                          <div className="import-dropdown-item__subtitle">Workspace or Study archive</div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
                <button className="btn btn-primary" type="button" onClick={() => setIsWorkspaceModalOpen(true)}>
                  <span className="material-symbols-outlined">add</span>
                  <span>Create Workspace</span>
                  <kbd className="kbd">⌘W</kbd>
                </button>
              </div>
            </div>

            {/* ─── Main Section: Recent Workspaces (Full Screen Width) ─── */}
            {workspaces.length > 0 && (
              <div className="animate-fade-in animate-fade-in-delay-1">
                <div className="section-header">
                  <h2 className="section-header__title">Recent Workspaces</h2>
                </div>

                <div className="workspace-grid">
                  {sortedWorkspaces.slice(0, 8).map((ws) => (
                    <div
                      key={ws.id}
                      className={`project-card ${ws.isPinned ? 'project-card--pinned' : ''}`}
                      style={{
                        cursor: 'pointer',
                        position: 'relative',
                        borderLeft: ws.isPinned ? '3px solid var(--color-accent)' : undefined,
                        paddingRight: '68px',
                      }}
                      onClick={() => handleOpenWorkspaceItem(ws)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        useStore.getState().openContextMenu(e.clientX, e.clientY, [
                          {
                            id: 'open',
                            label: 'Open Workspace',
                            icon: 'folder_open',
                            action: () => handleOpenWorkspaceItem(ws),
                          },
                          {
                            id: 'pin',
                            label: ws.isPinned ? 'Unpin Workspace' : 'Pin Workspace to Top',
                            icon: 'push_pin',
                            action: () => togglePinWorkspace(ws.id),
                          },
                          {
                            id: 'rename',
                            label: 'Rename Workspace',
                            icon: 'edit',
                            action: () => {
                              rename('Rename Workspace', ws.name, (newName) => {
                                useStore.getState().renameWorkspace(ws.id, newName);
                              });
                            },
                          },
                          {
                            id: 'duplicate',
                            label: 'Duplicate Workspace',
                            icon: 'content_copy',
                            action: () => useStore.getState().duplicateWorkspace(ws.id),
                          },
                          {
                            id: 'export-workspace',
                            label: 'Export Workspace…',
                            icon: 'archive',
                            action: () => handleExportWorkspace(ws),
                          },
                          {
                            id: 'archive',
                            label: 'Archive Workspace',
                            icon: 'inventory_2',
                            action: () => useStore.getState().archiveWorkspace(ws.id),
                          },
                          {
                            id: 'delete',
                            label: 'Delete Workspace',
                            icon: 'delete',
                            danger: true,
                            action: () => {
                              useStore.getState().requestDelete({
                                title: 'Delete Workspace',
                                itemName: ws.name,
                                message:
                                  'Are you sure? This workspace and all its contents will be permanently deleted and cannot be recovered.',
                                onConfirm: async () => {
                                  if (ws.path) {
                                    try {
                                      await api.deleteWorkspace(ws.path);
                                    } catch (err) {
                                      console.warn('Failed deleting workspace files:', err);
                                    }
                                  }
                                  useStore.getState().deleteWorkspace(ws.id);
                                },
                              });
                            },
                          },
                        ]);
                      }}
                    >
                      <div
                        className={`project-card__hover-actions ${ws.isPinned ? 'has-active' : ''}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!ws.isPinned && (
                          <button
                            type="button"
                            className="project-card-action-btn"
                            title="Archive workspace"
                            onClick={(e) => {
                              e.stopPropagation();
                              useStore.getState().archiveWorkspace(ws.id);
                            }}
                          >
                            <span className="material-symbols-outlined">inventory_2</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className={`project-card-action-btn ${ws.isPinned ? 'active' : ''}`}
                          title={ws.isPinned ? 'Unpin workspace' : 'Pin workspace to top'}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinWorkspace(ws.id);
                          }}
                        >
                          <span className="material-symbols-outlined">push_pin</span>
                        </button>
                      </div>

                      <div className="project-card__content" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <div className="project-card__info" style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                          <span
                            className="material-symbols-outlined"
                            style={{
                              fontSize: '20px',
                              color: ws.isPinned ? 'var(--color-accent)' : undefined,
                              flexShrink: 0,
                            }}
                          >
                            folder
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <h3 className="project-card__title">
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{ws.name}</span>
                            </h3>
                            <p className="project-card__desc" style={{ fontSize: '11px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {ws.path || 'Local Workspace'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ─── Lower Section: Release Notes | Sample Studies | Resources ─── */}
            <div className="get-started-lower-grid animate-fade-in animate-fade-in-delay-2">
              {/* Left Column: Release Notes */}
              <div className="lower-col">
                <div className="section-header">
                  <h2 className="section-header__title">Release Notes</h2>
                  <span className="release-card__version">v1.1.0</span>
                </div>

                <div className="release-card">
                  <div className="release-card__items">
                    <div className="release-item">
                      <div>
                        <span className="release-item__title">HTMT2 Discriminant Validity:</span>{' '}
                        Inference criteria implementing Henseler et al. (2023) unbiased geometric mean ratios.
                      </div>
                    </div>
                    <div className="release-item">
                      <div>
                        <span className="release-item__title">AVX-512 Matrix Subsystem:</span>{' '}
                        Vectorized LAPACK dense solver delivering 4.8x acceleration in inverse covariance decomposition.
                      </div>
                    </div>
                    <div className="release-item">
                      <div>
                        <span className="release-item__title">Consistent PLSc:</span>{' '}
                        Asymptotic normality correction for composite structures with parallel multi-core resampling.
                      </div>
                    </div>
                  </div>

                  <div className="release-card__footer">
                    <span className="release-card__date">November 18, 2024</span>
                    <button
                      className="release-card__changelog"
                      type="button"
                      onClick={() => openTab({ type: 'changelog', title: 'Changelog' })}
                    >
                      Technical Changelog
                      <span className="material-symbols-outlined">arrow_forward</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Middle Column: Sample Projects */}
              <div className="lower-col">
                <div className="section-header">
                  <h2 className="section-header__title">Sample Studies</h2>
                  <a
                    href="#"
                    className="section-header__link"
                    onClick={(e) => {
                      e.preventDefault();
                      openTab({ id: 'tab-samples', type: 'samples', title: 'Sample Studies' });
                    }}
                  >
                    More
                  </a>
                </div>

                <div className="project-list">
                  <div
                    onClick={handleOpenSampleStudy}
                    className="project-card"
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="project-card__content" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <div className="project-card__info" style={{ minWidth: 0, flex: 1 }}>
                        <h3 className="project-card__title">Corporate Reputation Model</h3>
                        <p className="project-card__desc">
                          Reflective-formative benchmark assessing competence and likeability on customer retention.
                        </p>
                      </div>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chevron_right</span>
                    </div>
                  </div>

                  <div
                    onClick={handleOpenSampleStudy}
                    className="project-card"
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="project-card__content" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <div className="project-card__info" style={{ minWidth: 0, flex: 1 }}>
                        <h3 className="project-card__title">Customer Satisfaction Index (ACSI/ECSI)</h3>
                        <p className="project-card__desc">
                          Classic standard with consistent PLSc correction for purely reflective latent construct paths.
                        </p>
                      </div>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chevron_right</span>
                    </div>
                  </div>

                  <div
                    onClick={handleOpenSampleStudy}
                    className="project-card"
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="project-card__content" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <div className="project-card__info" style={{ minWidth: 0, flex: 1 }}>
                        <h3 className="project-card__title">Technology Acceptance Model (TAM 3)</h3>
                        <p className="project-card__desc">
                          Moderated mediation investigating perceived usefulness and ease of use with interaction terms.
                        </p>
                      </div>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chevron_right</span>
                    </div>
                  </div>

                  <div
                    onClick={handleOpenSampleStudy}
                    className="project-card"
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="project-card__content" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <div className="project-card__info" style={{ minWidth: 0, flex: 1 }}>
                        <h3 className="project-card__title">Meta-Analysis &amp; Moderation</h3>
                        <p className="project-card__desc">
                          Two-stage PLS-SEM tutorial template with random-effects weighting and latent moderation analysis.
                        </p>
                      </div>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chevron_right</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: 4 Resource Buttons */}
              <div className="lower-col">
                <div className="section-header">
                  <h2 className="section-header__title">Resources</h2>
                </div>

                <div className="project-list">
                  <div
                    className="project-card"
                    style={{ cursor: 'pointer' }}
                    onClick={() => openTab({ id: 'tab-archive', type: 'archive', title: 'Archive' })}
                  >
                    <div className="project-card__content" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <div className="project-card__info" style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>inventory_2</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <h3 className="project-card__title">Archive</h3>
                          <p className="project-card__desc" style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>View archived workspaces and studies</p>
                        </div>
                      </div>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chevron_right</span>
                    </div>
                  </div>

                  <div
                    className="project-card"
                    style={{ cursor: 'pointer' }}
                    onClick={() => openTab({ id: 'tab-docs', type: 'docs', title: 'Documentation' })}
                  >
                    <div className="project-card__content" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <div className="project-card__info" style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>menu_book</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <h3 className="project-card__title">Documentation</h3>
                          <p className="project-card__desc" style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>User manuals and tutorials</p>
                        </div>
                      </div>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chevron_right</span>
                    </div>
                  </div>

                  <div
                    className="project-card"
                    style={{ cursor: 'pointer' }}
                    onClick={() => openTab({ id: 'tab-feedback', type: 'feedback', title: 'Feedback & Reports' })}
                  >
                    <div className="project-card__content" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <div className="project-card__info" style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>feedback</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <h3 className="project-card__title">Feedbacks and Report</h3>
                          <p className="project-card__desc" style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Submit feedback or report an issue</p>
                        </div>
                      </div>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>chevron_right</span>
                    </div>
                  </div>

                  <div
                    className="project-card"
                    style={{ cursor: 'pointer' }}
                    onClick={handleOpenWebsite}
                  >
                    <div className="project-card__content" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <div className="project-card__info" style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>language</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <h3 className="project-card__title">Website</h3>
                          <p className="project-card__desc" style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>statsem.org</p>
                        </div>
                      </div>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>open_in_new</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

      </div>

      <WorkspaceModal isOpen={isWorkspaceModalOpen} onClose={() => setIsWorkspaceModalOpen(false)} />
      <InputDialog 
        isOpen={inputDialogConfig.isOpen} 
        onClose={() => setInputDialogConfig(prev => ({...prev, isOpen: false}))}
        title={inputDialogConfig.title}
        placeholder={inputDialogConfig.placeholder}
        submitLabel={inputDialogConfig.submitLabel}
        onSubmit={inputDialogConfig.onSubmit}
      />
    </>
  );
};

export default GetStarted;
