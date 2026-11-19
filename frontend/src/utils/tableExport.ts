import ExcelJS from 'exceljs';

export interface ExtractedTableData {
  headers: string[];
  rows: string[][];
  title?: string;
}

/** Extract the tables actually displayed for a standalone analysis. */
export function collectVisibleReportTables(container: Element | null, title: string): Array<{ title: string; headers: string[]; rows: string[][] }> {
  if (!container) return [];
  return Array.from(container.querySelectorAll('table')).filter(table => !table.closest('details:not([open])')).map((table, index, all) => {
    const section = table.closest('section');
    const heading = section?.querySelector('h2, h3, h4')?.textContent?.trim();
    const data = extractTableData(table);
    return { title: heading || (all.length === 1 ? title : `${title} ${index + 1}`), headers: data.headers, rows: data.rows };
  });
}

/**
 * Extracts clean text matrix from an HTML table element.
 */
export function extractTableData(table: HTMLTableElement | HTMLElement): ExtractedTableData {
  const headers: string[] = [];
  const rows: string[][] = [];

  // Look for direct or nested thead
  const thead = table.querySelector('thead');
  if (thead) {
    const thRows = thead.querySelectorAll('tr');
    thRows.forEach(tr => {
      const rowCells: string[] = [];
      tr.querySelectorAll('th, td').forEach(cell => {
        // Exclude interactive elements or action buttons
        if (cell.classList.contains('no-export') || cell.getAttribute('data-no-export') === 'true') return;
        rowCells.push(cleanCellText(cell));
      });
      if (rowCells.length > 0) {
        if (headers.length === 0) {
          headers.push(...rowCells);
        } else {
          // Sub-header or multi-row header: combine or treat as rows
          rows.push(rowCells);
        }
      }
    });
  }

  // Look for tbody rows
  const tbody = table.querySelector('tbody') || table;
  const trElements = tbody.querySelectorAll('tr');
  trElements.forEach(tr => {
    // If inside thead, skip (already handled)
    if (thead && thead.contains(tr)) return;

    const rowCells: string[] = [];
    tr.querySelectorAll('th, td').forEach(cell => {
      if (cell.classList.contains('no-export') || cell.getAttribute('data-no-export') === 'true') return;
      rowCells.push(cleanCellText(cell));
    });

    if (rowCells.length > 0) {
      if (headers.length === 0) {
        headers.push(...rowCells);
      } else {
        rows.push(rowCells);
      }
    }
  });

  return { headers, rows };
}

