import React, { useEffect, useRef } from 'react';
import { useStore } from '../store';

const ContextMenu = () => {
  const { contextMenu, closeContextMenu } = useStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    
    // Slight delay so the click that opened it doesn't immediately close it
    if (contextMenu) {
      setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    }
    
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu, closeContextMenu]);

  if (!contextMenu) return null;

  // Basic boundary check (assuming fixed width/height for simplicity, could be dynamic)
  let { x, y } = contextMenu;
  x += 8; y += 8; // Offset from cursor
  
  const MAX_WIDTH = 200;
  const MAX_HEIGHT = contextMenu.items.length * 36;
  
  if (x + MAX_WIDTH > window.innerWidth) x -= (MAX_WIDTH + 16);
  if (y + MAX_HEIGHT > window.innerHeight) y -= (MAX_HEIGHT + 16);

  return (
    <div 
      ref={menuRef}
      className="cspls-context-menu visible" 
      style={{ left: `${x}px`, top: `${y}px`, zIndex: 9999 }}
    >
      {contextMenu.items.map(item => (
        <div 
          key={item.id} 
          className={`cspls-context-menu-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
          style={item.disabled ? { opacity: 0.38, cursor: 'not-allowed', pointerEvents: 'none', color: 'var(--color-text-muted, #94a3b8)' } : undefined}
          onClick={(e) => {
            if (item.disabled) return;
            e.stopPropagation();
            item.action();
            closeContextMenu();
          }}
        >
          <span className="material-symbols-outlined" style={item.disabled ? { color: 'var(--color-text-muted, #94a3b8)' } : undefined}>{item.icon}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
};

export default ContextMenu;
