import React, { useState } from 'react';
import { matchesResultSearch } from '../utils/result-search';

interface ResultsNavigationProps {
  activeTab: string;
  onSelect: (id: string) => void;
  snapshot?: boolean;
  hasRedundancy?: boolean;
  hasRunDetails?: boolean;
  hasSpecificIndirect?: boolean;
  isMga?: boolean;
  hasMicom?: boolean;
}

const MGA_SUB_VIEWS: Array<[string, string]> = [
  ['bootstrap_mga', 'Bootstrap MGA'],
  ['parametric', 'Parametric test'],
  ['welch', 'Welch-Satterthwaite test'],
  ['confidence_intervals', 'Confidence intervals'],
  ['bootstrapping_results', 'Bootstrapping results'],
];

const PERMUTATION_SUB_VIEWS: Array<[string, string]> = [
  ['permutation_test', 'Permutation test'],
  ['confidence_intervals', 'Confidence intervals'],
];

const MGA_PARAM_KEYS = [
  'path_coefficients',
  'total_effects',
  'total_indirect_effects',
  'specific_indirect_effects',
  'outer_loadings',
  'outer_weights',
];

export const ResultsNavigation: React.FC<ResultsNavigationProps> = ({
  activeTab,
  onSelect,
  snapshot = false,
  hasRedundancy = false,
  hasRunDetails = false,
  hasSpecificIndirect = false,
  isMga = false,
  hasMicom = false,
}) => {
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const term = query.trim().toLowerCase();
  const subViews = hasMicom ? PERMUTATION_SUB_VIEWS : MGA_SUB_VIEWS;

  // Active category & subview
  const [activeCat, activeSub] = activeTab.includes('__')
    ? activeTab.split('__')
    : [activeTab, subViews[0]?.[0] || ''];

  const standardGroups = [
    { label: 'Estimates', items: [
      ['path_coefficients', 'Path coefficients'],
      ['total_effects', 'Total effects'],
      ['total_indirect_effects', 'Total indirect effects'],
      ...(hasSpecificIndirect ? [['specific_indirect_effects', 'Specific indirect effects']] : []),
      ['outer_loadings', 'Outer loadings'],
      ['outer_weights', 'Outer weights'],
      ['construct_scores', 'Construct scores'],
      ...(!snapshot ? [['bootstrap_significance', 'Bootstrap inference']] : []),
    ] },
    { label: 'Model checks', items: [
      ['model_fit', 'Model fit (SRMR)'],
      ['r_squared', 'R-square (R²)'],
      ['f_squared', 'f-square (f²)'],
      [snapshot ? 'construct_reliability' : 'reliability', 'Construct reliability & validity'],
      ...(snapshot ? [['htmt', 'Discriminant validity (HTMT)'], ['fornell_larcker', 'Fornell-Larcker criterion']]
        : [['discriminant', 'Discriminant validity']]),
      ['collinearity', 'Collinearity (VIF)'],
      ...(hasRedundancy ? [['convergent_validity_redundancy', 'Convergent validity (redundancy)']] : []),
    ] },
  ];

  const mgaDirectItems: Array<[string, string]> = [
    ['path_coefficients', 'Path coefficients'],
    ['total_effects', 'Total effects'],
    ['total_indirect_effects', 'Total indirect effects'],
    ...(hasSpecificIndirect ? [['specific_indirect_effects', 'Specific indirect effects']] as Array<[string, string]> : []),
    ['outer_loadings', 'Outer loadings'],
    ['outer_weights', 'Outer weights'],
    ...(hasMicom ? [['micom', 'MICOM (Invariance)']] as Array<[string, string]> : []),
    ...(hasRunDetails ? [['run_details', 'Run details']] as Array<[string, string]> : []),
  ];

  // Collapse / Expand All toggle logic
  const areAllCollapsed = isMga
    ? MGA_PARAM_KEYS.every(k => collapsedCategories.has(k))
    : standardGroups.every(g => collapsedGroups.includes(g.label));

  const handleToggleAll = () => {
    if (isMga) {
      if (areAllCollapsed) {
        setCollapsedCategories(new Set());
      } else {
        setCollapsedCategories(new Set(MGA_PARAM_KEYS));
      }
    } else {
      if (areAllCollapsed) {
        setCollapsedGroups([]);
      } else {
        setCollapsedGroups(standardGroups.map(g => g.label));
      }
    }
  };

  const toggleCategoryCollapse = (catId: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  };

  return (
    <aside className="results-sidebar" aria-label={snapshot ? 'Snapshot results' : 'Results'}>
      {/* Model-style Header with Inline Search and Collapse-all Actions */}
      <div className="var-sidebar__header">
        {isSearchOpen ? (
          <div className="inline-search-wrap">
            <input
              autoFocus
              type="text"
              className="sidebar-inline-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsSearchOpen(false);
                  setQuery('');
                }
              }}
              onBlur={() => {
                if (!query) setIsSearchOpen(false);
              }}
              placeholder="Filter results…"
            />
            {query && (
              <button
                className="inline-search-clear"
                type="button"
                aria-label="Clear filter"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setQuery('')}
              >
                ×
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, flex: 1 }}>
            <span className="var-sidebar__header-label">Results</span>
          </div>
        )}
        <div className="var-sidebar__header-actions">
          <button
            className={`icon-btn icon-btn--sm ${isSearchOpen ? 'active' : ''}`}
            title="Filter results"
            type="button"
            onClick={() => {
              setIsSearchOpen((open) => !open);
              if (isSearchOpen) setQuery('');
            }}
          >
            <span className="material-symbols-outlined">search</span>
          </button>
          <button
            className="icon-btn icon-btn--sm"
            title={areAllCollapsed ? 'Expand all' : 'Collapse all'}
            type="button"
            onClick={handleToggleAll}
          >
            <span className="material-symbols-outlined">
              {areAllCollapsed ? 'unfold_more' : 'unfold_less'}
            </span>
          </button>
        </div>
      </div>

      <div className="results-sidebar__tree">
        {isMga ? (
          /* MGA: Starts directly from path coefficients, no outer 'MGA Estimates' or 'Final results' header */
          <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {mgaDirectItems
              .filter(([id, label]) => {
                if (!term) return true;
                if (matchesResultSearch(term, label, id.replaceAll('_', ' '))) return true;
                if (MGA_PARAM_KEYS.includes(id)) {
                  return subViews.some(([subKey, subLabel]) =>
                    matchesResultSearch(term, subLabel, subKey.replaceAll('_', ' '))
                  );
                }
                return false;
              })
              .map(([id, label]) => {
                const isMgaParam = MGA_PARAM_KEYS.includes(id);

                if (!isMgaParam) {
                  // Non-parameter item (e.g. MICOM, Run details)
                  const isActive = activeTab === id;
                  return (
                    <button
                      type="button"
                      key={id}
                      className={`tree-item ${isActive ? 'active' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                      style={{
                        fontWeight: 600,
                        color: isActive ? 'var(--color-accent)' : 'var(--color-text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginBottom: '2px',
                        padding: '5px 8px',
                      }}
                      onClick={() => onSelect(id)}
                    >
                      {label}
                    </button>
                  );
                }

                const isCatOpen = !!term || !collapsedCategories.has(id);
                const matchingSubViews = subViews.filter(([subKey, subLabel]) =>
                  !term || matchesResultSearch(term, label, id) || matchesResultSearch(term, subLabel, subKey)
                );

                return (
                  <div key={id} style={{ display: 'flex', flexDirection: 'column', marginBottom: '2px' }}>
                    {/* Category Header: Not highlighted as active, toggles collapse/expand */}
                    <button
                      type="button"
                      className="tree-item"
                      style={{
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingRight: '8px',
                        cursor: 'pointer',
                        background: 'transparent',
                        color: 'var(--color-text-primary)',
                      }}
                      onClick={() => {
                        if (!isCatOpen) {
                          toggleCategoryCollapse(id);
                          onSelect(`${id}__${activeSub || subViews[0][0]}`);
                        } else {
                          toggleCategoryCollapse(id);
                        }
                      }}
                    >
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {label}
                      </span>
                      <svg
                        style={{
                          width: '12px',
                          height: '12px',
                          transform: isCatOpen ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.15s ease',
                          opacity: 0.6,
                          flexShrink: 0,
                          marginLeft: '6px',
                        }}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>

                    {/* Sub-items: Only the selected sub-item is highlighted */}
                    {isCatOpen && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          marginLeft: '10px',
                          paddingLeft: '8px',
                          borderLeft: '1px solid var(--color-border-subtle)',
                          gap: '1px',
                          marginTop: '1px',
                          marginBottom: '3px',
                        }}
                      >
                        {matchingSubViews.map(([subKey, subLabel]) => {
                          const isSubActive =
                            activeCat === id &&
                            (activeSub === subKey || (!activeTab.includes('__') && subKey === subViews[0][0]));
                          return (
                            <button
                              type="button"
                              key={subKey}
                              className={`tree-item ${isSubActive ? 'active' : ''}`}
                              style={{
                                fontSize: '11.5px',
                                padding: '4px 6px',
                                fontWeight: isSubActive ? 600 : 400,
                                borderRadius: '4px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              aria-current={isSubActive ? 'page' : undefined}
                              onClick={() => onSelect(`${id}__${subKey}`)}
                            >
                              {subLabel}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        ) : (
          /* Standard PLS Results */
          <>
            {standardGroups
              .map(group => ({
                ...group,
                items: group.items.filter(([id, label]) =>
                  !term || matchesResultSearch(term, label, id.replaceAll('_', ' '))
                ),
              }))
              .filter(group => group.items.length > 0)
              .map(group => {
                const open = !!term || !collapsedGroups.includes(group.label);
                return (
                  <div className="tree-section" key={group.label}>
                    <button
                      type="button"
                      className="tree-section__header tree-section__toggle"
                      aria-expanded={open}
                      disabled={!!term}
                      onClick={() =>
                        setCollapsedGroups(prev =>
                          prev.includes(group.label)
                            ? prev.filter(l => l !== group.label)
                            : [...prev, group.label]
                        )
                      }
                    >
                      <svg className={open ? 'open' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span>{group.label}</span>
                    </button>
                    {open && (
                      <div className="tree-section__items">
                        {group.items.map(([id, label]) => {
                          const isActive = (!isMga && activeTab.includes('__') ? activeTab.split('__')[0] : activeTab) === id;
                          return (
                            <button
                              type="button"
                              key={id}
                              className={`tree-item ${isActive ? 'active' : ''}`}
                              aria-current={isActive ? 'page' : undefined}
                              style={{
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              onClick={() => onSelect(id)}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

            {hasRunDetails && (!term || matchesResultSearch(term, 'Run details', 'run details')) && (
              <div style={{ marginTop: '8px', paddingTop: '4px', borderTop: '1px solid var(--color-border-subtle)', padding: '4px 8px' }}>
                <button
                  type="button"
                  className={`tree-item ${(!isMga && activeTab.includes('__') ? activeTab.split('__')[0] : activeTab) === 'run_details' ? 'active' : ''}`}
                  aria-current={(!isMga && activeTab.includes('__') ? activeTab.split('__')[0] : activeTab) === 'run_details' ? 'page' : undefined}
                  style={{
                    fontWeight: 600,
                    color: (!isMga && activeTab.includes('__') ? activeTab.split('__')[0] : activeTab) === 'run_details' ? 'var(--color-accent)' : 'var(--color-text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    padding: '5px 8px',
                  }}
                  onClick={() => onSelect('run_details')}
                >
                  Run details
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
