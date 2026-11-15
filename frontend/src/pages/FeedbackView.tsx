import React, { useState } from 'react';
import AppSidebar from '../components/AppSidebar';
import { api } from '../utils/api';

export const FeedbackView: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const email = 'f20230352@hyderabad.bits-pilani.ac.in';
  const mailtoUrl = `mailto:${email}?subject=StatSEM%20Feedback`;
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=StatSEM%20Feedback`;

  const handleCopy = () => {
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleOpenMail = (e: React.MouseEvent) => {
    e.preventDefault();
    api.openExternalUrl(mailtoUrl);
  };

  const handleOpenGmail = (e: React.MouseEvent) => {
    e.preventDefault();
    api.openExternalUrl(gmailUrl);
  };

  return (
    <div className="app-body">
      <AppSidebar activeNav="feedback" />

      <main className="ws-main">
        <div className="ws-inner">
          <div className="ws-header animate-fade-in">
            <div className="ws-header__left">
              <h1 className="ws-title-editable" style={{ cursor: 'default' }}>Feedback &amp; Support</h1>
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px', width: '100%' }}>
            <div
              className="release-card animate-fade-in"
              style={{
                width: '100%',
                padding: '24px 28px',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border-default)',
                backgroundColor: 'var(--color-bg-surface)',
                boxShadow: 'var(--shadow-xs)',
                boxSizing: 'border-box',
              }}
            >
              <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                If you have any problems, questions, or bug reports, mail here:{' '}
                <a
                  href={mailtoUrl}
                  onClick={handleOpenMail}
                  style={{ color: 'var(--color-accent)', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}
                >
                  {email}
                </a>
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleOpenMail}
                  className="btn btn-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 16px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>mail</span>
                  <span>Mail Support</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenGmail}
                  className="btn btn-secondary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-md)',
                  }}
                  title="Compose in Gmail Web"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>open_in_browser</span>
                  <span>Open in Gmail</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopy}
                  className="btn btn-secondary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-md)',
                  }}
                  title="Copy email address"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    {copied ? 'check' : 'content_copy'}
                  </span>
                  <span>{copied ? 'Copied' : 'Copy Address'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default FeedbackView;
