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
    ['fimix', 'Finite mixture segmentation (FIMIX)'],
    ['pos', 'Prediction-oriented segmentation (POS)'],
  ] },
];

interface CalculationMenuProps {
  onSelect: (id: string) => void;
}

export const CalculationMenu: React.FC<CalculationMenuProps> = ({ onSelect }) => (
  <div className="subheader__dropdown-menu calculation-menu">
    {groups.map(group => (
      <div key={group.label} className="calculation-menu__group">
        <div className="calculation-menu__heading">{group.label}</div>
        {group.items.map(([id, label]) => (
          <button key={id} type="button" className="subheader__dropdown-item" onClick={() => onSelect(id)}>{label}</button>
        ))}
      </div>
    ))}
  </div>
);
