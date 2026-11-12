import React from 'react';
import { Check } from 'lucide-react';

interface WorkflowStepperProps {
  hasEnoughGroups: boolean;
  currentStep: 2 | 3;
}

export const WorkflowStepper: React.FC<WorkflowStepperProps> = ({
  hasEnoughGroups,
  currentStep,
}) => {
  const steps = [
    {
      num: 1,
      label: 'Generate data groups',
      completed: hasEnoughGroups,
      active: !hasEnoughGroups,
    },
    {
      num: 2,
      label: 'Test measurement invariance (MICOM, in Permutation)',
      completed: false,
      active: currentStep === 2,
    },
    {
      num: 3,
      label: 'Compare path coefficients (Permutation / MGA)',
      completed: false,
      active: currentStep === 3,
    },
  ];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '10px 14px',
      borderRadius: '8px',
      background: 'var(--color-bg-surface)',
      border: '1px solid var(--color-border-subtle)',
      fontSize: '11.5px',
      flexWrap: 'wrap',
    }}>
      {steps.map((s, idx) => (
        <React.Fragment key={s.num}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            color: s.active
              ? 'var(--color-accent)'
              : s.completed
                ? '#15803d'
                : 'var(--color-text-muted)',
            fontWeight: s.active || s.completed ? 600 : 400,
          }}>
            <span style={{
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10.5px',
              fontWeight: 700,
              background: s.completed
                ? 'rgba(22, 163, 74, 0.16)'
                : s.active
                  ? 'var(--color-accent-subtle)'
                  : 'var(--color-bg-raised)',
              color: s.completed
                ? '#15803d'
                : s.active
                  ? 'var(--color-accent)'
                  : 'var(--color-text-muted)',
              border: s.active ? '1px solid var(--color-accent)' : '1px solid var(--color-border-subtle)',
            }}>
              {s.completed ? <Check size={11} /> : s.num}
            </span>
            <span>{s.label}</span>
          </div>
          {idx < steps.length - 1 && (
            <span style={{ color: 'var(--color-text-muted)', margin: '0 2px' }}>→</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

