import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AccountPanel } from './components/AccountPanel';
import { AiPromptPanel } from './components/AiPromptPanel';
import { ControlsPanel } from './components/ControlsPanel';
import { ExportControls, type ExportStatus } from './components/ExportControls';
import { LightingPanel } from './components/LightingPanel';
import { MaterialPanel } from './components/MaterialPanel';
import { ObjectPanel } from './components/ObjectPanel';
import { ProjectsPanel, type ProjectsStatus } from './components/ProjectsPanel';
import { RenderExportPanel, type RenderStatus } from './components/RenderExportPanel';
import { RoomPanel } from './components/RoomPanel';
import { SceneHierarchyPanel } from './components/SceneHierarchyPanel';
import { SceneSettingsPanel } from './components/SceneSettingsPanel';
import { ViewerCanvas } from './components/ViewerCanvas';
import { downloadArrayBuffer, downloadBlob } from './export/downloadFile';
import { exportSceneToGlb, SCENE_EXPORT_FILENAME } from './export/sceneExport';
import { exportScenePng, type PngPreset } from './export/sceneImage';
import {
  DEFAULT_FIELD_VALUES,
  paramsToFieldValues,
  parseTableValues,
  TABLE_DEFAULTS,
  type TableFieldValues,
  type TableParams,
} from './geometry/tableParams';
import { createLocalProjectRepository } from './projects/localProjectRepository';
import type { ProjectRepository, SavedProject } from './projects/types';
import { findSceneObject, sceneReducer } from './scene/sceneReducer';
import { createSceneObjectId } from './scene/sceneIds';
import type { CameraPreset, LightSettings, RoomMaterialSettings } from './scene/sceneSettings';
import {
  ROOM_DEFAULTS,
  ROOM_OBJECT_ID,
  createDefaultSceneState,
  type ObjectMaterial,
  type RoomConfig,
  type Vec3,
} from './scene/types';
import type { SceneViewer } from './viewer/SceneViewer';
import './App.css';

