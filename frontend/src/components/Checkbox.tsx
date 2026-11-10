import React from 'react';

export interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  indeterminate = false,
  onChange,
  disabled = false,
  ariaLabel,
  className = '',
  style,
  id,
}) => {
  const isChecked = checked && !indeterminate;
  const isPartiallyChecked = indeterminate;

  return (
    <label
      className={`custom-checkbox-wrapper ${disabled ? 'custom-checkbox-disabled' : ''} ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        verticalAlign: 'middle',
        userSelect: 'none',
        ...style,
      }}
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={e => onChange?.(e.target.checked)}
        className="custom-checkbox-native"
        ref={el => {
          if (el) el.indeterminate = indeterminate;
        }}
      />
      <span
        className={`custom-checkbox-box ${isChecked ? 'custom-checkbox-checked' : ''} ${isPartiallyChecked ? 'custom-checkbox-indeterminate' : ''}`}
      >
        {isChecked && (
          <svg
            viewBox="0 0 14 14"
            fill="none"
            className="custom-checkbox-icon"
          >
            <polyline
              points="3 7.5 5.5 10 11 4.5"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {isPartiallyChecked && (
          <svg
            viewBox="0 0 14 14"
            fill="none"
            className="custom-checkbox-icon"
          >
            <line
              x1="3"
              y1="7"
              x2="11"
              y2="7"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
    </label>
  );
};

export default Checkbox;
