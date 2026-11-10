import React, { useState, useEffect, useRef } from 'react';

interface InputDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  placeholder?: string;
  submitLabel?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
}

const InputDialog = ({
  isOpen,
  onClose,
  title,
  placeholder,
  submitLabel = 'Save',
  initialValue = '',
  onSubmit,
}: InputDialogProps) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      // Focus and select-all after mount
      requestAnimationFrame(() => {
        inputRef.current?.select();
      });
    }
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim());
    onClose();
  };

  return (
    <div className="modal-overlay active" style={{ display: 'flex', zIndex: 9999 }} onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
        <div className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button className="icon-btn icon-btn--sm" type="button" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal__body">
            <div className="modal__field">
              <input
                ref={inputRef}
                id="input-dialog-value"
                type="text"
                className="modal__input"
                placeholder={placeholder || 'Enter a name…'}
                value={value}
                onChange={e => setValue(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div className="modal__footer">
            <button className="modal__btn-cancel" type="button" onClick={onClose}>Cancel</button>
            <button className="modal__btn-create" type="submit" disabled={!value.trim()}>{submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InputDialog;
