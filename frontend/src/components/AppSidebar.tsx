import React, { useState } from 'react';
import { useStore } from '../store';
import { api } from '../utils/api';
import WorkspaceModal from './WorkspaceModal';

interface AppSidebarProps {
  activeNav?: 'workspace' | 'archive' | 'docs' | 'samples' | 'feedback' | 'changelog';
}

export const AppSidebar: React.FC<AppSidebarProps> = ({ activeNav }) => {
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    openTab,
    archiveWorkspace,
    deleteWorkspace,
    renameWorkspace,
    requestDelete,
    archivedWorkspaces,
    isSidebarCollapsed,
    toggleSidebar,
    settings,
    updateSettings,
    togglePinWorkspace,
  } = useStore();

  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [isWorkspaceSearchOpen, setIsWorkspaceSearchOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [editingWsId, setEditingWsId] = useState<string | null>(null);
  const [editWsName, setEditWsName] = useState('');

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

  const filteredWorkspaces = workspaces
    .filter((ws) => ws.name.toLowerCase().includes(workspaceQuery.toLowerCase()))
    .sort((a, b) => {
      if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
        return a.isPinned ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

  const commitWsRename = (wsId: string) => {
    if (editWsName.trim()) {
      renameWorkspace(wsId, editWsName.trim());
    }
    setEditingWsId(null);
  };

  if (settings.sidebarPosition === 'hidden') {
    return null;
  }

  return (
    <>
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`} id="sidebar">
        <div className="sidebar__top">
          <div className="sidebar-ws-container">
            <div className="sidebar-header" style={{ paddingBottom: '10px', borderBottom: 'none' }}>
              {isWorkspaceSearchOpen ? (
                <div className="inline-search-wrap">
                  <input
                    autoFocus
                    className="sidebar-inline-search"
                    value={workspaceQuery}
                    onChange={(e) => setWorkspaceQuery(e.target.value)}
                    onBlur={() => {
                      if (!workspaceQuery) setIsWorkspaceSearchOpen(false);
                    }}
                    placeholder="Filter…"
                  />
                  {workspaceQuery && (
                    <button
                      className="inline-search-clear"
                      type="button"
                      aria-label="Clear workspace search"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setWorkspaceQuery('')}
                    >
                      ×
                    </button>
                  )}
                </div>
              ) : (
                <span className="sidebar-header__label">Workspaces</span>
              )}
              <div className="sidebar-header__actions">
                <button
                  className={`icon-btn icon-btn--sm ${isWorkspaceSearchOpen ? 'active' : ''}`}
                  title="Search workspaces"
                  type="button"
                  onClick={() => {
                    if (isSidebarCollapsed) {
                      // Expand sidebar first, then open search
                      toggleSidebar();
                      setTimeout(() => setIsWorkspaceSearchOpen(true), 150);
                    } else {
                      setIsWorkspaceSearchOpen((open) => !open);
                      if (isWorkspaceSearchOpen) setWorkspaceQuery('');
                    }
                  }}
                >
                  <span className="material-symbols-outlined">search</span>
                </button>
                <button
                  className="sidebar-create-folder-btn"
                  title="Create Workspace"
                  type="button"
                  onClick={() => setIsWorkspaceModalOpen(true)}
                >
                  <svg
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path>
                    <line x1="12" x2="12" y1="10" y2="16"></line>
                    <line x1="9" x2="15" y1="13" y2="13"></line>
                  </svg>
                </button>
                <button
                  className={`icon-btn icon-btn--sm ${settings.lockExpandedSidebar ? 'sidebar-locked-btn' : ''}`}
                  id="sidebar-collapse-btn"
                  title={
                    settings.lockExpandedSidebar
                      ? "Sidebar is locked expanded (Click to unlock)"
                      : isSidebarCollapsed
                      ? "Expand sidebar"
                      : "Collapse sidebar"
                  }
                  type="button"
                  onClick={() => {
                    if (settings.lockExpandedSidebar) {
                      updateSettings({ lockExpandedSidebar: false });
                    } else {
                      toggleSidebar();
                    }
                  }}
                >
                  <span className="material-symbols-outlined">
                    {settings.lockExpandedSidebar ? 'lock' : 'left_panel_close'}
                  </span>
                </button>
              </div>
            </div>

            <div id="sidebar-ws-list" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {filteredWorkspaces.map((ws) => (
                <div
                  key={ws.id}
                  className={`sidebar-item ${ws.id === activeWorkspaceId && activeNav === 'workspace' ? 'active' : ''}`}
                  onClick={() => {
                    if (editingWsId !== ws.id) {
                      setActiveWorkspace(ws.id);
                      openTab({ type: 'workspace', title: ws.name, workspaceId: ws.id });
                      if (ws.path) {
                        api.openWorkspace(ws.path).catch((err) => {
                          console.warn('Failed opening workspace path:', err);
                        });
                      }
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    useStore.getState().openContextMenu(e.clientX, e.clientY, [
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
                          setEditingWsId(ws.id);
                          setEditWsName(ws.name);
                        },
                      },
                      {
                        id: 'duplicate',
                        label: 'Duplicate Workspace',
                        icon: 'content_copy',
                        action: () =>
                          useStore.getState().duplicateWorkspace(ws.id),
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
                        action: () => archiveWorkspace(ws.id),
                      },
                      {
                        id: 'delete',
                        label: 'Delete Workspace',
                        icon: 'delete',
                        danger: true,
                        action: () => {
                          requestDelete({
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
                              deleteWorkspace(ws.id);
                            },
                          });
                        },
                      },
                    ]);
                  }}
                  style={{ cursor: 'pointer' }}
                  title={ws.isPinned ? `[Pinned] ${ws.name}` : ws.name}
                >
                  <span className="sidebar-item__left" style={{ width: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', minWidth: 0, flex: 1 }}>
                      <span className="material-symbols-outlined" style={ws.isPinned ? { color: 'var(--color-accent)' } : undefined}>
                        {ws.isPinned && isSidebarCollapsed ? 'push_pin' : 'folder'}
                      </span>
                      {editingWsId === ws.id ? (
                        <input
                          autoFocus
                          type="text"
                          className="inline-seamless-rename-input"
                          value={editWsName}
                          size={Math.max(editWsName.length, 1)}
                          onChange={(e) => setEditWsName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitWsRename(ws.id);
                            else if (e.key === 'Escape') setEditingWsId(null);
                          }}
                          onBlur={() => commitWsRename(ws.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="truncate">{ws.name}</span>
                      )}
                    </span>
                    {!isSidebarCollapsed && (
                      <span className="sidebar-ws-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: 'auto', flexShrink: 0 }}>
                        <button
                          type="button"
                          className="sidebar-ws-pin-btn"
                          title="Archive workspace"
                          onClick={(e) => {
                            e.stopPropagation();
                            archiveWorkspace(ws.id);
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
                            inventory_2
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`sidebar-ws-pin-btn ${ws.isPinned ? 'active' : ''}`}
                          title={ws.isPinned ? "Unpin workspace" : "Pin workspace to top"}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinWorkspace(ws.id);
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>
                            push_pin
                          </span>
                        </button>
                      </span>
                    )}
                  </span>
                </div>
              ))}
              {isWorkspaceSearchOpen && workspaceQuery && filteredWorkspaces.length === 0 && (
                <span className="inline-search-empty">No workspaces found</span>
              )}
            </div>
          </div>
        </div>

        <div className="sidebar__bottom">
          <button
            className={`sidebar-item ${activeNav === 'archive' ? 'active' : ''}`}
            type="button"
            data-action="archive"
            onClick={() => openTab({ id: 'tab-archive', type: 'archive', title: 'Archive' })}
          >
            <span className="sidebar-item__left">
              <span className="material-symbols-outlined">inventory_2</span>
              <span>Archive</span>
            </span>
            <span className="sidebar-item__badge">{archivedWorkspaces.length}</span>
          </button>

          <button
            className={`sidebar-item ${activeNav === 'docs' ? 'active' : ''}`}
            type="button"
            data-action="docs"
            onClick={() => openTab({ id: 'tab-docs', type: 'docs', title: 'Documentation' })}
          >
            <span className="sidebar-item__left">
              <span className="material-symbols-outlined">menu_book</span>
              <span>Documentation</span>
            </span>
          </button>

          <button
            className={`sidebar-item ${activeNav === 'samples' ? 'active' : ''}`}
            type="button"
            data-action="samples"
            onClick={() => openTab({ id: 'tab-samples', type: 'samples', title: 'Sample Studies' })}
          >
            <span className="sidebar-item__left">
              <span className="material-symbols-outlined">science</span>
              <span>Sample Studies</span>
            </span>
          </button>

          <button
            className={`sidebar-item ${activeNav === 'feedback' ? 'active' : ''}`}
            type="button"
            data-action="feedback"
            onClick={() => openTab({ id: 'tab-feedback', type: 'feedback', title: 'Feedback & Reports' })}
          >
            <span className="sidebar-item__left">
              <span className="material-symbols-outlined">feedback</span>
              <span className="truncate">Feedback &amp; Reports</span>
            </span>
          </button>
        </div>
      </aside>

      <WorkspaceModal
        isOpen={isWorkspaceModalOpen}
        onClose={() => setIsWorkspaceModalOpen(false)}
      />
    </>
  );
};

export default AppSidebar;