function cleanCellText(cell: Element): string {
  // Clone to avoid altering live DOM
  const clone = cell.cloneNode(true) as HTMLElement;
  // Remove interactive icons, copy buttons, etc.
  clone.querySelectorAll('button, svg, .construct-dot, [aria-hidden="true"], .no-export').forEach(el => el.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Formats table data into Tab-Separated Values (TSV) for spreadsheets (Excel, Google Sheets).
 */
export function formatTableAsTsv(data: ExtractedTableData, title?: string): string {
  const lines: string[] = [];
  if (title) {
    lines.push(title);
  }
  if (data.headers.length > 0) {
    lines.push(data.headers.map(escapeTsvCell).join('\t'));
  }
  for (const row of data.rows) {
    lines.push(row.map(escapeTsvCell).join('\t'));
  }
  return lines.join('\n');
}

function escapeTsvCell(val: string): string {
  if (val.includes('\t') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Formats table data into clean HTML table string for rich-text paste (Word, Docs).
 */
export function formatTableAsHtml(data: ExtractedTableData, title?: string): string {
  let html = `<table style="border-collapse: collapse; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; color: #1e293b;">`;
  if (title) {
    html = `<p style="font-weight: 600; font-size: 14px; margin-bottom: 6px; font-family: sans-serif; color: #0f172a;">${escapeHtml(title)}</p>` + html;
  }
  if (data.headers.length > 0) {
    html += `<thead><tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">`;
    for (const h of data.headers) {
      html += `<th style="border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; font-weight: 600;">${escapeHtml(h)}</th>`;
    }
    html += `</tr></thead>`;
  }
  html += `<tbody>`;
  data.rows.forEach((row, i) => {
    const bg = i % 2 === 1 ? '#f8fafc' : '#ffffff';
    html += `<tr style="background-color: ${bg}; border-bottom: 1px solid #e2e8f0;">`;
    row.forEach((cell, ci) => {
      const align = ci === 0 ? 'left' : 'center';
      html += `<td style="border: 1px solid #e2e8f0; padding: 6px 12px; text-align: ${align}; font-variant-numeric: tabular-nums;">${escapeHtml(cell)}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Copies a single table to clipboard with both HTML (for Word) and TSV (for Excel/Sheets).
 */
export async function copyTableToClipboard(
  tableElement: HTMLTableElement | HTMLElement | null,
  title?: string
): Promise<{ success: boolean; rowCount: number }> {
  if (!tableElement) return { success: false, rowCount: 0 };
  const data = extractTableData(tableElement);
  const tsv = formatTableAsTsv(data, title);
  const html = formatTableAsHtml(data, title);

  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
      const textBlob = new Blob([tsv], { type: 'text/plain' });
      const htmlBlob = new Blob([html], { type: 'text/html' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': textBlob,
          'text/html': htmlBlob,
        }),
      ]);
      return { success: true, rowCount: data.rows.length };
    }
  } catch (err) {
    console.warn('ClipboardItem write failed, falling back to writeText:', err);
  }

  try {
    await navigator.clipboard.writeText(tsv);
    return { success: true, rowCount: data.rows.length };
  } catch (err) {
    console.error('Copy to clipboard failed:', err);
    return { success: false, rowCount: 0 };
  }
}

/**
 * Copies all tables found inside a container (e.g. current results page).
 */
export async function copyAllTablesFromContainer(
  container: HTMLElement | null,
  pageTitle?: string
): Promise<{ success: boolean; tableCount: number; rowCount: number }> {
  if (!container) return { success: false, tableCount: 0, rowCount: 0 };

  const tables = container.querySelectorAll('table');
  if (tables.length === 0) return { success: false, tableCount: 0, rowCount: 0 };

  if (tables.length === 1) {
    const res = await copyTableToClipboard(tables[0], pageTitle);
    return { success: res.success, tableCount: 1, rowCount: res.rowCount };
  }

  const tsvSections: string[] = [];
  const htmlSections: string[] = [];
  let totalRows = 0;

  if (pageTitle) {
    tsvSections.push(`=== ${pageTitle.toUpperCase()} ===\n`);
    htmlSections.push(`<h2 style="font-family: sans-serif; font-size: 18px; margin-bottom: 12px; color: #0f172a;">${escapeHtml(pageTitle)}</h2>`);
  }

  tables.forEach((table, idx) => {
    // Try to find a nearby heading or caption
    const parent = table.closest('.scientific-table-wrap') || table.parentElement;
    let heading = '';
    const prevHeader = parent?.previousElementSibling;
    if (prevHeader && ['H3', 'H4', 'H5', 'DIV'].includes(prevHeader.tagName)) {
      heading = cleanCellText(prevHeader);
    } else {
      const parentTitle = parent?.querySelector('h3, h4, .table-title, .report-header__title');
      if (parentTitle) heading = cleanCellText(parentTitle);
    }
    const tableTitle = heading || `Table ${idx + 1}`;
    const data = extractTableData(table);
    totalRows += data.rows.length;

    tsvSections.push(formatTableAsTsv(data, tableTitle));
    htmlSections.push(formatTableAsHtml(data, tableTitle));
    htmlSections.push('<br/>');
  });

  const fullTsv = tsvSections.join('\n\n');
  const fullHtml = htmlSections.join('\n');

  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
      const textBlob = new Blob([fullTsv], { type: 'text/plain' });
      const htmlBlob = new Blob([fullHtml], { type: 'text/html' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': textBlob,
          'text/html': htmlBlob,
        }),
      ]);
      return { success: true, tableCount: tables.length, rowCount: totalRows };
    }
  } catch (err) {
    console.warn('ClipboardItem write failed for all tables, falling back to writeText:', err);
  }

  try {
    await navigator.clipboard.writeText(fullTsv);
    return { success: true, tableCount: tables.length, rowCount: totalRows };
  } catch (err) {
    console.error('Copy all tables failed:', err);
    return { success: false, tableCount: 0, rowCount: 0 };
  }
}

/**
 * Exports a table as a CSV file download.
 */
export function exportTableToCsv(
  tableElement: HTMLTableElement | HTMLElement | null,
  filename: string
): void {
  if (!tableElement) return;
  const data = extractTableData(tableElement);
  const rows = [data.headers, ...data.rows];
  const csvContent = rows
    .map(row =>
      row
        .map(cell => {
          let txt = cell;
          if (txt.includes(',') || txt.includes('"') || txt.includes('\n')) {
            txt = `"${txt.replace(/"/g, '""')}"`;
          }
          return txt;
        })
        .join(',')
    )
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports a table as an Excel (.xlsx) file download.
 */
export async function exportTableToExcel(
  tableElement: HTMLTableElement | HTMLElement | null,
  filename: string,
  sheetName: string = 'Results'
): Promise<void> {
  if (!tableElement) return;
  const data = extractTableData(tableElement);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));

  if (data.headers.length > 0) {
    const headerRow = sheet.addRow(data.headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
  }

  for (const row of data.rows) {
    sheet.addRow(row);
  }

  // Auto-fit column widths
  sheet.columns.forEach(column => {
    let maxLen = 12;
    if (column.values) {
      column.values.forEach(val => {
        if (val) {
          const len = String(val).length;
          if (len > maxLen) maxLen = Math.min(len + 3, 50);
        }
      });
    }
    column.width = maxLen;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

