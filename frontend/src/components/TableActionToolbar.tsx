import React, { useState } from 'react';
import { Copy, Check, Download, FileSpreadsheet } from 'lucide-react';
import { copyTableToClipboard, exportTableToCsv, exportTableToExcel } from '../utils/tableExport';

export interface TableActionToolbarProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  tableRef?: React.RefObject<HTMLTableElement | HTMLDivElement | null>;
  getTableElement?: () => HTMLTableElement | HTMLElement | null;
  filename?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  showCsv?: boolean;
  showExcel?: boolean;
}

export const TableActionToolbar: React.FC<TableActionToolbarProps> = ({
  title,
  subtitle,
  tableRef,
  getTableElement,
  filename = 'table_export',
  className = '',
  style,
  children,
  showCsv = true,
  showExcel = true,
}) => {
  const [copied, setCopied] = useState(false);

  const resolveTable = (): HTMLElement | null => {
    if (getTableElement) return getTableElement();
    if (tableRef && tableRef.current) {
      if (tableRef.current instanceof HTMLTableElement) return tableRef.current;
      return tableRef.current.querySelector('table');
    }
    return null;
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    let table = resolveTable();
    // Fallback: look in sibling or parent if not explicitly passed
    if (!table) {
      const parent = (e.currentTarget as HTMLElement).closest('.table-container, .scientific-table-wrap, .results-content-pane, div');
      table = parent?.querySelector('table') || document.querySelector('.scientific-table, .results-table');
    }

    if (!table) return;

    const titleStr = typeof title === 'string' ? title : undefined;
    const res = await copyTableToClipboard(table, titleStr);
    if (res.success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  const handleCsv = (e: React.MouseEvent) => {
    e.stopPropagation();
    let table = resolveTable();
    if (!table) {
      const parent = (e.currentTarget as HTMLElement).closest('.table-container, .scientific-table-wrap, .results-content-pane, div');
      table = parent?.querySelector('table') || document.querySelector('.scientific-table, .results-table');
    }
    if (table) {
      exportTableToCsv(table, filename);
    }
  };

  const handleExcel = (e: React.MouseEvent) => {
    e.stopPropagation();
    let table = resolveTable();
    if (!table) {
      const parent = (e.currentTarget as HTMLElement).closest('.table-container, .scientific-table-wrap, .results-content-pane, div');
      table = parent?.querySelector('table') || document.querySelector('.scientific-table, .results-table');
    }
    if (table) {
      void exportTableToExcel(table, filename, typeof title === 'string' ? title : 'Results');
    }
  };

  return (
    <div
      className={`table-action-toolbar ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        backgroundColor: 'var(--color-bg-raised, #f8fafc)',
        borderBottom: '1px solid var(--color-border-subtle, #e2e8f0)',
        borderTopLeftRadius: 'var(--radius-md, 8px)',
        borderTopRightRadius: 'var(--radius-md, 8px)',
        gap: '12px',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        {title && (
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--color-text-primary, #1e293b)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
        )}
        {subtitle && (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--color-text-muted, #64748b)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {subtitle}
          </div>
        )}
        {children}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <button
          type="button"
          onClick={handleCopy}
          title="Copy this table to clipboard (TSV / formatted table)"
          className="results-tool-btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '4px 10px',
            fontSize: '12px',
            fontWeight: 500,
            borderRadius: '5px',
            border: '1px solid var(--color-border-subtle, #cbd5e1)',
            backgroundColor: copied ? 'rgba(34, 197, 94, 0.12)' : 'var(--color-bg-surface, #ffffff)',
            color: copied ? '#16a34a' : 'var(--color-text-primary, #334155)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          {copied ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} />}
          <span>{copied ? 'Copied!' : 'Copy Table'}</span>
        </button>

        {showCsv && (
          <button
            type="button"
            onClick={handleCsv}
            title="Download this table as CSV"
            className="results-tool-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              fontSize: '12px',
              borderRadius: '5px',
              border: '1px solid var(--color-border-subtle, #cbd5e1)',
              backgroundColor: 'var(--color-bg-surface, #ffffff)',
              color: 'var(--color-text-secondary, #475569)',
              cursor: 'pointer',
            }}
          >
            <Download size={12} />
            <span>CSV</span>
          </button>
        )}

        {showExcel && (
          <button
            type="button"
            onClick={handleExcel}
            title="Download this table as Excel (.xlsx)"
            className="results-tool-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              fontSize: '12px',
              borderRadius: '5px',
              border: '1px solid var(--color-border-subtle, #cbd5e1)',
              backgroundColor: 'var(--color-bg-surface, #ffffff)',
              color: 'var(--color-text-secondary, #475569)',
              cursor: 'pointer',
            }}
          >
            <FileSpreadsheet size={12} />
            <span>Excel</span>
          </button>
        )}
      </div>
    </div>
  );
};

