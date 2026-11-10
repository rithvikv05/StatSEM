import React, { useState, useRef, useEffect } from 'react';

interface EditableCellProps {
  value: string | number;
  onChange: (val: string) => void;
  type?: 'text' | 'number';
  className?: string;
  disabled?: boolean;
}

export const EditableCell: React.FC<EditableCellProps> = ({
  value,
  onChange,
  type = 'text',
  className = '',
  disabled = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTempValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commit = () => {
    setIsEditing(false);
    if (tempValue !== value) {
      onChange(tempValue.toString());
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={tempValue}
        onChange={e => setTempValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setTempValue(value);
            setIsEditing(false);
          }
        }}
        className={`editable-cell-input ${className}`}
      />
    );
  }

  return (
    <span
      onClick={() => !disabled && setIsEditing(true)}
      className={`editable-cell-display ${!disabled ? 'editable-cell-display--interactive' : ''} ${className}`}
      title={!disabled ? 'Click to edit' : undefined}
    >
      {value !== '' && value !== null && value !== undefined ? value : '\u00A0'}
    </span>
  );
};
