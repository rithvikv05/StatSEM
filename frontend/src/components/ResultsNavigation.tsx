import React, { useEffect, useRef, useState } from 'react';
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
  savedCalculations?: string[];
  onSelectSavedCalculation?: (id: string) => void;
  activeCalculation?: string;
  analysisOnly?: boolean;
  hasBootstrap?: boolean;
  mgaAvailable?: string[];
  hasModeration?: boolean;
  analysisTitle?: string;
  analysisSections?: string[];
  moderationSections?: Array<{ id: string; label: string }>;
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
];

const MGA_PARAM_KEYS = [
  'path_coefficients',
  'total_effects',
  'total_indirect_effects',
  'specific_indirect_effects',
  'outer_loadings',
  'outer_weights',
];

const CALCULATION_LABELS: Record<string, string> = {
  pls: 'PLS-SEM', _saved_pls: 'PLS-SEM', _saved_consistent_pls: 'Consistent PLS-SEM',
  _saved_mga: 'Bootstrap MGA', _saved_consistent_mga: 'Consistent bootstrap MGA',
  _saved_permutation: 'Permutation MGA', _saved_consistent_permutation: 'Consistent permutation MGA',
  cta: 'Confirmatory tetrad analysis', ipma: 'Importance-performance analysis',
  predict: 'PLSpredict / CVPAT', pca: 'Principal component analysis',
};

