import React, { useEffect, useRef, useState } from 'react';
import { useStore, type AppTab } from '../store';
import WorkspaceModal from './WorkspaceModal';
import { promptOpenWorkspaceFolder } from '../utils/workspace-import';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId, setActiveTab, closeTab, closeTabs, openTab, workspaces, reorderTabs, setActiveWorkspace, renameWorkspace } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Tab scroll overflow state
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);

  // Workspace Group Collapsing
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // ─── Drag & Slide State ───────────────────────────────────────────────────
  // 1. Sliding a child tab within an expanded group
  interface ChildSlideState {
    tabId: string;
    wsId: string;
    deltaX: number;
    originIndex: number;
    hoverIndex: number;
    itemWidth: number;
    isSliding: boolean;
  }
  const [childSlide, setChildSlide] = useState<ChildSlideState | null>(null);

  // 2. Sliding a top-level strip item (standalone tab or entire workspace group)
  interface StripSlideState {
    type: 'standalone' | 'group';
    id: string; // tab.id or workspaceId
    deltaX: number;
    originIndex: number;
    hoverIndex: number;
    itemWidth: number;
    isSliding: boolean;
  }
  const [stripSlide, setStripSlide] = useState<StripSlideState | null>(null);

  // ─── Dropdown Behavior ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDropdownOpen) {
      setSearchQuery('');
      return;
    }
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);

    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 40);

    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      clearTimeout(timer);
    };
  }, [isDropdownOpen]);

  // Keyboard shortcut listeners: Cmd/Ctrl + W, Cmd/Ctrl + T
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (activeTabId) {
          closeTab(activeTabId);
        }
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setIsDropdownOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, closeTab]);

  const checkScrollOverflow = () => {
    const el = scrollRef.current;
    if (!el) return;
    const hasRight = el.scrollWidth > el.clientWidth && el.scrollLeft + el.clientWidth < el.scrollWidth - 3;
    const hasLeft = el.scrollLeft > 3;
    setCanScrollRight(hasRight);
    setCanScrollLeft(hasLeft);
  };

  // Scroll active tab into view & re-verify overflow
  useEffect(() => {
    if (!scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector('.tab-item--active') as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
    const t = setTimeout(checkScrollOverflow, 120);
    return () => clearTimeout(t);
  }, [activeTabId]);

  // Track scroll overflow changes via scroll listener and ResizeObserver
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    checkScrollOverflow();
    el.addEventListener('scroll', checkScrollOverflow, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        checkScrollOverflow();
      });
      resizeObserver.observe(el);
      if (el.parentElement) {
        resizeObserver.observe(el.parentElement);
      }
    }

    const t = setTimeout(checkScrollOverflow, 80);

    return () => {
      clearTimeout(t);
      el.removeEventListener('scroll', checkScrollOverflow);
      resizeObserver?.disconnect();
    };
  }, [tabs, activeTabId, collapsedGroups]);

  const filteredWorkspaces = workspaces
    .filter((ws) =>
      ws.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
    )
    .sort((a, b) => {
      const aPinned = Boolean(a.isPinned);
      const bPinned = Boolean(b.isPinned);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

  // ─── Tab Context Menu State ───────────────────────────────────────────────
  interface TabContextMenuState {
    tabId?: string;
    tabTitle?: string;
    wsId?: string;
    wsName?: string;
    groupTabIds?: string[];
    isGroupPill?: boolean;
    x: number;
    y: number;
  }
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', handleClose);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClose);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const toggleGroupCollapse = (wsId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [wsId]: !prev[wsId],
    }));
  };

  // Auto-collapse inactive groups whenever switching to another tab or group
  useEffect(() => {
    if (!activeTabId) return;
    const currentTab = tabs.find((t) => t.id === activeTabId);
    const activeWsId = currentTab?.workspaceId;

    const allWsIds = new Set<string>();
    tabs.forEach((t) => {
      if (t.workspaceId) allWsIds.add(t.workspaceId);
    });

    setCollapsedGroups((prev) => {
      const next = { ...prev };
      allWsIds.forEach((wsId) => {
        if (wsId === activeWsId) {
          next[wsId] = false; // Active group stays expanded
        } else {
          next[wsId] = true;  // Non-active groups automatically collapse
        }
      });
      return next;
    });
  }, [activeTabId]);

  const openWorkspaceDirectory = (wsId: string, wsName: string) => {
    setActiveWorkspace(wsId);
    const existingWsTab = tabs.find((t) => t.workspaceId === wsId && t.type === 'workspace');
    if (existingWsTab) {
      setActiveTab(existingWsTab.id);
    } else {
      openTab({
        type: 'workspace',
        title: wsName,
        workspaceId: wsId,
      });
    }
  };

  // ─── Inline Workspace Renaming ─────────────────────────────────────────────
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [editWorkspaceName, setEditWorkspaceName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRenaming = (wsId: string, currentName: string) => {
    setEditingWorkspaceId(wsId);
    setEditWorkspaceName(currentName);
  };

  useEffect(() => {
    if (editingWorkspaceId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingWorkspaceId]);

  const commitRename = () => {
    if (editingWorkspaceId && editWorkspaceName.trim()) {
      renameWorkspace(editingWorkspaceId, editWorkspaceName.trim());
    }
    setEditingWorkspaceId(null);
  };

  const cancelRename = () => {
    setEditingWorkspaceId(null);
  };

  const closeGroup = (tabIds: string[]) => {
    closeTabs(tabIds);
    setContextMenu(null);
  };

  const getTabIcon = (tab: AppTab) => {
    switch (tab.type) {
      case 'get-started':
        return 'home';
      case 'workspace':
        return 'folder';
      case 'model':
        return 'polyline';
      case 'archive':
        return 'inventory_2';
      case 'dataset':
        return 'dataset';
      case 'docs':
        return 'menu_book';
      case 'samples':
        return 'science';
      case 'feedback':
        return 'feedback';
      case 'snapshot':
        return 'history';
      default:
        return null;
    }
  };

  const GROUP_PALETTE = [
    { bg: 'var(--color-accent-subtle)', border: 'var(--color-accent-border)', text: 'var(--color-accent)' },
    { bg: 'var(--color-accent-subtle)', border: 'var(--color-accent-border)', text: 'var(--color-accent)' },
  ];

  const getWorkspaceColor = (_workspaceId: string, groupIndex: number) => {
    return GROUP_PALETTE[groupIndex % GROUP_PALETTE.length];
  };

  // ─── Partition tabs into top-level Strip Items ────────────────────────────
  type TabStripItem =
    | { kind: 'standalone'; tab: AppTab }
    | {
        kind: 'group';
        workspaceId: string;
        workspaceName: string;
        color: (typeof GROUP_PALETTE)[0];
        tabs: AppTab[];
      };

  const stripItems: TabStripItem[] = [];
  const seenWorkspaces = new Set<string>();
  let groupIndex = 0;

  for (const tab of tabs) {
    if (!tab.workspaceId) {
      stripItems.push({ kind: 'standalone', tab });
    } else {
      if (seenWorkspaces.has(tab.workspaceId)) {
        continue;
      }
      seenWorkspaces.add(tab.workspaceId);
      const wsTabs = tabs.filter((t) => t.workspaceId === tab.workspaceId);
      const ws = workspaces.find((w) => w.id === tab.workspaceId);
      const wsName = ws?.name || tab.title || 'Workspace';
      const color = getWorkspaceColor(tab.workspaceId, groupIndex);
      groupIndex++;
      stripItems.push({
        kind: 'group',
        workspaceId: tab.workspaceId,
        workspaceName: wsName,
        color,
        tabs: wsTabs,
      });
    }
  }

  // Ordered tabs representing the visible left-to-right order on the tab bar
  const orderedTabs: AppTab[] = [];
  for (const item of stripItems) {
    if (item.kind === 'standalone') {
      orderedTabs.push(item.tab);
    } else {
      const wsTab = item.tabs.find((t) => t.type === 'workspace');
      if (wsTab) {
        orderedTabs.push(wsTab);
      }
      item.tabs.filter((t) => t.type !== 'workspace').forEach((t) => {
        orderedTabs.push(t);
      });
    }
  }
  for (const tab of tabs) {
    if (!orderedTabs.some((t) => t.id === tab.id)) {
      orderedTabs.push(tab);
    }
  }

  const moveWorkspaceTabs = (fromWsId: string, targetTabId: string, insertAfter = false) => {
    const wsTabs = tabs.filter((t) => t.workspaceId === fromWsId);
    if (wsTabs.length === 0) return;

    const remainingTabs = tabs.filter((t) => t.workspaceId !== fromWsId);
    let targetIdx = remainingTabs.findIndex((t) => t.id === targetTabId);
    if (targetIdx === -1) {
      targetIdx = remainingTabs.length;
    } else if (insertAfter) {
      targetIdx = targetIdx + 1;
    }

    const newTabs = [...remainingTabs];
    newTabs.splice(targetIdx, 0, ...wsTabs);
    useStore.setState({ tabs: newTabs });
  };

  // ─── Level 1: Sliding Child Tabs Inside an Expanded Group ─────────────────
  const handleChildTabMouseDown = (
    e: React.MouseEvent,
    tab: AppTab,
    childTabs: AppTab[],
    wsId: string,
    stripItem: TabStripItem
  ) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.tab-close-btn')) return;

    // Immediately activate tab
    setActiveTab(tab.id);

    // If there is only 1 child tab, nothing to reorder within the group
    if (childTabs.length <= 1) {
      return;
    }

    const currentTarget = e.currentTarget as HTMLElement;
    const containerEl = currentTarget.parentElement;
    if (!containerEl) return;

    const originIndex = childTabs.findIndex((t) => t.id === tab.id);
    if (originIndex === -1) return;

    const initialRect = currentTarget.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    const startX = e.clientX;
    const itemWidth = initialRect.width;

    const childEls = Array.from(containerEl.querySelectorAll<HTMLElement>('[data-group-child-id]'));
    const rectMap = childEls.map((el, idx) => {
      const id = el.getAttribute('data-group-child-id')!;
      const rect = el.getBoundingClientRect();
      return {
        id,
        index: idx,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    });

    let isStarted = false;
    let currentHoverIndex = originIndex;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const rawDeltaX = moveEvent.clientX - startX;

      if (!isStarted) {
        if (Math.abs(rawDeltaX) > 4) {
          isStarted = true;
          document.body.classList.add('is-tab-sliding');
        } else {
          return;
        }
      }

      // Clamp movement inside the group's child tabs container
      const minDelta = containerRect.left - initialRect.left;
      const maxDelta = containerRect.right - initialRect.right;
      const safeMaxDelta = Math.max(minDelta, maxDelta);
      const clampedDeltaX = Math.max(minDelta, Math.min(safeMaxDelta, rawDeltaX));

      let newHoverIndex = originIndex;
      if (clampedDeltaX > 0) {
        let accumulated = 0;
        for (let i = originIndex + 1; i < rectMap.length; i++) {
          const nextWidth = rectMap[i].width;
          if (clampedDeltaX > accumulated + nextWidth / 2) {
            newHoverIndex = i;
          }
          accumulated += nextWidth + 3;
        }
      } else if (clampedDeltaX < 0) {
        let accumulated = 0;
        for (let i = originIndex - 1; i >= 0; i--) {
          const prevWidth = rectMap[i].width;
          if (Math.abs(clampedDeltaX) > accumulated + prevWidth / 2) {
            newHoverIndex = i;
          }
          accumulated += prevWidth + 3;
        }
      }

      currentHoverIndex = newHoverIndex;

      setChildSlide({
        tabId: tab.id,
        wsId,
        deltaX: clampedDeltaX,
        originIndex,
        hoverIndex: newHoverIndex,
        itemWidth,
        isSliding: true,
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.classList.remove('is-tab-sliding');

      if (isStarted && currentHoverIndex !== originIndex) {
        const targetChildTab = childTabs[currentHoverIndex];
        if (targetChildTab) {
          const fromGlobal = tabs.findIndex((t) => t.id === tab.id);
          const toGlobal = tabs.findIndex((t) => t.id === targetChildTab.id);
          if (fromGlobal !== -1 && toGlobal !== -1) {
            reorderTabs(fromGlobal, toGlobal);
          }
        }
      }

      setChildSlide(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // ─── Level 2: Sliding Top-level Strip Items (Standalone & Workspace Groups)
  const handleStripItemMouseDown = (
    e: React.MouseEvent,
    item: TabStripItem
  ) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.tab-close-btn')) return;
    if ((e.target as HTMLElement).closest('.tab-group-chevron-btn')) return;

    // Immediately activate standalone tab
    if (item.kind === 'standalone') {
      setActiveTab(item.tab.id);
    }

    const strip = scrollRef.current;
    if (!strip) return;

    const itemId = item.kind === 'standalone' ? item.tab.id : item.workspaceId;
    const currentTarget = e.currentTarget as HTMLElement;
    const stripItemEl = currentTarget.closest<HTMLElement>('[data-strip-item-id]');
    if (!stripItemEl) return;

    const initialRect = stripItemEl.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    const startX = e.clientX;
    const itemWidth = initialRect.width;

    const stripItemEls = Array.from(strip.querySelectorAll<HTMLElement>('[data-strip-item-id]'));
    const rectMap = stripItemEls.map((el) => {
      const id = el.getAttribute('data-strip-item-id')!;
      const rect = el.getBoundingClientRect();
      return {
        id,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    });

    const originIndex = rectMap.findIndex((r) => r.id === itemId);
    if (originIndex === -1) return;

    let isStarted = false;
    let currentHoverIndex = originIndex;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const rawDeltaX = moveEvent.clientX - startX;

      if (!isStarted) {
        if (Math.abs(rawDeltaX) > 4) {
          isStarted = true;
          document.body.classList.add('is-tab-sliding');
        } else {
          return;
        }
      }

      // Strictly clamp inside the tabstrip with a 4px inner border
      // so it never slides under the logo on the left or behind the plus button on the right
      const minDelta = stripRect.left + 4 - initialRect.left;
      const maxDelta = stripRect.right - 4 - initialRect.right;
      const safeMaxDelta = Math.max(minDelta, maxDelta);
      const clampedDeltaX = Math.max(minDelta, Math.min(safeMaxDelta, rawDeltaX));

      let newHoverIndex = originIndex;
      if (clampedDeltaX > 0) {
        let accumulated = 0;
        for (let i = originIndex + 1; i < rectMap.length; i++) {
          const nextWidth = rectMap[i].width;
          if (clampedDeltaX > accumulated + nextWidth / 2) {
            newHoverIndex = i;
          }
          accumulated += nextWidth + 4;
        }
      } else if (clampedDeltaX < 0) {
        let accumulated = 0;
        for (let i = originIndex - 1; i >= 0; i--) {
          const prevWidth = rectMap[i].width;
          if (Math.abs(clampedDeltaX) > accumulated + prevWidth / 2) {
            newHoverIndex = i;
          }
          accumulated += prevWidth + 4;
        }
      }

      currentHoverIndex = newHoverIndex;

      setStripSlide({
        type: item.kind,
        id: itemId,
        deltaX: clampedDeltaX,
        originIndex,
        hoverIndex: newHoverIndex,
        itemWidth,
        isSliding: true,
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.classList.remove('is-tab-sliding');

      if (isStarted) {
        if (currentHoverIndex !== originIndex) {
          const targetRect = rectMap[currentHoverIndex];
          if (targetRect) {
            const targetItem = stripItems.find((si) =>
              si.kind === 'standalone' ? si.tab.id === targetRect.id : si.workspaceId === targetRect.id
            );
            if (targetItem) {
              const insertAfter = currentHoverIndex > originIndex;
              if (item.kind === 'standalone') {
                const fromGlobal = tabs.findIndex((t) => t.id === item.tab.id);
                const targetTab = targetItem.kind === 'standalone'
                  ? targetItem.tab
                  : (insertAfter ? targetItem.tabs[targetItem.tabs.length - 1] : targetItem.tabs[0]);
                const toGlobal = tabs.findIndex((t) => t.id === targetTab.id);
                if (fromGlobal !== -1 && toGlobal !== -1) {
                  reorderTabs(fromGlobal, toGlobal);
                }
              } else {
                // Group
                const targetTabId = targetItem.kind === 'standalone'
                  ? targetItem.tab.id
                  : (insertAfter ? targetItem.tabs[targetItem.tabs.length - 1].id : targetItem.tabs[0].id);
                moveWorkspaceTabs(item.workspaceId, targetTabId, insertAfter);
              }
            }
          }
        }
      } else {
        // Plain click without dragging
        if (item.kind === 'standalone') {
          setActiveTab(item.tab.id);
        } else {
          openWorkspaceDirectory(item.workspaceId, item.workspaceName);
        }
      }

      setStripSlide(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // ─── Render Standalone Tab ────────────────────────────────────────────────
  const renderStandaloneTab = (tab: AppTab, itemIndex: number, stripItem: TabStripItem) => {
    const isActive = tab.id === activeTabId;
    const iconName = getTabIcon(tab);
    const label = tab.type === 'get-started' ? 'Home' : tab.title;
    const itemId = stripItem.kind === 'standalone' ? stripItem.tab.id : stripItem.workspaceId;

    let slidingStyle: React.CSSProperties | undefined;
    let slidingClass = '';

    if (stripSlide && stripSlide.isSliding) {
      if (stripSlide.id === itemId) {
        slidingClass = 'tab-item--sliding';
        slidingStyle = {
          transform: `translateX(${stripSlide.deltaX}px)`,
          zIndex: 100,
          position: 'relative',
        };
      } else if (stripSlide.originIndex < stripSlide.hoverIndex) {
        if (itemIndex > stripSlide.originIndex && itemIndex <= stripSlide.hoverIndex) {
          slidingClass = 'tab-item--shifting';
          slidingStyle = {
            transform: `translateX(-${stripSlide.itemWidth + 4}px)`,
          };
        }
      } else if (stripSlide.originIndex > stripSlide.hoverIndex) {
        if (itemIndex >= stripSlide.hoverIndex && itemIndex < stripSlide.originIndex) {
          slidingClass = 'tab-item--shifting';
          slidingStyle = {
            transform: `translateX(${stripSlide.itemWidth + 4}px)`,
          };
        }
      }
    }

    const isWs = tab.type === 'workspace' && !!tab.workspaceId;
    const wsId = isWs ? tab.workspaceId! : (stripItem.kind === 'group' ? stripItem.workspaceId : null);
    const wsName = wsId ? (workspaces.find((w) => w.id === wsId)?.name || label) : label;
    const isEditingThis = !!wsId && editingWorkspaceId === wsId;

    return (
      <div
        key={tab.id}
        data-strip-item-id={itemId}
        className={`tab-item ${isActive ? 'tab-item--active' : ''} ${slidingClass}`}
        style={slidingStyle}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onMouseDown={(e) => {
          if (!isEditingThis) {
            handleStripItemMouseDown(e, stripItem);
          }
        }}
        onDoubleClick={(e) => {
          if (wsId && !isEditingThis) {
            e.stopPropagation();
            startRenaming(wsId, wsName);
          }
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            closeTab(tab.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            tabId: tab.id,
            tabTitle: tab.type === 'get-started' ? 'Home' : tab.title,
            wsId: wsId ?? undefined,
            wsName: wsName,
            groupTabIds: stripItem.kind === 'group' ? stripItem.tabs.map((t) => t.id) : undefined,
            isGroupPill: false,
          });
        }}
        title={tab.type === 'get-started' ? 'Home' : tab.title}
      >
        {iconName && <span className="material-symbols-outlined tab-icon">{iconName}</span>}
        {isEditingThis ? (
          <input
            ref={renameInputRef}
            type="text"
            className="tab-inline-rename-input"
            value={editWorkspaceName}
            onChange={(e) => setEditWorkspaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={commitRename}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="tab-label"
            onDoubleClick={(e) => {
              if (wsId) {
                e.stopPropagation();
                startRenaming(wsId, wsName);
              }
            }}
            title={wsId ? 'Double-click to rename workspace' : undefined}
          >
            {label}
          </span>
        )}
        <button
          className="tab-close-btn"
          type="button"
          title="Close Tab (Cmd+W)"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            closeTab(tab.id);
          }}
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
    );
  };

  // ─── Render Child Tab Inside Expanded Group ───────────────────────────────
  const renderChildTab = (
    tab: AppTab,
    childIndex: number,
    childTabs: AppTab[],
    wsId: string,
    stripItem: TabStripItem
  ) => {
    const isActive = tab.id === activeTabId;
    const iconName = getTabIcon(tab);

    let childStyle: React.CSSProperties | undefined;
    let childClass = '';

    if (childSlide && childSlide.isSliding && childSlide.wsId === wsId) {
      if (childSlide.tabId === tab.id) {
        childClass = 'tab-item--sliding';
        childStyle = {
          transform: `translateX(${childSlide.deltaX}px)`,
          zIndex: 100,
          position: 'relative',
        };
      } else if (childSlide.originIndex < childSlide.hoverIndex) {
        if (childIndex > childSlide.originIndex && childIndex <= childSlide.hoverIndex) {
          childClass = 'tab-item--shifting';
          childStyle = {
            transform: `translateX(-${childSlide.itemWidth + 4}px)`,
          };
        }
      } else if (childSlide.originIndex > childSlide.hoverIndex) {
        if (childIndex >= childSlide.hoverIndex && childIndex < childSlide.originIndex) {
          childClass = 'tab-item--shifting';
          childStyle = {
            transform: `translateX(${childSlide.itemWidth + 4}px)`,
          };
        }
      }
    }

    return (
      <div
        key={tab.id}
        data-group-child-id={tab.id}
        className={`tab-item ${isActive ? 'tab-item--active' : ''} ${childClass}`}
        style={childStyle}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onMouseDown={(e) => handleChildTabMouseDown(e, tab, childTabs, wsId, stripItem)}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            closeTab(tab.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const ws = workspaces.find((w) => w.id === wsId);
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            tabId: tab.id,
            tabTitle: tab.title,
            wsId,
            wsName: ws?.name || 'Workspace',
            groupTabIds: stripItem.kind === 'group' ? stripItem.tabs.map((t) => t.id) : undefined,
            isGroupPill: false,
          });
        }}
        title={tab.title}
      >
        {iconName && <span className="material-symbols-outlined tab-icon">{iconName}</span>}
        <span className="tab-label">{tab.title}</span>
        <button
          className="tab-close-btn"
          type="button"
          title="Close Tab (Cmd+W)"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            closeTab(tab.id);
          }}
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
    );
  };

  return (
    <>
      <div className="tabbar-root no-drag">
        {canScrollLeft && (
          <button
            className="tab-overflow-indicator tab-overflow-indicator--left"
            type="button"
            title="Scroll left to see more tabs"
            onClick={(e) => {
              e.stopPropagation();
              scrollRef.current?.scrollBy({ left: -140, behavior: 'smooth' });
            }}
          >
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
        )}
        <div
          className={`tabstrip ${
            canScrollLeft && canScrollRight
              ? 'has-overflow-both'
              : canScrollRight
              ? 'has-overflow-right'
              : canScrollLeft
              ? 'has-overflow-left'
              : ''
          }`}
          ref={scrollRef}
        >
          {stripItems.map((item, itemIndex) => {
            if (item.kind === 'standalone') {
              return renderStandaloneTab(item.tab, itemIndex, item);
            }

            const isCollapsed = !!collapsedGroups[item.workspaceId];
            const hasActiveTab = item.tabs.some((t) => t.id === activeTabId);
            const wsTab = item.tabs.find((t) => t.type === 'workspace');
            const isWorkspaceActive = wsTab?.id === activeTabId;
            const childTabs = item.tabs.filter((t) => t.type !== 'workspace');

            // If only one tab in group, render as a clean standalone tab
            if (item.tabs.length === 1) {
              return renderStandaloneTab(item.tabs[0], itemIndex, item);
            }

            let groupSlidingStyle: React.CSSProperties = {
              '--group-bg': item.color.bg,
              '--group-border': item.color.border,
              '--group-text': item.color.text,
              cursor: isCollapsed ? 'grab' : undefined,
            } as React.CSSProperties;

            let groupSlidingClass = '';
            if (stripSlide && stripSlide.isSliding) {
              if (stripSlide.id === item.workspaceId) {
                groupSlidingClass = 'tab-group--sliding';
                groupSlidingStyle = {
                  ...groupSlidingStyle,
                  transform: `translateX(${stripSlide.deltaX}px)`,
                  zIndex: 100,
                  position: 'relative',
                };
              } else if (stripSlide.originIndex < stripSlide.hoverIndex) {
                if (itemIndex > stripSlide.originIndex && itemIndex <= stripSlide.hoverIndex) {
                  groupSlidingClass = 'tab-group--shifting';
                  groupSlidingStyle = {
                    ...groupSlidingStyle,
                    transform: `translateX(-${stripSlide.itemWidth + 6}px)`,
                  };
                }
              } else if (stripSlide.originIndex > stripSlide.hoverIndex) {
                if (itemIndex >= stripSlide.hoverIndex && itemIndex < stripSlide.originIndex) {
                  groupSlidingClass = 'tab-group--shifting';
                  groupSlidingStyle = {
                    ...groupSlidingStyle,
                    transform: `translateX(${stripSlide.itemWidth + 6}px)`,
                  };
                }
              }
            }

            return (
              <div
                key={`group-${item.workspaceId}`}
                data-strip-item-id={item.workspaceId}
                className={`tab-group ${isCollapsed ? 'tab-group--collapsed' : ''} ${
                  hasActiveTab ? 'tab-group--has-active' : ''
                } ${groupSlidingClass}`}
                style={groupSlidingStyle}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                onMouseDown={isCollapsed && editingWorkspaceId !== item.workspaceId ? (e) => handleStripItemMouseDown(e, item) : undefined}
                onContextMenu={isCollapsed ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const wsTab = item.tabs.find((t) => t.type === 'workspace');
                  setContextMenu({
                    wsId: item.workspaceId,
                    wsName: item.workspaceName,
                    groupTabIds: item.tabs.map((t) => t.id),
                    tabId: wsTab ? wsTab.id : item.tabs[0]?.id,
                    tabTitle: item.workspaceName,
                    isGroupPill: true,
                    x: e.clientX,
                    y: e.clientY,
                  });
                } : undefined}
              >
                {/* Collapse/expand arrow */}
                <button
                  type="button"
                  className="tab-group-chevron-btn"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroupCollapse(item.workspaceId);
                  }}
                  title={isCollapsed ? 'Expand group' : 'Collapse group'}
                >
                  <span className="material-symbols-outlined tab-group-chevron">
                    {isCollapsed ? 'chevron_right' : 'chevron_left'}
                  </span>
                </button>

                {/* Workspace tab button — styled as tab when active */}
                <button
                  type="button"
                  className={`tab-group-name-btn${isWorkspaceActive ? ' tab-group-name-btn--active' : ''}`}
                  onMouseDown={(e) => {
                    if (editingWorkspaceId === item.workspaceId) {
                      e.stopPropagation();
                      return;
                    }
                    // Allow dragging entire group by its header pill even when expanded
                    handleStripItemMouseDown(e, item);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editingWorkspaceId === item.workspaceId) return;
                    openWorkspaceDirectory(item.workspaceId, item.workspaceName);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRenaming(item.workspaceId, item.workspaceName);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const wsTab = item.tabs.find((t) => t.type === 'workspace');
                    setContextMenu({
                      wsId: item.workspaceId,
                      wsName: item.workspaceName,
                      groupTabIds: item.tabs.map((t) => t.id),
                      tabId: wsTab ? wsTab.id : item.tabs[0]?.id,
                      tabTitle: item.workspaceName,
                      isGroupPill: true,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  title={editingWorkspaceId === item.workspaceId ? undefined : `Open ${item.workspaceName} (Double-click to rename)`}
                >
                  <span className="material-symbols-outlined tab-icon" style={{ fontSize: '15px' }}>folder</span>
                  {editingWorkspaceId === item.workspaceId ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      className="tab-inline-rename-input"
                      value={editWorkspaceName}
                      onChange={(e) => setEditWorkspaceName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      onBlur={commitRename}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="tab-group-title"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRenaming(item.workspaceId, item.workspaceName);
                      }}
                    >
                      {item.workspaceName}
                    </span>
                  )}
                  {isCollapsed && childTabs.length > 0 && (
                    <span className="tab-group-count">{childTabs.length}</span>
                  )}
                </button>

                {/* Expanded child tabs */}
                {!isCollapsed && (
                  <div className="tab-group-tabs">
                    {childTabs.map((childTab, childIndex) =>
                      renderChildTab(childTab, childIndex, childTabs, item.workspaceId, item)
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ─── Add Button with Dropdown ─────────────────────────────────── */}
        <div className="tab-add-wrapper" ref={dropdownRef}>
          {canScrollRight && (
            <button
              className="tab-overflow-indicator tab-overflow-indicator--right"
              type="button"
              title="Scroll right to see more tabs"
              onClick={(e) => {
                e.stopPropagation();
                scrollRef.current?.scrollBy({ left: 140, behavior: 'smooth' });
              }}
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          )}

          <button
            className={`tab-add-btn ${isDropdownOpen ? 'active' : ''}`}
            type="button"
            title="New Tab / Switch Workspace (Cmd+T)"
            onClick={(e) => {
              e.stopPropagation();
              setIsDropdownOpen((prev) => !prev);
            }}
          >
            <span className="material-symbols-outlined">add</span>
          </button>

          {isDropdownOpen && (
            <div
              className="tab-menu-dropdown no-drag"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="tab-menu-dropdown__search-wrap">
                <span className="material-symbols-outlined tab-menu-dropdown__search-icon">search</span>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="tab-menu-dropdown__search-input"
                  placeholder="Search workspaces..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsDropdownOpen(false);
                    }
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="tab-menu-dropdown__search-clear"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    title="Clear search"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                )}
              </div>

              <div className="tab-menu-dropdown__header">
                <span>Workspaces</span>
                {workspaces.length > 0 && (
                  <span className="tab-menu-dropdown__count">{filteredWorkspaces.length}</span>
                )}
              </div>

              <div className="tab-menu-dropdown__list custom-scroll">
                {workspaces.length === 0 ? (
                  <div className="tab-menu-dropdown__empty">No workspaces created yet</div>
                ) : filteredWorkspaces.length === 0 ? (
                  <div className="tab-menu-dropdown__empty">No workspaces matching "{searchQuery}"</div>
                ) : (
                  filteredWorkspaces.map((ws) => {
                    const isOpen = tabs.some(
                      (t) => t.type === 'workspace' && t.workspaceId === ws.id
                    );
                    return (
                      <button
                        key={ws.id}
                        type="button"
                        className={`tab-menu-dropdown__item ${ws.isPinned ? 'tab-menu-dropdown__item--pinned' : ''}`}
                        onClick={() => {
                          openTab({
                            type: 'workspace',
                            title: ws.name,
                            workspaceId: ws.id,
                          });
                          setIsDropdownOpen(false);
                        }}
                      >
                        <span 
                          className="material-symbols-outlined"
                          style={ws.isPinned ? { color: 'var(--color-accent)' } : undefined}
                        >
                          {ws.isPinned ? 'push_pin' : 'folder'}
                        </span>
                        <span className="tab-menu-dropdown__item-title">{ws.name}</span>
                        {isOpen && <span className="tab-menu-dropdown__badge">Open</span>}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="tab-menu-dropdown__divider" />

              <div className="tab-menu-dropdown__footer">
                <button
                  type="button"
                  className="tab-menu-dropdown__item"
                  onClick={() => {
                    openTab({ type: 'get-started', title: 'Home' });
                    setIsDropdownOpen(false);
                  }}
                >
                  <span className="material-symbols-outlined">home</span>
                  <span className="tab-menu-dropdown__item-title">Home</span>
                </button>

                <button
                  type="button"
                  className="tab-menu-dropdown__item"
                  onClick={async () => {
                    setIsDropdownOpen(false);
                    await promptOpenWorkspaceFolder('folder');
                  }}
                >
                  <span className="material-symbols-outlined">folder_open</span>
                  <span className="tab-menu-dropdown__item-title">Open Workspace Folder...</span>
                </button>

                <button
                  type="button"
                  className="tab-menu-dropdown__item"
                  onClick={async () => {
                    setIsDropdownOpen(false);
                    await promptOpenWorkspaceFolder('zip');
                  }}
                >
                  <span className="material-symbols-outlined">archive</span>
                  <span className="tab-menu-dropdown__item-title">Import Archive (.zip)...</span>
                </button>

                <button
                  type="button"
                  className="tab-menu-dropdown__item"
                  onClick={() => {
                    setIsDropdownOpen(false);
                    setIsWorkspaceModalOpen(true);
                  }}
                >
                  <span className="material-symbols-outlined">create_new_folder</span>
                  <span className="tab-menu-dropdown__item-title">Create Workspace...</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tab Context Menu */}
      {contextMenu && (() => {
        const targetTabId = contextMenu.tabId;
        const isGroupPill = !!contextMenu.isGroupPill;
        const groupTabIds = contextMenu.groupTabIds || (contextMenu.wsId ? tabs.filter((t) => t.workspaceId === contextMenu.wsId).map((t) => t.id) : []);
        const groupTabIdSet = new Set(groupTabIds);

        // Determine tabs to close for "Close Tabs to the Right"
        let tabsToRight: string[] = [];
        if (isGroupPill) {
          let lastIdx = -1;
          for (let i = orderedTabs.length - 1; i >= 0; i--) {
            if (groupTabIdSet.has(orderedTabs[i].id)) {
              lastIdx = i;
              break;
            }
          }
          if (lastIdx !== -1) {
            tabsToRight = orderedTabs.slice(lastIdx + 1).map((t) => t.id);
          }
        } else if (targetTabId) {
          const targetIndex = orderedTabs.findIndex((t) => t.id === targetTabId);
          if (targetIndex !== -1) {
            tabsToRight = orderedTabs.slice(targetIndex + 1).map((t) => t.id);
          }
        }

        // Determine tabs to close for "Close Other Tabs"
        let otherTabs: string[] = [];
        if (isGroupPill) {
          otherTabs = orderedTabs.filter((t) => !groupTabIdSet.has(t.id)).map((t) => t.id);
        } else if (targetTabId) {
          otherTabs = orderedTabs.filter((t) => t.id !== targetTabId).map((t) => t.id);
        }

        const isGroupItem = !!contextMenu.wsId && (isGroupPill || groupTabIds.length > 1);
        const isCollapsed = contextMenu.wsId ? !!collapsedGroups[contextMenu.wsId] : false;

        return (
          <div
            className="tab-group-menu no-drag"
            style={{
              position: 'fixed',
              left: `${Math.min(contextMenu.x, window.innerWidth - 210)}px`,
              top: `${Math.min(contextMenu.y + 4, window.innerHeight - 240)}px`,
              zIndex: 9999,
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {contextMenu.tabTitle && (
              <div className="tab-group-menu__header">
                <span>{contextMenu.tabTitle}</span>
              </div>
            )}

            {/* Close Tab */}
            {targetTabId && (
              <button
                type="button"
                className="tab-group-menu__item"
                onClick={() => {
                  closeTab(targetTabId);
                  setContextMenu(null);
                }}
              >
                <span className="material-symbols-outlined">close</span>
                <span style={{ flex: 1 }}>Close Tab</span>
                <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', opacity: 0.7 }}>⌘W</span>
              </button>
            )}

            {/* Close Other Tabs */}
            <button
              type="button"
              className="tab-group-menu__item"
              disabled={otherTabs.length === 0}
              onClick={() => {
                closeTabs(otherTabs);
                setContextMenu(null);
              }}
            >
              <span className="material-symbols-outlined">clear_all</span>
              <span>Close Other Tabs</span>
            </button>

            {/* Close Tabs to the Right */}
            <button
              type="button"
              className="tab-group-menu__item"
              disabled={tabsToRight.length === 0}
              onClick={() => {
                closeTabs(tabsToRight);
                setContextMenu(null);
              }}
            >
              <span className="material-symbols-outlined">arrow_forward</span>
              <span>Close Tabs to the Right</span>
            </button>

            {/* Group Options (if tab is in a group or is a group pill) */}
            {contextMenu.wsId && isGroupItem && (
              <>
                <div className="tab-group-menu__divider" />
                <button
                  type="button"
                  className="tab-group-menu__item"
                  onClick={() => {
                    toggleGroupCollapse(contextMenu.wsId!);
                    setContextMenu(null);
                  }}
                >
                  <span className="material-symbols-outlined">
                    {isCollapsed ? 'unfold_more' : 'unfold_less'}
                  </span>
                  <span>{isCollapsed ? 'Expand Group' : 'Collapse Group'}</span>
                </button>
                <button
                  type="button"
                  className="tab-group-menu__item tab-group-menu__item--danger"
                  onClick={() => {
                    closeTabs(groupTabIds);
                    setContextMenu(null);
                  }}
                >
                  <span className="material-symbols-outlined">folder_off</span>
                  <span>Close Group ({groupTabIds.length} tabs)</span>
                </button>
              </>
            )}
          </div>
        );
      })()}

      <WorkspaceModal
        isOpen={isWorkspaceModalOpen}
        onClose={() => setIsWorkspaceModalOpen(false)}
      />
    </>
  );
};

export default TabBar;
