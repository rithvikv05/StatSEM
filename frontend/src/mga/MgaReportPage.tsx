import React, { useEffect, useState, useRef } from 'react';
import { Download } from 'lucide-react';
import AppSidebar from '../components/AppSidebar';
import { useStore } from '../store';
import type { MgaReport, PermutationReport } from './types';
import { mgaApi } from './mgaApi';
import { PermutationResultView } from './PermutationResultView';
import { MgaResultView } from './MgaResultView';

export const MgaReportPage: React.FC = () => {
  const {
    tabs,
    activeTabId,
    studies,
    workspaces,
    mgaReportCache,
    cacheMgaReport,
    openTab,
  } = useStore();

  const activeTab = tabs.find(t => t.id === activeTabId);
  const reportId = activeTab?.reportId || '';
  const activeStudy = studies.find(s => s.id === activeTab?.studyId);
  const activeWorkspace = workspaces.find(w => w.id === (activeTab?.workspaceId || activeStudy?.workspaceId));

  const cached = reportId ? mgaReportCache[reportId] : undefined;
  const [report, setReport] = useState<PermutationReport | MgaReport | null>(cached || null);
  const [loading, setLoading] = useState<boolean>(!cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cached) {
      setReport(cached);
      setLoading(false);
      return;
    }
    if (!reportId || !activeStudy?.path) {
      setLoading(false);
      setError('Report data could not be loaded.');
      return;
    }
    setLoading(true);
    setError(null);
    mgaApi
      .getReport(activeStudy.path, reportId)
      .then(res => {
        if (res.error || !res.report) {
          setError(res.error || 'Report not found in project file.');
        } else {
          cacheMgaReport(res.report);
          setReport(res.report);
        }
      })
      .catch(err => setError(err?.message || 'Failed to load report.'))
      .finally(() => setLoading(false));
  }, [reportId, activeStudy?.path, cached, cacheMgaReport]);

  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  const handleExportCsv = () => {
    const table = document.querySelector('.mga-matrix, .scientific-table, table');
    if (!table) return;
    let csv = '';
    table.querySelectorAll('tr').forEach(r => {
      const cells = r.querySelectorAll('th, td');
      const rowVals: string[] = [];
      cells.forEach(c => {
        let text = c.textContent?.trim() || '';
        if (text.includes(',') || text.includes('"')) text = `"${text.replace(/"/g, '""')}"`;
        rowVals.push(text);
      });
      csv += rowVals.join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report?.title || 'mga_report'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = async () => {
    const table = document.querySelector('.mga-matrix, .scientific-table, table');
    if (!table) return;
    try {
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('MGA Results');
      table.querySelectorAll('tr').forEach(row => {
        sheet.addRow(Array.from(row.querySelectorAll('th, td'), cell => cell.textContent?.trim() || ''));
      });
      const bytes = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${report?.title || 'mga_report'}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Could not export to Excel');
    }
  };

  const handleExportHtml = () => {
    const table = document.querySelector('.mga-matrix, .scientific-table, table');
    if (!table) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${report?.title || 'MGA Report'}</title><style>body { font-family: sans-serif; padding: 24px; } table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; } th { background: #f1f5f9; }</style></head><body><h1>${report?.title || 'MGA Report'}</h1>${table.outerHTML}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report?.title || 'mga_report'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
      <AppSidebar activeNav="workspace" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg-base)' }}>
        {/* Subheader */}
        <div className="results-subheader">
          <div className="results-subheader__breadcrumb">
            <span
              className="results-subheader__bc-link"
              onClick={() =>
                activeWorkspace &&
                openTab({ type: 'workspace', title: activeWorkspace.name, workspaceId: activeWorkspace.id })
              }
            >
              {activeWorkspace?.name || 'Workspace'}
            </span>
            <span className="results-subheader__bc-sep">/</span>
            <span
              className="results-subheader__bc-link"
              onClick={() =>
                activeWorkspace &&
                openTab({ type: 'workspace', title: activeWorkspace.name, workspaceId: activeWorkspace.id })
              }
            >
              {activeStudy?.name || 'Study'}
            </span>
            <span className="results-subheader__bc-sep">/</span>
            <span className="results-subheader__bc-current">{report?.title || activeTab?.title || 'MGA Report'}</span>
          </div>

          <div className="results-subheader__actions">
            <div className="subheader__dropdown-container" ref={exportDropdownRef}>
              <button
                className="results-tool-btn"
                type="button"
                aria-expanded={isExportMenuOpen}
                aria-haspopup="menu"
                onClick={() => setIsExportMenuOpen(prev => !prev)}
                title="Export MGA results"
              >
                <Download size={13} />
                <span>Export</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13, marginLeft: -2, transform: isExportMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {isExportMenuOpen && (
                <div className="subheader__dropdown-menu" role="menu" style={{ right: 0, left: 'auto', minWidth: 190 }}>
                  <button type="button" className="subheader__dropdown-item" role="menuitem" onClick={() => { setIsExportMenuOpen(false); handleExportCsv(); }}>Current table as CSV</button>
                  <button type="button" className="subheader__dropdown-item" role="menuitem" onClick={() => { setIsExportMenuOpen(false); void handleExportExcel(); }}>Current table as Excel</button>
                  <button type="button" className="subheader__dropdown-item" role="menuitem" onClick={() => { setIsExportMenuOpen(false); handleExportHtml(); }}>Current table as HTML</button>
                  <div style={{ height: 1, background: 'var(--color-border-subtle)', margin: '2px 0' }} />
                  <button type="button" className="subheader__dropdown-item" role="menuitem" onClick={() => { setIsExportMenuOpen(false); window.print(); }}>Print / save as PDF</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p className="results-empty-note">Loading multigroup report…</p>
          </div>
        ) : error || !report ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="results-notice results-notice--danger">{error || 'Report not found.'}</div>
          </div>
        ) : report.reportType === 'permutation' ? (
          <PermutationResultView report={report} />
        ) : (
          <MgaResultView report={report} />
        )}
      </div>
    </div>
  );
};

export default MgaReportPage;

