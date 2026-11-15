import React, { useEffect, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { Check, Copy, Download } from 'lucide-react';
import { formatNumber, type DecimalSystem } from '../utils/number-format';

export interface ExportTablePayload {
  sheetName: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: Array<Array<string | number | boolean | null | undefined>>;
}

export function fmt3(val: unknown, decimalSystem: DecimalSystem = 'point'): string {
  return formatNumber(val, 3, decimalSystem);
}

function rawCellString(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : '';
  }
  return String(val);
}

function escapeCsvCell(text: string): string {
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeSheetName(name: string): string {
  // Excel sheet names max 31 chars, cannot contain \ / ? * [ ] :
  const cleaned = name.replace(/[\\/?*[\]:]/g, '-').trim();
  return (cleaned || 'Results').slice(0, 31);
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function copyTableTsv(payload: ExportTablePayload): Promise<void> {
  const lines = [
    payload.headers.join('\t'),
    ...payload.rows.map(row => row.map(c => rawCellString(c).replace(/\t|\r|\n/g, ' ')).join('\t')),
  ];
  await navigator.clipboard.writeText(lines.join('\n') + '\n');
}

export function exportTableCsv(payload: ExportTablePayload): void {
  const lines = [
    payload.headers.map(escapeCsvCell).join(','),
    ...payload.rows.map(row => row.map(c => escapeCsvCell(rawCellString(c))).join(',')),
  ];
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8;' });
  triggerBlobDownload(blob, `${safeFileName(payload.sheetName)}.csv`);
}

export async function exportTableXlsx(payload: ExportTablePayload): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sanitizeSheetName(payload.sheetName));

  const headerRow = ws.addRow(payload.headers);
  headerRow.font = { bold: true };
  headerRow.eachCell(cell => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF1F5F9' },
    };
  });

  for (const row of payload.rows) {
    const excelRow = row.map(c => {
      if (c === null || c === undefined) return '';
      if (typeof c === 'number') return Number.isFinite(c) ? c : '';
      return c;
    });
    ws.addRow(excelRow);
  }

  ws.columns.forEach((col, i) => {
    const headerLen = (payload.headers[i] || '').length;
    col.width = Math.min(42, Math.max(14, headerLen + 4));
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerBlobDownload(blob, `${safeFileName(payload.sheetName)}.xlsx`);
}

export function exportTableHtml(payload: ExportTablePayload): void {
  const ths = payload.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const trs = payload.rows
    .map(
      row =>
        `<tr>${row
          .map(c => `<td>${escapeHtml(rawCellString(c))}</td>`)
          .join('')}</tr>`
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(payload.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 32px; color: #0f172a; }
    h1 { font-size: 18px; margin: 0 0 6px; }
    p { font-size: 12.5px; color: #64748b; margin: 0 0 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
    th { background: #f8fafc; font-weight: 600; }
    tr:nth-child(even) { background: #f8fafc; }
    td:not(:first-child) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <h1>${escapeHtml(payload.title)}</h1>
  ${payload.subtitle ? `<p>${escapeHtml(payload.subtitle)}</p>` : ''}
  <table>
    <thead><tr>${ths}</tr></thead>
    <tbody>${trs}</tbody>
  </table>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  triggerBlobDownload(blob, `${safeFileName(payload.sheetName)}.html`);
}

interface TableExportBarProps {
  payload: ExportTablePayload;
  compact?: boolean;
}

export const TableExportBar: React.FC<TableExportBarProps> = ({ payload, compact = false }) => {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [menuOpen]);

  const handleCopy = async () => {
    try {
      await copyTableTsv(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard denial
    }
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
      <button
        type="button"
        className="results-tool-btn"
        onClick={handleCopy}
        title="Copy to clipboard (tab-separated, full precision)"
        style={compact ? { padding: '4px 8px', fontSize: '11.5px' } : undefined}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <div className="subheader__dropdown-container" ref={menuRef}>
        <button
          type="button"
          className="results-tool-btn"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen(prev => !prev)}
          style={compact ? { padding: '4px 8px', fontSize: '11.5px' } : undefined}
        >
          <Download size={13} />
          <span>Export</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13, marginLeft: -2, transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        {menuOpen && (
          <div className="subheader__dropdown-menu" role="menu" style={{ minWidth: 165 }}>
            <button
              type="button"
              className="subheader__dropdown-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); exportTableCsv(payload); }}
            >
              Table as CSV
            </button>
            <button
              type="button"
              className="subheader__dropdown-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); void exportTableXlsx(payload); }}
            >
              Table as Excel (.xlsx)
            </button>
            <button
              type="button"
              className="subheader__dropdown-item"
              role="menuitem"
              onClick={() => { setMenuOpen(false); exportTableHtml(payload); }}
            >
              Table as HTML
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