export default function App() {
  const [scene, dispatch] = useReducer(
    sceneReducer,
    undefined,
    () => createDefaultSceneState(createSceneObjectId),
  );

  const [values, setValues] = useState<TableFieldValues>(DEFAULT_FIELD_VALUES);
  const [resetToken, setResetToken] = useState(0);
  const [cameraPresetToken, setCameraPresetToken] = useState(0);

  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [exportMessage, setExportMessage] = useState('');
  const [pngPreset, setPngPreset] = useState<PngPreset>('standard');
  const [renderStatus, setRenderStatus] = useState<RenderStatus>('idle');
  const [renderMessage, setRenderMessage] = useState('');

  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectsStatus, setProjectsStatus] = useState<ProjectsStatus>('idle');
  const [projectsMessage, setProjectsMessage] = useState('');

  const repositoryRef = useRef<ProjectRepository | null>(null);
  const viewerRef = useRef<SceneViewer | null>(null);

  const getRepository = (): ProjectRepository => {
    if (!repositoryRef.current) {
      repositoryRef.current = createLocalProjectRepository({ storage: window.localStorage });
    }
    return repositoryRef.current;
  };

  const selectedObject = findSceneObject(scene, scene.selectedId);
  const selectedTable = selectedObject && selectedObject.type === 'table' ? selectedObject : null;
  const parsed = useMemo(() => parseTableValues(values), [values]);
  const settings = scene.data.settings;

  // Keep the table parameter controls in sync with the selected table.
  useEffect(() => {
    const table = findSceneObject(scene, scene.selectedId);
    if (table && table.type === 'table') {
      setValues(paramsToFieldValues(table.params));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.selectedId]);

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

  const handleTableChange = (field: keyof TableFieldValues, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    const result = parseTableValues(next);
    if (result.params && selectedTable) {
      dispatch({ type: 'UPDATE_PARAMS', id: selectedTable.id, params: result.params });
    }
  };

  const handleTableReset = () => {
    setValues(DEFAULT_FIELD_VALUES);
    if (selectedTable) {
      dispatch({ type: 'UPDATE_PARAMS', id: selectedTable.id, params: { ...TABLE_DEFAULTS } });
    }
  };

  const applyProposal = (params: TableParams) => {
    setValues(paramsToFieldValues(params));
    if (selectedTable) {
      dispatch({ type: 'UPDATE_PARAMS', id: selectedTable.id, params });
    }
  };

  const handleResetView = () => setResetToken((token) => token + 1);

  const handleSetRoom = (room: Partial<RoomConfig>) => dispatch({ type: 'SET_ROOM', room });
  const handleResetRoom = () => dispatch({ type: 'SET_ROOM', room: { ...ROOM_DEFAULTS } });
  const handleSelectRoom = () => dispatch({ type: 'SELECT', id: ROOM_OBJECT_ID });
  const handleAddTable = () => dispatch({ type: 'ADD_TABLE', id: createSceneObjectId() });
  const handleSelect = (id: string | null) => dispatch({ type: 'SELECT', id });

  const handleTransform = (patch: {
    position?: Partial<Vec3>;
    rotation?: Partial<Vec3>;
    scale?: Partial<Vec3>;
  }) => {
    if (selectedTable) {
      dispatch({ type: 'UPDATE_TRANSFORM', id: selectedTable.id, ...patch });
    }
  };

  const handleRename = (name: string) => {
    if (selectedTable) {
      dispatch({ type: 'RENAME_OBJECT', id: selectedTable.id, name });
    }
  };

  const handleMaterial = (patch: Partial<ObjectMaterial>) => {
    if (selectedTable) {
      dispatch({ type: 'UPDATE_MATERIAL', id: selectedTable.id, material: patch });
    }
  };

  const handleResetMaterial = () => {
    if (selectedTable) {
      dispatch({ type: 'RESET_MATERIAL', id: selectedTable.id });
    }
  };

  const handleToggleVisibility = (id: string) => dispatch({ type: 'TOGGLE_VISIBILITY', id });

  const handleDeleteObject = (id: string) => {
    const object = scene.data.objects.find((item) => item.id === id);
    const label = object?.name ?? 'Obyekt';
    if (!window.confirm(`"${label}" o'chirilsinmi?`)) {
      return;
    }
    dispatch({ type: 'DELETE_OBJECT', id });
  };

  const handleBackground = (color: string) => dispatch({ type: 'SET_BACKGROUND', color });
  const handleLights = (lights: Partial<LightSettings>) =>
    dispatch({ type: 'UPDATE_LIGHTS', lights });
  const handleResetLights = () => dispatch({ type: 'RESET_LIGHTS' });
  const handleRoomMaterials = (patch: Partial<RoomMaterialSettings>) =>
    dispatch({
      type: 'UPDATE_ROOM_MATERIALS',
      floorColor: patch.floorColor,
      wallColor: patch.wallColor,
    });
  const handleCameraPreset = (preset: CameraPreset) => {
    dispatch({ type: 'SET_CAMERA_PRESET', preset });
    setCameraPresetToken((token) => token + 1);
  };

  const handleSaveProject = async () => {
    try {
      const repository = getRepository();
      if (activeProjectId) {
        const updated = await repository.update(activeProjectId, {
          name: projectName,
          scene: scene.data,
        });
        if (!updated) {
          setProjectsStatus('error');
          setProjectsMessage("Loyiha topilmadi. Iltimos, ro'yxatni yangilang.");
        } else {
          setProjectsStatus('ok');
          setProjectsMessage('Loyiha yangilandi.');
        }
      } else {
        const created = await repository.create({ name: projectName, scene: scene.data });
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
    dispatch({ type: 'NEW_SCENE', id: createSceneObjectId() });
    setValues(DEFAULT_FIELD_VALUES);
    setActiveProjectId(null);
    setProjectName('');
    setProjectsStatus('idle');
    setProjectsMessage('Yangi loyiha. Xona, yorug\u2019lik va obyektlarni sozlab, saqlang.');
  };

  const handleOpenProject = (project: SavedProject) => {
    dispatch({ type: 'LOAD_SCENE', scene: project.scene });
    const firstTable = project.scene.objects.find((object) => object.type === 'table');
    setValues(firstTable ? paramsToFieldValues(firstTable.params) : DEFAULT_FIELD_VALUES);
    setActiveProjectId(project.id);
    setProjectName(project.name);
    setProjectsStatus('ok');
    setProjectsMessage(`"${project.name}" loyihasi ochildi.`);
  };

  const handleDeleteProject = async (project: SavedProject) => {
    if (!window.confirm(`"${project.name}" loyihasi o'chirilsinmi?`)) {
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

  const handleExportGlb = async () => {
    if (exportStatus === 'exporting') {
      return;
    }

    setExportStatus('exporting');
    setExportMessage('Eksport qilinmoqda…');

    try {
      const data = await exportSceneToGlb(scene.data);
      downloadArrayBuffer(data, SCENE_EXPORT_FILENAME);
      setExportStatus('success');
      setExportMessage('Sahna .glb fayl sifatida yuklab olindi.');
    } catch (error) {
      setExportStatus('error');
      setExportMessage("Eksport amalga oshmadi. Iltimos, qaytadan urinib ko'ring.");
      console.error('GLB eksport xatosi:', error);
    }
  };

  const handleExportPng = async () => {
    if (renderStatus === 'working') {
      return;
    }

    const viewer = viewerRef.current;
    if (!viewer) {
      setRenderStatus('error');
      setRenderMessage("3D ko'rinish hali tayyor emas. Birozdan so'ng urinib ko'ring.");
      return;
    }

    setRenderStatus('working');
    setRenderMessage('Render qilinmoqda…');

    try {
      const result = await exportScenePng(pngPreset, {
        capture: (size) => viewer.capturePng(size.width, size.height),
        download: (blob, filename) => downloadBlob(blob, filename),
      });
      setRenderStatus('success');
      setRenderMessage(
        `PNG saqlandi (${result.size.width}×${result.size.height}, ${Math.round(result.bytes / 1024)} KB).`,
      );
    } catch (error) {
      setRenderStatus('error');
      setRenderMessage("Render amalga oshmadi. Iltimos, qaytadan urinib ko'ring.");
      console.error('PNG eksport xatosi:', error);
    }
  };

  return (
    <div className="app">
      <ControlsPanel
        values={values}
        errors={parsed.errors}
        onChange={handleTableChange}
        onReset={handleTableReset}
        tableSelected={selectedTable !== null}
      >
        <RoomPanel
          room={scene.data.room}
          isRoomSelected={scene.selectedId === ROOM_OBJECT_ID}
          onApply={handleSetRoom}
          onResetRoom={handleResetRoom}
          onSelectRoom={handleSelectRoom}
        />
        <SceneSettingsPanel
          background={settings.background}
          cameraPreset={settings.cameraPreset}
          roomMaterials={settings.roomMaterials}
          onBackground={handleBackground}
          onCameraPreset={handleCameraPreset}
          onRoomMaterials={handleRoomMaterials}
        />
        <LightingPanel
          lights={settings.lights}
          onUpdate={handleLights}
          onReset={handleResetLights}
        />
        <SceneHierarchyPanel
          room={scene.data.room}
          objects={scene.data.objects}
          selectedId={scene.selectedId}
          onSelect={handleSelect}
          onToggleVisibility={handleToggleVisibility}
          onDelete={handleDeleteObject}
          onAddTable={handleAddTable}
        />
        <ObjectPanel
          object={selectedTable}
          onTransform={handleTransform}
          onRename={handleRename}
          onToggleVisibility={() => selectedTable && handleToggleVisibility(selectedTable.id)}
          onDelete={() => selectedTable && handleDeleteObject(selectedTable.id)}
        />
        <MaterialPanel
          object={selectedTable}
          onMaterial={handleMaterial}
          onReset={handleResetMaterial}
        />
        <AiPromptPanel onApply={applyProposal} />
        <AccountPanel />
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
          onExport={handleExportGlb}
        />
        <RenderExportPanel
          preset={pngPreset}
          status={renderStatus}
          message={renderMessage}
          disabled={false}
          onPresetChange={setPngPreset}
          onExport={handleExportPng}
        />
      </ControlsPanel>

      <main className="stage">
        <ViewerCanvas
          scene={scene.data}
          selectedId={scene.selectedId}
          resetToken={resetToken}
          cameraPreset={settings.cameraPreset}
          cameraPresetToken={cameraPresetToken}
          onSelect={handleSelect}
          onReady={(viewer) => {
            viewerRef.current = viewer;
          }}
        />

        <div className="stage__toolbar">
          <button type="button" className="stage__button" onClick={handleResetView}>
            Ko'rinishni tiklash
          </button>
        </div>

        <div className="readout">
          Xona: {scene.data.room.widthCm} × {scene.data.room.lengthCm} ×{' '}
          {scene.data.room.heightCm} sm · {scene.data.objects.length} obyekt
        </div>

        {!parsed.valid && (
          <div className="banner" role="alert">
            Stol qiymatlari noto'g'ri — model oxirgi to'g'ri holatda ko'rsatilmoqda.
          </div>
        )}
      </main>
    </div>
  );
}
