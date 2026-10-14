import { useEffect, useMemo, useRef, useState } from 'react';
import { AiPromptPanel } from './components/AiPromptPanel';
import { ControlsPanel } from './components/ControlsPanel';
import { ExportControls, type ExportStatus } from './components/ExportControls';
import { ProjectsPanel, type ProjectsStatus } from './components/ProjectsPanel';
import { ViewerCanvas } from './components/ViewerCanvas';
import { downloadArrayBuffer } from './export/downloadFile';
import { exportTableToGlb, TABLE_EXPORT_FILENAME } from './export/tableExport';
import {
  DEFAULT_FIELD_VALUES,
  paramsToFieldValues,
  parseTableValues,
  type TableFieldValues,
  type TableParams,
} from './geometry/tableParams';
import { createLocalProjectRepository } from './projects/localProjectRepository';
import type { ProjectRepository, SavedProject } from './projects/types';
import './App.css';

export default function App() {
  const [values, setValues] = useState<TableFieldValues>(DEFAULT_FIELD_VALUES);
  const [resetToken, setResetToken] = useState(0);
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [exportMessage, setExportMessage] = useState('');

  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectsStatus, setProjectsStatus] = useState<ProjectsStatus>('idle');
  const [projectsMessage, setProjectsMessage] = useState('');

  const repositoryRef = useRef<ProjectRepository | null>(null);

  const getRepository = (): ProjectRepository => {
    if (!repositoryRef.current) {
      repositoryRef.current = createLocalProjectRepository({ storage: window.localStorage });
    }
    return repositoryRef.current;
  };

  const parsed = useMemo(() => parseTableValues(values), [values]);

  const refreshProjects = async () => {
    try {
      setProjects(await getRepository().list());
    } catch (error) {
      setProjectsStatus('error');
      setProjectsMessage("Loyihalarni yuklab bo'lmadi.");
      console.error('Loyihalarni yuklash xatosi:', error);
    }
  };

  useEffect(() => {
    void refreshProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (field: keyof TableFieldValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleReset = () => {
    setValues(DEFAULT_FIELD_VALUES);
  };

  const handleResetView = () => {
    setResetToken((token) => token + 1);
  };

  const handleApplyProposal = (params: TableParams) => {
    setValues(paramsToFieldValues(params));
  };

  const handleSaveProject = async () => {
    if (!parsed.params) {
      setProjectsStatus('error');
      setProjectsMessage("Saqlashdan oldin noto'g'ri qiymatlarni tuzating.");
      return;
    }

    try {
      const repository = getRepository();
      if (activeProjectId) {
        const updated = await repository.update(activeProjectId, {
          name: projectName,
          params: parsed.params,
        });
        if (!updated) {
          setProjectsStatus('error');
          setProjectsMessage("Loyiha topilmadi. Iltimos, ro'yxatni yangilang.");
        } else {
          setProjectsStatus('ok');
          setProjectsMessage('Loyiha yangilandi.');
        }
      } else {
        const created = await repository.create({
          name: projectName,
          params: parsed.params,
        });
        setActiveProjectId(created.id);
        setProjectName(created.name);
        setProjectsStatus('ok');
        setProjectsMessage('Loyiha saqlandi.');
      }
      await refreshProjects();
    } catch (error) {
      setProjectsStatus('error');
      setProjectsMessage("Loyihani saqlab bo'lmadi.");
      console.error('Loyihani saqlash xatosi:', error);
    }
  };

  const handleNewProject = () => {
    setActiveProjectId(null);
    setProjectName('');
    setProjectsStatus('idle');
    setProjectsMessage('Yangi loyiha. Parametrlarni sozlab, saqlang.');
  };

  const handleOpenProject = (project: SavedProject) => {
    const validated = parseTableValues(paramsToFieldValues(project.params));
    if (!validated.params) {
      setProjectsStatus('error');
      setProjectsMessage("Loyiha ma'lumotlari yaroqsiz — ochib bo'lmadi.");
      return;
    }

    setValues(paramsToFieldValues(validated.params));
    setActiveProjectId(project.id);
    setProjectName(project.name);
    setProjectsStatus('ok');
    setProjectsMessage(`"${project.name}" loyihasi ochildi.`);
  };

  const handleDeleteProject = async (project: SavedProject) => {
    const confirmed = window.confirm(`"${project.name}" loyihasi o'chirilsinmi?`);
    if (!confirmed) {
      return;
    }

    try {
      const removed = await getRepository().remove(project.id);
      if (removed) {
        if (activeProjectId === project.id) {
          setActiveProjectId(null);
          setProjectName('');
        }
        setProjectsStatus('ok');
        setProjectsMessage("Loyiha o'chirildi.");
      } else {
        setProjectsStatus('error');
        setProjectsMessage('Loyiha topilmadi.');
      }
      await refreshProjects();
    } catch (error) {
      setProjectsStatus('error');
      setProjectsMessage("Loyihani o'chirib bo'lmadi.");
      console.error("Loyihani o'chirish xatosi:", error);
    }
  };

  const handleExport = async () => {
    if (!parsed.params || exportStatus === 'exporting') {
      return;
    }

    setExportStatus('exporting');
    setExportMessage('Eksport qilinmoqda…');

    try {
      const data = await exportTableToGlb(parsed.params);
      downloadArrayBuffer(data, TABLE_EXPORT_FILENAME);
      setExportStatus('success');
      setExportMessage('Model .glb fayl sifatida yuklab olindi.');
    } catch (error) {
      setExportStatus('error');
      setExportMessage("Eksport amalga oshmadi. Iltimos, qaytadan urinib ko'ring.");
      console.error('GLB eksport xatosi:', error);
    }
  };

  return (
    <div className="app">
      <ControlsPanel
        values={values}
        errors={parsed.errors}
        onChange={handleChange}
        onReset={handleReset}
      >
        <AiPromptPanel onApply={handleApplyProposal} />
        <ProjectsPanel
          projects={projects}
          activeId={activeProjectId}
          name={projectName}
          status={projectsStatus}
          message={projectsMessage}
          onNameChange={setProjectName}
          onSave={handleSaveProject}
          onNew={handleNewProject}
          onOpen={handleOpenProject}
          onDelete={handleDeleteProject}
        />
        <ExportControls
          status={exportStatus}
          message={exportMessage}
          disabled={!parsed.valid}
          onExport={handleExport}
        />
      </ControlsPanel>

      <main className="stage">
        <ViewerCanvas params={parsed.params} resetToken={resetToken} />

        <div className="stage__toolbar">
          <button type="button" className="stage__button" onClick={handleResetView}>
            Ko'rinishni tiklash
          </button>
        </div>

        {parsed.valid && parsed.params ? (
          <div className="readout">
            {parsed.params.widthCm} × {parsed.params.depthCm} × {parsed.params.heightCm} sm
          </div>
        ) : (
          <div className="banner" role="alert">
            Ba'zi qiymatlar noto'g'ri — model oxirgi to'g'ri holatda ko'rsatilmoqda.
          </div>
        )}
      </main>
    </div>
  );
}