export const ResultsNavigation: React.FC<ResultsNavigationProps> = ({
  activeTab,
  onSelect,
  snapshot = false,
  hasRedundancy = false,
  hasRunDetails = false,
  hasSpecificIndirect = false,
  isMga = false,
  hasMicom = false,
  savedCalculations = [],
  onSelectSavedCalculation,
  activeCalculation,
  analysisOnly = false,
  hasBootstrap = false,
  mgaAvailable,
  hasModeration = false,
  analysisTitle,
  analysisSections = [],
  moderationSections = [],
}) => {
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [savedOpen, setSavedOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!savedOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!pickerRef.current?.contains(target) && !pickerButtonRef.current?.contains(target)) setSavedOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSavedOpen(false);
        pickerButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [savedOpen]);

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
    ] },
    ...(hasModeration ? [{ label: 'Moderation effects', items: moderationSections.length ? moderationSections.map(({ id, label }) => [id, label]) : [['moderation', 'Conditional effects']] }] : []),
    ...(hasBootstrap ? [{ label: 'Bootstrap inference', items: [['bootstrap_paths', 'Structural paths'], ['bootstrap_loadings', 'Outer loadings']] }] : []),
    { label: 'Model checks', items: [
      ['model_fit', 'Model fit (SRMR)'],
      ['r_squared', 'R-square (R²)'],
      ['f_squared', 'f-square (f²)'],
      [snapshot ? 'construct_reliability' : 'reliability', 'Construct reliability & validity'],
      ...(hasRedundancy ? [['convergent_validity_redundancy', 'Convergent validity (redundancy)']] : []),
    ] },
    { label: 'Discriminant validity', items: snapshot ? [['htmt', 'HTMT'], ['fornell_larcker', 'Fornell-Larcker']] : [['discriminant_htmt', 'HTMT'], ['discriminant_fornell', 'Fornell-Larcker']] },
    { label: 'Collinearity (VIF)', items: [['collinearity_inner', 'Inner model'], ['collinearity_outer', 'Outer model']] },
  ];

  const mgaDirectItems: Array<[string, string]> = [
    ['path_coefficients', 'Path coefficients'],
    ...(!hasMicom ? [['total_effects', 'Total effects'], ['total_indirect_effects', 'Total indirect effects']] as Array<[string, string]> : []),
    ...(!hasMicom && hasSpecificIndirect ? [['specific_indirect_effects', 'Specific indirect effects']] as Array<[string, string]> : []),
    ['outer_loadings', 'Outer loadings'],
    ['outer_weights', 'Outer weights'],
    ...(hasMicom ? [['micom', 'MICOM (Invariance)']] as Array<[string, string]> : []),
  ];

  // Collapse / Expand All toggle logic
  const areAllCollapsed = (isMga
    ? MGA_PARAM_KEYS.every(k => collapsedCategories.has(k))
    : standardGroups.every(g => collapsedGroups.includes(g.label)));

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
        ) : savedCalculations.length > 0 ? (
          <button ref={pickerButtonRef} type="button" className="results-calculation-picker__trigger" aria-expanded={savedOpen} aria-haspopup="menu" aria-label="Select saved calculation" onClick={() => setSavedOpen(open => !open)}>
            <span>{CALCULATION_LABELS[activeCalculation || ''] || 'Select calculation'}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
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
              setSavedOpen(false);
              setIsSearchOpen((open) => !open);
              if (isSearchOpen) setQuery('');
            }}
          >
            <span className="material-symbols-outlined">search</span>
          </button>
          {!analysisOnly && <button
            className="icon-btn icon-btn--sm"
            title={areAllCollapsed ? 'Expand all' : 'Collapse all'}
            type="button"
            onClick={handleToggleAll}
          >
            <span className="material-symbols-outlined">
              {areAllCollapsed ? 'unfold_more' : 'unfold_less'}
            </span>
          </button>}
        </div>
      </div>

      {savedCalculations.length > 0 && savedOpen && !isSearchOpen && (
        <div ref={pickerRef} className="canvas-dataset-dropdown results-calculation-picker" role="menu" aria-label="Switch calculation">
          <div className="canvas-dataset-dropdown__header">Switch calculation</div>
          <div className="canvas-dataset-dropdown__list">
            {savedCalculations.map(id => (
              <button key={id} type="button" role="menuitemradio" aria-checked={activeCalculation === id}
                className={`canvas-dataset-dropdown__item results-calculation-picker__item ${activeCalculation === id ? 'selected' : ''}`}
                onClick={() => { setSavedOpen(false); onSelectSavedCalculation?.(id); }}>
                <span className="canvas-dataset-dropdown__item-name">{CALCULATION_LABELS[id] || id}</span>
                {activeCalculation === id && <span className="material-symbols-outlined results-calculation-picker__check" aria-hidden="true">check</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="results-sidebar__tree">
        {analysisOnly ? (
          <div className="tree-section">
            <button type="button" className="tree-section__header tree-section__toggle" aria-expanded={!collapsedGroups.includes('analysis')} onClick={() => setCollapsedGroups(prev => prev.includes('analysis') ? prev.filter(item => item !== 'analysis') : [...prev, 'analysis'])}>
              <svg className={!collapsedGroups.includes('analysis') ? 'open' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
              <span>{analysisTitle || CALCULATION_LABELS[activeCalculation || ''] || 'Analysis'}</span>
            </button>
            {(!collapsedGroups.includes('analysis') || !!term) && <div className="tree-section__items">
              {analysisSections.map((label, index) => ({ label, index })).filter(({ label }) => !term || matchesResultSearch(term, label)).map(({ label, index }) => {
                const id = `analysis_${activeCalculation}::${index}`;
                const active = activeTab === id || (index === 0 && activeTab === `analysis_${activeCalculation}`);
                return <button key={id} type="button" className={`tree-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => onSelect(id)}>{label}</button>;
              })}
            </div>}
          </div>
        ) : isMga ? (
          /* MGA: Starts directly from path coefficients, no outer 'MGA Estimates' or 'Final results' header */
          <div className="mga-results-navigation">
            {mgaDirectItems
              .filter(([id]) => !MGA_PARAM_KEYS.includes(id) || !mgaAvailable || mgaAvailable.includes(id))
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

                if (id === 'micom') {
                  const open = !!term || !collapsedCategories.has(id);
                  const items = [['summary', 'Summary'], ['step1', 'Configural invariance'], ['step2', 'Compositional invariance'], ['step3a', 'Equal means'], ['step3b', 'Equal variances']];
                  return <div key={id} className="tree-section">
                    <button type="button" className="tree-section__header tree-section__toggle" aria-expanded={open} onClick={() => toggleCategoryCollapse(id)}>
                      <svg className={open ? 'open' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg><span>{label}</span>
                    </button>
                    {open && <div className="tree-section__items">{items.filter(([, text]) => !term || matchesResultSearch(term, label, text)).map(([key, text]) => {
                      const active = activeTab === `micom__${key}` || (activeTab === 'micom' && key === 'summary');
                      return <button type="button" key={key} className={`tree-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => onSelect(`micom__${key}`)}>{text}</button>;
                    })}</div>}
                  </div>;
                }

                if (!isMgaParam) {
                  // Non-parameter item (e.g. MICOM, Run details)
                  const isActive = activeTab === id;
                  return (
                    <button type="button" key={id} className={`tree-item ${isActive ? 'active' : ''}`} aria-current={isActive ? 'page' : undefined} onClick={() => onSelect(id)}>
                      {label}
                    </button>
                  );
                }

                const isCatOpen = !!term || !collapsedCategories.has(id);
                const matchingSubViews = subViews.filter(([subKey, subLabel]) =>
                  !term || matchesResultSearch(term, label, id) || matchesResultSearch(term, subLabel, subKey)
                );

                return (
                  <div key={id} className="tree-section">
                    <button
                      type="button"
                      className="tree-section__header tree-section__toggle"
                      aria-expanded={isCatOpen}
                      disabled={!!term}
                      onClick={() => {
                        if (!isCatOpen) {
                          toggleCategoryCollapse(id);
                          onSelect(`${id}__${activeSub || subViews[0][0]}`);
                        } else {
                          toggleCategoryCollapse(id);
                        }
                      }}
                    >
                      <svg
                        className={isCatOpen ? 'open' : ''}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span>{label}</span>
                    </button>

                    {isCatOpen && (
                      <div className="tree-section__items">
                        {matchingSubViews.map(([subKey, subLabel]) => {
                          const isSubActive =
                            activeCat === id &&
                            (activeSub === subKey || (!activeTab.includes('__') && subKey === subViews[0][0]));
                          return (
                            <button
                              type="button"
                              key={subKey}
                              className={`tree-item ${isSubActive ? 'active' : ''}`}
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

          </>
        )}
        {hasRunDetails && (!term || matchesResultSearch(term, 'Run details', 'run details')) && (
          <div className="results-run-details-nav">
            <button type="button" className={`tree-item ${activeTab === (analysisOnly ? 'analysis_run_details' : 'run_details') ? 'active' : ''}`} aria-current={activeTab === (analysisOnly ? 'analysis_run_details' : 'run_details') ? 'page' : undefined} onClick={() => onSelect(analysisOnly ? 'analysis_run_details' : 'run_details')}>Run details</button>
          </div>
        )}
      </div>
    </aside>
  );
};
