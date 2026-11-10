import React, { useEffect } from 'react';
import { useStore } from '../store';

export const ConfirmDeleteModal: React.FC = () => {
  const { deleteConfirmation, closeDeleteConfirm } = useStore();

  useEffect(() => {
    if (!deleteConfirmation) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDeleteConfirm();
      else if (e.key === 'Enter') {
        e.preventDefault();
        deleteConfirmation.onConfirm();
        closeDeleteConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteConfirmation, closeDeleteConfirm]);

  if (!deleteConfirmation) return null;

  const { itemName, onConfirm } = deleteConfirmation;

  const handleConfirm = () => {
    onConfirm();
    closeDeleteConfirm();
  };

  return (
    <div className="modal-overlay active" style={{ display: 'flex', zIndex: 9999 }} onClick={closeDeleteConfirm}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '360px' }}>
        <div className="modal__header" style={{ borderBottom: 'none', paddingBottom: '8px' }}>
          <h2 className="modal__title">Delete{itemName ? ` "${itemName}"` : ''}?</h2>
        </div>
        <div className="modal__body" style={{ paddingTop: '0', gap: '0' }}>
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5, margin: 0 }}>
            This cannot be recovered. Are you sure you want to continue?
          </p>
        </div>
        <div className="modal__footer">
          <button className="modal__btn-cancel" type="button" onClick={closeDeleteConfirm}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            style={{
              padding: '8px 20px',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-md)',
              fontWeight: 500,
              backgroundColor: '#ef4444',
              color: 'white',
              border: '1px solid #ef4444',
              cursor: 'pointer',
              transition: 'background-color var(--transition-fast)',
              fontFamily: 'inherit',
            }}
            onMouseOver={e => (e.currentTarget.style.backgroundColor = '#dc2626')}
            onMouseOut={e => (e.currentTarget.style.backgroundColor = '#ef4444')}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;
