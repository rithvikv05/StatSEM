import React, { useEffect, useState } from 'react';
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

