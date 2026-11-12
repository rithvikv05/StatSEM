import React from 'react';

const groups = [
  {
    label: 'Partial Least Squares',
    items: [
      ['pls', 'PLS-SEM'],
      ['consistent_pls', 'Consistent PLS-SEM'],
      ['bootstrap', 'Bootstrapping'],
      ['consistent_bootstrap', 'Consistent Bootstrapping'],
    ],
  },
  {
    label: 'Testing & Prediction',
    items: [
      ['cta', 'Confirmatory Tetrad Analysis (CTA)'],
      ['ipma', 'Importance-Performance Map Analysis (IPMA)'],
      ['predict', 'PLSpredict / CVPAT'],
      ['pca', 'Principal Component Analysis (PCA)'],
    ],
  },
  {
    label: 'Groups & Segments',
    items: [
      ['mga_bootstrap', 'Bootstrap MGA'],
      ['mga_bootstrap_consistent', 'Consistent Bootstrap MGA'],
      ['permutation', 'Permutation MGA'],
      ['permutation_consistent', 'Consistent Permutation MGA'],
      ['fimix', 'Finite Mixture Segmentation (FIMIX)'],
      ['pos', 'Prediction-Oriented Segmentation (POS)'],
    ],
  },
];

interface CalculationMenuProps {
  onSelect: (id: string) => void;
  dataGroupsCount?: number;
}

export const CalculationMenu: React.FC<CalculationMenuProps> = ({ onSelect }) => (
  <div className="subheader__dropdown-menu calculation-menu">
    {groups.map(group => (
      <div key={group.label} className="calculation-menu__group">
        <div className="calculation-menu__heading">{group.label}</div>
        {group.items.map(([id, label]) => {
          return (
            <button
              key={id}
              type="button"
              className="subheader__dropdown-item"
              onClick={() => onSelect(id)}
            >
              {label}
            </button>
          );
        })}
      </div>
    ))}
  </div>
);
