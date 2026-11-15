import React, { useState } from 'react';
import AppSidebar from '../components/AppSidebar';
import WorkspaceModal from '../components/WorkspaceModal';
import { useStore, type Model, type Workspace } from '../store';
import { api } from '../utils/api';
import { processData } from '../utils/dataset-parser';
import type { ParsedDataset } from '../utils/dataset-parser';

export function SampleStudyDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { workspaces, activeWorkspaceId, addStudy, addModel, setStudyDatasets, setActiveWorkspace, setActiveStudy, openTab } = useStore();
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const install = async (workspace: Pick<Workspace, 'id' | 'name' | 'path'>) => {
    if (!workspace.path) { setError('Choose a workspace with a saved folder.'); return; }
    setBusy(true); setError('');
    let projectPath = '';
    try {
      const sample: any = (await import('../assets/service-experience.json')).default;
      const workspaceData = await api.openWorkspace(workspace.path);
      if (workspaceData.error || !workspaceData.workspace) throw new Error(workspaceData.error || 'Could not open the workspace.');
      const baseName = 'Service Experience — PLS-SEM Sample';
      const usedNames = new Set([...(workspaceData.workspace.projects || []), ...(workspaceData.workspace.archived_projects || [])].map(p => p.name.toLowerCase()));
      let name = baseName;
      for (let suffix = 2; usedNames.has(name.toLowerCase()); suffix++) name = `${baseName} (${suffix})`;
      const project = await api.addProject(workspace.path, name);
      if (project.error || !project.project_path) throw new Error(project.error || 'Could not create the sample study.');
      projectPath = project.project_path;
      const datasets: ParsedDataset[] = [];
      for (const dataset of sample.datasets) {
        const data = processData(dataset.name, dataset.columns, dataset.rows);
        data.id = dataset.id; data.dataGroups = dataset.groups;
        const saved = await api.saveProjectDataJson(projectPath, dataset.name, dataset.columns, dataset.rows, undefined, undefined, dataset.id, dataset.groups);
        if (saved.error) throw new Error(saved.error);
        datasets.push(data);
      }
      const modelNames = ['Quality and loyalty', 'Satisfaction mediation', 'Quality, value and loyalty', 'Value moderates quality', 'Formative value', 'Quadratic effect', 'Gaussian copula', 'Combined effects'];
      const modelIds = new Map<string, string>();
      const installedModels: Model[] = [];
      for (const [index, model] of sample.models.entries()) {
        const id = `model-${crypto.randomUUID()}`;
        modelIds.set(model.id, id);
        const saved = await api.saveProjectModel(projectPath, model.spec, model.layout, id);
        if (saved.error) throw new Error(saved.error);
        installedModels.push({ id, studyId: projectPath, name: `${String(index + 1).padStart(2, '0')} · ${modelNames[index] || 'Sample model'}`, type: 'PLS-SEM', datasetId: model.spec.dataset_id, lastModified: 'Just now' });
      }
      for (const snapshot of sample.snapshots) {
        const saved = await api.saveSnapshot({ projectPath, name: snapshot.name, description: snapshot.description, algorithm: snapshot.algorithm, results: snapshot.results, spec: snapshot.spec, diagramLayout: snapshot.layout, sourceModelId: modelIds.get(snapshot.sourceModelId) });
        if (saved.error) throw new Error(saved.error);
      }
      addStudy({ id: projectPath, workspaceId: workspace.id, name: project.project_name || 'Service Experience — PLS-SEM Sample', type: 'PLS-SEM', description: 'Simulated customer survey for learning model estimation, mediation, prediction, IPMA and group comparisons.', lastModified: 'Just now', path: projectPath });
      setStudyDatasets(projectPath, datasets);
      installedModels.forEach(addModel);
      setActiveWorkspace(workspace.id); setActiveStudy(projectPath);
      openTab({ type: 'workspace', title: workspace.name, workspaceId: workspace.id });
      onClose();
    } catch (err) { setError(`${err instanceof Error ? err.message : 'Could not add sample study.'}${projectPath ? ` A partially created study remains at ${projectPath}.` : ''}`); }
    finally { setBusy(false); }
  };
  return <>
    {isOpen && !creatingWorkspace && <div className="modal-overlay active" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="sample-title"><div className="modal__header"><h2 id="sample-title" className="modal__title">Add sample study</h2><button className="calculation-close" aria-label="Close" disabled={busy} onClick={onClose}>×</button></div><div className="modal__body"><p className="calculation-note">Includes simulated datasets, eight models and a saved result snapshot.</p><label className="modal__field"><span className="modal__label">Existing workspace</span><select className="modal__input" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)}><option value="">Select a workspace</option>{workspaces.filter(w => w.path).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>{error && <p role="alert" className="calculation-error">{error}</p>}</div><div className="modal__footer"><button type="button" className="modal__btn-cancel" disabled={busy} onClick={() => setCreatingWorkspace(true)}>Create workspace</button><button type="button" className="modal__btn-create" disabled={busy || !workspaces.some(w => w.id === workspaceId && w.path)} onClick={() => { const ws = workspaces.find(w => w.id === workspaceId); if (ws) void install(ws); }}>{busy ? 'Adding…' : 'Add to workspace'}</button></div></div></div>}
    <WorkspaceModal isOpen={creatingWorkspace} onClose={() => setCreatingWorkspace(false)} onCreated={install}/>
  </>;
}

export default function SamplesView() {
  const [choosing, setChoosing] = useState(false);
  return <div className="app-body"><AppSidebar activeNav="samples"/><main className="ws-main"><div className="ws-inner">
    <header className="ws-header"><div className="ws-header__left"><h1 className="ws-title-editable" style={{ cursor: 'default' }}>Sample Studies</h1></div></header>
    <div className="project-list" style={{ marginTop: 24 }}><div className="project-card"><div className="project-card__content"><div className="project-card__info"><h3 className="project-card__title">Service experience and customer loyalty</h3><p className="project-card__desc">PLS-SEM</p></div></div><button type="button" className="project-card__open-btn" onClick={() => setChoosing(true)}>Add study</button></div></div>
    <SampleStudyDialog isOpen={choosing} onClose={() => setChoosing(false)}/>
  </div></main></div>;
}
