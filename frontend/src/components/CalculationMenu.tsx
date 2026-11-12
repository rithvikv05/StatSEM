import React from 'react';

const groups = [
  { label: 'Estimation', items: [
    ['pls', 'PLS-SEM'],
    ['bootstrap', 'Bootstrap inference'],
    ['consistent_pls', 'Consistent PLS-SEM'],
    ['consistent_bootstrap', 'Consistent bootstrap inference'],
  ] },
  { label: 'Prediction and measurement', items: [
    ['predict', 'Prediction and CVPAT'],
    ['ipma', 'Importance and performance (IPMA)'],
    ['cta', 'Confirmatory tetrad analysis'],
    ['pca', 'Principal component analysis'],
    ['compare', 'Compare saved models'],
  ] },
  { label: 'Groups and segments', items: [
    ['mga', 'Multigroup analysis'],
    ['mga_consistent', 'Consistent multigroup analysis'],
    ['permutation', 'Permutation (Data groups)...'],
    ['mga_groups', 'Multigroup analysis (Data groups)...'],
    ['fimix', 'Finite mixture segmentation (FIMIX)'],
    ['pos', 'Prediction-oriented segmentation (POS)'],
  ] },
];

interface CalculationMenuProps {
  onSelect: (id: string) => void;
  dataGroupsCount?: number;
}

export const CalculationMenu: React.FC<CalculationMenuProps> = ({ onSelect, dataGroupsCount }) => (
  <div className="subheader__dropdown-menu calculation-menu">
    {groups.map(group => (
      <div key={group.label} className="calculation-menu__group">
        <div className="calculation-menu__heading">{group.label}</div>
        {group.items.map(([id, label]) => {
          const requiresDataGroups = id === 'permutation' || id === 'mga_groups';
          const disabled = requiresDataGroups && dataGroupsCount !== undefined && dataGroupsCount < 2;
          const title = requiresDataGroups
            ? disabled
              ? 'Create at least two data groups first (open your data file → Generate Data Groups).'
              : id === 'permutation'
                ? 'Run Permutation MGA & MICOM invariance test'
                : 'Run Parametric, Welch-Satterthwaite & Henseler MGA'
            : undefined;
          return (
            <button
              key={id}
              type="button"
              className="subheader__dropdown-item"
              disabled={disabled}
              title={title}
              style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              onClick={() => { if (!disabled) onSelect(id); }}
            >
              {label}
            </button>
          );
        })}
      </div>
    ))}
  </div>
);
