import React, { useState } from 'react';
import { matchesResultSearch } from '../utils/result-search';

interface ResultsNavigationProps {
  activeTab: string;
  onSelect: (id: string) => void;
  snapshot?: boolean;
  hasRedundancy?: boolean;
  hasRunDetails?: boolean;
  hasSpecificIndirect?: boolean;
}

export const ResultsNavigation: React.FC<ResultsNavigationProps> = ({
  activeTab, onSelect, snapshot = false, hasRedundancy = false, hasRunDetails = false, hasSpecificIndirect = false,
}) => {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const term = query.trim().toLowerCase();
  const groups = [
    { label: 'Estimates', items: [
      ['path_coefficients', 'Direct paths'],
      ['total_effects', 'Combined effects'],
      ['total_indirect_effects', 'Indirect effects'],
      ...(hasSpecificIndirect ? [['specific_indirect_effects', 'Individual indirect paths']] : []),
      ['outer_loadings', 'Indicator loadings'],
      ['outer_weights', 'Indicator weights'],
      ['construct_scores', 'Construct scores'],
      ['hypotheses', 'Hypotheses testing'],
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
    ...(hasRunDetails ? [{ label: 'Calculation', items: [['run_details', 'Run details']] }] : []),
  ].map(group => ({
    ...group,
    items: group.items.filter(([id, label]) => matchesResultSearch(term, label, id.replaceAll('_', ' '))),
  })).filter(group => group.items.length > 0);

  return (
    <aside className="results-sidebar" aria-label={snapshot ? 'Snapshot results' : 'Results'}>
      <div className="results-sidebar__search">
        <div className="results-sidebar__search-wrap">
          <svg className="results-sidebar__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx={11} cy={11} r={8} /><line x1={21} y1={21} x2="16.65" y2="16.65" /></svg>
          <input
            type="search"
            className="results-sidebar__search-input"
            placeholder="Filter results..."
            aria-label="Filter results"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="results-sidebar__tree">
        {groups.length === 0 && <p className="results-sidebar__empty">No results match your search.</p>}
        {groups.map(group => {
          const open = !!term || !collapsed.includes(group.label);
          return (
            <div className="tree-section" key={group.label}>
              <button
                type="button"
                className="tree-section__header tree-section__toggle"
                aria-expanded={open}
                disabled={!!term}
                onClick={() => setCollapsed(previous => previous.includes(group.label)
                  ? previous.filter(label => label !== group.label) : [...previous, group.label])}
              >
                <svg className={open ? 'open' : ''} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                <span>{group.label}</span>
              </button>
              {open && <div className="tree-section__items">
                {group.items.map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    className={`tree-item ${activeTab === id ? 'active' : ''}`}
                    aria-current={activeTab === id ? 'page' : undefined}
                    onClick={() => onSelect(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
