import React, { useState } from 'react';
import { useStore } from '../store';

const Toolbar = () => {
  const { mode, setMode } = useStore();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const toggleDropdown = (id: string) => {
    setOpenDropdown(openDropdown === id ? null : id);
  };

  return (
    <div className="canvas-toolbar">
        <div className="tb-btn active" title="Select (V)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg></div>
        <div className="tb-btn" title="Latent variable (O)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8"></circle></svg></div>
        <div className="tb-btn" title="Connect (P) - Connect constructs or drag to the middle of a path for moderation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></div>
        <div className="tb-btn" title="Moderation Effect (M)" style={{ display: 'none' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg></div>
        <div className="tb-btn" title="Quadratic Effect (Q)"><span className="tb-btn--text">x²</span></div>
        <div className="tb-btn" title="Gaussian Copula"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M2 15h10"></path><path d="M6 11l-4 4 4 4"></path></svg></div>
        <div className="tb-btn" title="Text Note (T)"><span className="tb-btn--text">T</span></div>
        
        <div className="tb-divider"></div>
        
        <div className="tb-btn" title="Auto-Align Model"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="6" height="6" rx="1"></rect><rect x="14" y="14" width="6" height="6" rx="1"></rect><line x1="10" y1="7" x2="17" y2="7"></line><line x1="17" y1="7" x2="17" y2="14"></line></svg></div>
        
        <div className="tb-dropdown-container">
          <button className="tb-dropdown-btn" type="button" title="Alignment" id="btn-align" onClick={() => toggleDropdown('align')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="15" y1="12" x2="3" y2="12"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div className="tb-dropdown-menu" id="menu-align" style={{ display: openDropdown === 'align' ? 'block' : 'none' }}>
            <div className="tb-dropdown-item" data-action="align-top"><span className="material-symbols-outlined">align_vertical_top</span> Align Top</div>
            <div className="tb-dropdown-item" data-action="align-bottom"><span className="material-symbols-outlined">align_vertical_bottom</span> Align Bottom</div>
            <div className="tb-dropdown-item" data-action="align-left"><span className="material-symbols-outlined">align_horizontal_left</span> Align Left</div>
            <div className="tb-dropdown-item" data-action="align-right"><span className="material-symbols-outlined">align_horizontal_right</span> Align Right</div>
          </div>
        </div>
        
        <div className="tb-dropdown-container">
          <button className="tb-dropdown-btn" type="button" title="Style" id="btn-style" onClick={() => toggleDropdown('style')}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>palette</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div className="tb-dropdown-menu" id="menu-style" style={{ display: openDropdown === 'style' ? 'block' : 'none' }}>
            <div className="tb-dropdown-item" data-action="shape-circle"><span className="material-symbols-outlined">radio_button_unchecked</span> Circle</div>
            <div className="tb-dropdown-item" data-action="shape-rect"><span className="material-symbols-outlined">crop_square</span> Rectangle</div>
            <div className="tb-dropdown-item" data-action="shape-hex"><span className="material-symbols-outlined">hexagon</span> Hexagon</div>
            <div className="tb-dropdown-item" data-action="shape-oct"><span className="material-symbols-outlined">stop_circle</span> Octagon</div>
          </div>
        </div>
        
        <div className="tb-dropdown-container">
          <button className="tb-dropdown-btn" type="button" title="Text Format" id="btn-text" onClick={() => toggleDropdown('text')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div className="tb-dropdown-menu" id="menu-text" style={{ display: openDropdown === 'text' ? 'block' : 'none' }}>
            <div className="tb-dropdown-item" data-action="text-bold"><span className="material-symbols-outlined">format_bold</span> Bold</div>
            <div className="tb-dropdown-item" data-action="text-italic"><span className="material-symbols-outlined">format_italic</span> Italic</div>
            <div className="tb-dropdown-item" data-action="text-underline"><span className="material-symbols-outlined">format_underlined</span> Underline</div>
            <div className="tb-dropdown-item" data-action="text-increase"><span className="material-symbols-outlined">text_increase</span> Increase Font</div>
            <div className="tb-dropdown-item" data-action="text-decrease"><span className="material-symbols-outlined">text_decrease</span> Decrease Font</div>
          </div>
        </div>
        
        <div className="tb-btn tb-btn--accent" title="Add Comment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div>
      </div>
  );
};

export default Toolbar;
