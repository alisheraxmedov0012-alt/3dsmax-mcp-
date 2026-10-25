import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AccountPanel } from './components/AccountPanel';
import { ServerPanel } from './components/ServerPanel';
import { AssemblyPanel } from './components/AssemblyPanel';
import { JobsPanel } from './components/JobsPanel';
import { AiPromptPanel } from './components/AiPromptPanel';
import { ImageReferencePanel } from './components/ImageReferencePanel';
import { FurniturePanel } from './components/FurniturePanel';
import { ExportControls, type ExportStatus } from './components/ExportControls';
import { LightingPanel } from './components/LightingPanel';
import { MaterialPanel } from './components/MaterialPanel';
import { ManufacturingPanel } from './components/ManufacturingPanel';
import { ObjectPanel } from './components/ObjectPanel';
import { ProjectsPanel, type ProjectsStatus } from './components/ProjectsPanel';
import { RenderExportPanel, type RenderStatus } from './components/RenderExportPanel';
import { RoomPanel } from './components/RoomPanel';
import { SceneHierarchyPanel } from './components/SceneHierarchyPanel';
import { SceneSettingsPanel } from './components/SceneSettingsPanel';
import { LazyViewer } from './components/LazyViewer';
import { downloadBlob } from './export/downloadFile';
import type { SheetMaterialId } from './manufacturing/sheetMaterial';
import { exportSceneToFormat } from './export/sceneFileExport';
import { parseSceneJson } from './export/sceneJson';
import { ExportError } from './export/exportTypes';
import type { ExportFormatId } from './export/exportFormats';
import { exportScenePng, resolvePngSize, type PngPreset } from './export/sceneImage';
import {
  createFurnitureParams,
  furnitureParamsToFieldValues,
  parseFurnitureValues,
  type FurnitureParams,
  type FurnitureType,
} from './geometry/furniture';
import { createLocalProjectRepository } from './projects/localProjectRepository';
import type { ProjectRepository, SavedProject } from './projects/types';
import {
  hasUnsavedChanges,
  sceneSignature,
  shouldProtectUnload,
} from './projects/unsavedChanges';
import { findSceneObject, sceneReducer } from './scene/sceneReducer';
import { createSceneObjectId } from './scene/sceneIds';
import {
  createLayoutObjects,
  isLayoutPresetId,
  type LayoutPresetId,
} from './scene/layoutPresets';
import { findPlacementIssues, type WallId } from './scene/placement';
import { specToFurnitureParams } from './image/referenceInference';
import type { DesignSpec } from './image/designSpec';
import type { CameraPreset, LightSettings, RoomMaterialSettings } from './scene/sceneSettings';
import {
  ROOM_DEFAULTS,
  ROOM_OBJECT_ID,
  createDefaultSceneState,
  type ObjectMaterial,
  type SceneAssembly,
  type OpeningKind,
  type RoomConfig,
  type Vec3,
} from './scene/types';
import type { SceneViewer } from './viewer/SceneViewer';
import type {
  LightingPresetChoice,
  QualityPresetId,
  ToneMappingMode,
} from './render/renderPresets';
import './App.css';

export default function App() {
  const [scene, dispatch] = useReducer(
    sceneReducer,
    undefined,
    () => createDefaultSceneState(createSceneObjectId),
  );

  const [values, setValues] = useState<Record<string, string>>(() =>
    furnitureParamsToFieldValues('table', createFurnitureParams('table')),
  );
  const [resetToken, setResetToken] = useState(0);
  const [cameraPresetToken, setCameraPresetToken] = useState(0);

  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [exportFormat, setExportFormat] = useState<ExportFormatId>('glb');
  const [includeRoom, setIncludeRoom] = useState(true);
  const [exportMessage, setExportMessage] = useState('');
  const [pngPreset, setPngPreset] = useState<PngPreset>('standard');
  const [renderStatus, setRenderStatus] = useState<RenderStatus>('idle');
  const [renderMessage, setRenderMessage] = useState('');
  const [layoutPreset, setLayoutPreset] = useState<LayoutPresetId>('empty');

  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectsStatus, setProjectsStatus] = useState<ProjectsStatus>('idle');
  const [projectsMessage, setProjectsMessage] = useState('');
  // W11: unsaved-changes protection. ``savedSignature`` tracks the last scene
  // state that was persisted or loaded; anything different is unsaved work.
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const initialisedSignature = useRef(false);

  const repositoryRef = useRef<ProjectRepository | null>(null);
  const viewerRef = useRef<SceneViewer | null>(null);

  const getRepository = (): ProjectRepository => {
    if (!repositoryRef.current) {
      repositoryRef.current = createLocalProjectRepository({ storage: window.localStorage });
    }
    return repositoryRef.current;
  };

  const selectedObject = findSceneObject(scene, scene.selectedId);
  const parsed = useMemo(
    () => (selectedObject ? parseFurnitureValues(selectedObject.type, values) : null),
    [selectedObject, values],
  );
  const paramsValid = parsed ? parsed.valid : true;
  const settings = scene.data.settings;
  const placementIssues = useMemo(
    () => findPlacementIssues(scene.data.objects, scene.data.room),
    [scene.data.objects, scene.data.room],
  );
  const outsideCount = placementIssues.filter((issue) => issue.kind === 'outside').length;
  const collisionCount = placementIssues.filter((issue) => issue.kind === 'collision').length;

  const currentSignature = useMemo(
    () => sceneSignature(projectName, scene.data),
    [projectName, scene.data],
  );
  const hasUnsavedWork =
    savedSignature !== null && hasUnsavedChanges(currentSignature, savedSignature);

  // Seed the baseline once so a fresh page is not reported as unsaved work.
  useEffect(() => {
    if (!initialisedSignature.current) {
      initialisedSignature.current = true;
      setSavedSignature(currentSignature);
    }
  }, [currentSignature]);

  // Warn before the tab closes when there is unsaved work.
  useEffect(() => {
    if (!shouldProtectUnload(hasUnsavedWork, savingProject)) {
      return undefined;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedWork, savingProject]);

  const confirmDiscard = (): boolean =>
    !hasUnsavedWork ||
    window.confirm("Saqlanmagan o'zgarishlar bor. Davom etilsa, ular yo'qoladi. Davom etilsinmi?");

  // Keep the parameter controls in sync with the selected object.
  useEffect(() => {
    const object = findSceneObject(scene, scene.selectedId);
    if (object) {
      setValues(furnitureParamsToFieldValues(object.type, object.params));
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

  const handleParamsChange = (field: string, value: string) => {
    if (!selectedObject) {
      return;
    }
    const next = { ...values, [field]: value };
    setValues(next);
    const result = parseFurnitureValues(selectedObject.type, next);
    if (result.valid && result.params) {
      dispatch({ type: 'UPDATE_PARAMS', id: selectedObject.id, params: result.params });
    }
  };

  const handleParamsReset = () => {
    if (!selectedObject) {
      return;
    }
    const defaults = createFurnitureParams(selectedObject.type);
    setValues(furnitureParamsToFieldValues(selectedObject.type, defaults));
    dispatch({ type: 'UPDATE_PARAMS', id: selectedObject.id, params: defaults });
  };

  const handleAddFurniture = (type: FurnitureType) => {
    dispatch({ type: 'ADD_FURNITURE', furnitureType: type, id: createSceneObjectId() });
  };

  const handleImageReferenceConfirm = (type: FurnitureType, spec: DesignSpec) => {
    // Confirmed image-derived parameters are turned into builder parameters and
    // added exactly like a hand-created object (validated in the reducer).
    const params = specToFurnitureParams(type, spec.dimensions);
    dispatch({ type: 'ADD_FURNITURE', furnitureType: type, id: createSceneObjectId(), params });
  };

  const applyDesign = (type: FurnitureType, params: FurnitureParams) => {
    // W13: a generated design creates a NEW object. It never overwrites the
    // current selection, so an AI prompt cannot silently destroy existing work.
    dispatch({ type: 'ADD_FURNITURE', furnitureType: type, id: createSceneObjectId(), params });
    setValues(furnitureParamsToFieldValues(type, params));
  };

  const handleAddAssembly = (assembly: SceneAssembly) =>
    dispatch({ type: 'ADD_ASSEMBLY', assembly });

  const handleDeleteAssembly = (id: string) => dispatch({ type: 'DELETE_ASSEMBLY', id });

  const handleResetView = () => setResetToken((token) => token + 1);

  const handleSetRoom = (room: Partial<RoomConfig>) => dispatch({ type: 'SET_ROOM', room });
  const handleResetRoom = () => dispatch({ type: 'SET_ROOM', room: { ...ROOM_DEFAULTS } });
  const handleSelectRoom = () => dispatch({ type: 'SELECT', id: ROOM_OBJECT_ID });

  const handleToggleCeiling = (showCeiling: boolean) =>
    dispatch({ type: 'SET_ROOM_CEILING', showCeiling });

  const handleLayoutPresetChange = (preset: LayoutPresetId) => {
    if (isLayoutPresetId(preset)) {
      setLayoutPreset(preset);
    }
  };

  const handleApplyLayout = () => {
    const preset = isLayoutPresetId(layoutPreset) ? layoutPreset : 'empty';
    const objects =
      preset === 'empty'
        ? []
        : createLayoutObjects(preset, scene.data.room, createSceneObjectId);
    dispatch({ type: 'SET_LAYOUT', room: scene.data.room, objects });
  };

  const handleAddOpening = (kind: OpeningKind, wall: WallId) => {
    dispatch({
      type: 'ADD_ROOM_OPENING',
      opening: {
        id: createSceneObjectId(),
        kind,
        wall,
        offsetCm: 0,
        widthCm: kind === 'window' ? 120 : 90,
        heightCm: kind === 'window' ? 120 : 200,
        sillCm: kind === 'window' ? 90 : 0,
      },
    });
  };

  const handleRemoveOpening = (id: string) => dispatch({ type: 'REMOVE_ROOM_OPENING', id });

  const handlePlaceAgainstWall = () => {
    if (selectedObject) {
      dispatch({ type: 'PLACE_AGAINST_WALL', id: selectedObject.id });
    }
  };
  const handleAddTable = () => dispatch({ type: 'ADD_TABLE', id: createSceneObjectId() });
  const handleSelect = (id: string | null) => dispatch({ type: 'SELECT', id });

  const handleTransform = (patch: {
    position?: Partial<Vec3>;
    rotation?: Partial<Vec3>;
    scale?: Partial<Vec3>;
  }) => {
    if (selectedObject) {
      dispatch({ type: 'UPDATE_TRANSFORM', id: selectedObject.id, ...patch });
    }
  };

  const handleRename = (name: string) => {
    if (selectedObject) {
      dispatch({ type: 'RENAME_OBJECT', id: selectedObject.id, name });
    }
  };

  const handleMaterial = (patch: Partial<ObjectMaterial>) => {
    if (selectedObject) {
      dispatch({ type: 'UPDATE_MATERIAL', id: selectedObject.id, material: patch });
    }
  };

  /**
   * Manufacturing material (C3.1) is stored on the object's `sheetMaterials`,
   * next to — not instead of — the PBR `material` above. The reducer validates
   * again, so an invalid thickness cannot reach state from here either.
   */
  const handleAssignSheetMaterial = (
    partId: string,
    materialId: SheetMaterialId,
    thicknessMm: number,
  ) => {
    if (selectedObject) {
      dispatch({
        type: 'SET_SHEET_MATERIAL',
        id: selectedObject.id,
        assignment: { partId, materialId, thicknessMm },
      });
    }
  };

  const handleRemoveSheetMaterial = (partId: string) => {
    if (selectedObject) {
      dispatch({ type: 'REMOVE_SHEET_MATERIAL', id: selectedObject.id, partId });
    }
  };

  const handleResetMaterial = () => {
    if (selectedObject) {
      dispatch({ type: 'RESET_MATERIAL', id: selectedObject.id });
    }
  };

  const handleApplyMaterialPreset = (presetId: string) => {
    if (selectedObject) {
      dispatch({ type: 'APPLY_MATERIAL_PRESET', id: selectedObject.id, presetId });
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

  const handleLightingPreset = (preset: LightingPresetChoice) => {
    if (preset === 'custom') {
      return;
    }
    dispatch({ type: 'APPLY_LIGHTING_PRESET', preset });
  };
  const handleExposure = (exposure: number) => dispatch({ type: 'SET_EXPOSURE', exposure });
  const handleToneMapping = (toneMapping: ToneMappingMode) =>
    dispatch({ type: 'SET_TONE_MAPPING', toneMapping });
  const handleQuality = (quality: QualityPresetId) =>
    dispatch({ type: 'SET_RENDER_QUALITY', quality });

  const handleSaveProject = async () => {
    if (savingProject) {
      return; // guard against a double click
    }
    setSavingProject(true);
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
          setSavedSignature(sceneSignature(projectName, scene.data));
        }
      } else {
        const created = await repository.create({ name: projectName, scene: scene.data });
        setActiveProjectId(created.id);
        setProjectName(created.name);
        setProjectsStatus('ok');
        setProjectsMessage('Loyiha saqlandi.');
        setSavedSignature(sceneSignature(created.name, scene.data));
      }
      await refreshProjects();
    } catch (error) {
      setProjectsStatus('error');
      setProjectsMessage("Loyihani saqlab bo'lmadi.");
      console.error('Loyihani saqlash xatosi:', error);
    } finally {
      setSavingProject(false);
    }
  };

  const handleNewProject = () => {
    if (!confirmDiscard()) {
      return;
    }
    const fresh = createDefaultSceneState(createSceneObjectId);
    dispatch({ type: 'NEW_SCENE', id: createSceneObjectId() });
    setValues(furnitureParamsToFieldValues('table', createFurnitureParams('table')));
    setActiveProjectId(null);
    setProjectName('');
    setSavedSignature(sceneSignature('', fresh.data));
    setProjectsStatus('idle');
    setProjectsMessage('Yangi loyiha. Xona, yorug\u2019lik va obyektlarni sozlab, saqlang.');
  };

  const handleOpenProject = (project: SavedProject) => {
    if (!confirmDiscard()) {
      return;
    }
    dispatch({ type: 'LOAD_SCENE', scene: project.scene });
    const first = project.scene.objects[0];
    setValues(
      first
        ? furnitureParamsToFieldValues(first.type, first.params)
        : furnitureParamsToFieldValues('table', createFurnitureParams('table')),
    );
    setActiveProjectId(project.id);
    setProjectName(project.name);
    setSavedSignature(sceneSignature(project.name, project.scene));
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

  const handleExportFile = async () => {
    if (exportStatus === 'exporting') {
      return;
    }

    setExportStatus('exporting');
    setExportMessage('Eksport qilinmoqda…');

    const metadata = {
      name: projectName.trim() !== '' ? projectName : '3d-studio-ai',
      furnitureType: selectedObject?.type ?? scene.data.objects[0]?.type ?? null,
      units: 'cm' as const,
    };

    try {
      const artifact = await exportSceneToFormat(exportFormat, scene.data, metadata, {
        includeRoom,
      });
      downloadBlob(artifact.blob, artifact.filename);
      setExportStatus('success');
      setExportMessage(`Sahna "${artifact.filename}" sifatida yuklab olindi.`);
    } catch (error) {
      setExportStatus('error');
      setExportMessage(
        error instanceof ExportError ? error.message : "Eksport amalga oshmadi.",
      );
      console.error('Eksport xatosi:', error);
    }
  };

  const handleImportJson = async (file: File) => {
    if (exportStatus === 'exporting') {
      return;
    }
    if (!confirmDiscard()) {
      return;
    }
    setExportStatus('exporting');
    setExportMessage('JSON tekshirilmoqda…');

    try {
      const text = await file.text();
      const result = parseSceneJson(text);
      if (!result.ok) {
        // Import failure leaves the current scene untouched.
        setExportStatus('error');
        setExportMessage(result.message);
        return;
      }

      const label = `${result.name} (${result.scene.objects.length} obyekt)`;
      if (!window.confirm(`"${label}" joriy sahna ustidan yuklansinmi?`)) {
        setExportStatus('idle');
        setExportMessage('');
        return;
      }

      dispatch({ type: 'LOAD_SCENE', scene: result.scene });
      setActiveProjectId(null);
      setProjectName(result.name);
      setSavedSignature(sceneSignature(result.name, result.scene));
      setExportStatus('success');
      setExportMessage(
        result.droppedObjects > 0
          ? `Import qilindi; ${result.droppedObjects} yaroqsiz obyekt o'tkazib yuborildi.`
          : 'JSON loyiha import qilindi.',
      );
    } catch (error) {
      setExportStatus('error');
      setExportMessage("Faylni o'qib bo'lmadi.");
      console.error('JSON import xatosi:', error);
    }
  };

  /**
   * C8: hand the live 3D view to the product panel. Returns null rather than
   * throwing when the renderer is not ready, so the panel can say so instead of
   * showing a broken image.
   */
  const handleCapturePreview = async (preset: PngPreset): Promise<Blob | null> => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return null;
    }
    const size = resolvePngSize(preset);
    return viewer.capturePng(size.width, size.height);
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
      <FurniturePanel
        object={selectedObject}
        values={values}
        errors={parsed?.errors ?? {}}
        onChange={handleParamsChange}
        onReset={handleParamsReset}
        onAdd={handleAddFurniture}
      >
        <RoomPanel
          room={scene.data.room}
          isRoomSelected={scene.selectedId === ROOM_OBJECT_ID}
          layoutPreset={layoutPreset}
          onApply={handleSetRoom}
          onResetRoom={handleResetRoom}
          onSelectRoom={handleSelectRoom}
          onToggleCeiling={handleToggleCeiling}
          onLayoutPresetChange={handleLayoutPresetChange}
          onApplyLayout={handleApplyLayout}
          onAddOpening={handleAddOpening}
          onRemoveOpening={handleRemoveOpening}
        />
        <SceneSettingsPanel
          background={settings.background}
          cameraPreset={settings.cameraPreset}
          roomMaterials={settings.roomMaterials}
          lightingPreset={settings.lightingPreset}
          exposure={settings.exposure}
          toneMapping={settings.toneMapping}
          onBackground={handleBackground}
          onCameraPreset={handleCameraPreset}
          onRoomMaterials={handleRoomMaterials}
          onLightingPreset={handleLightingPreset}
          onExposure={handleExposure}
          onToneMapping={handleToneMapping}
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
          object={selectedObject}
          onTransform={handleTransform}
          onRename={handleRename}
          onToggleVisibility={() => selectedObject && handleToggleVisibility(selectedObject.id)}
          onDelete={() => selectedObject && handleDeleteObject(selectedObject.id)}
          onPlaceAgainstWall={handlePlaceAgainstWall}
        />
        <MaterialPanel
          object={selectedObject}
          onMaterial={handleMaterial}
          onApplyPreset={handleApplyMaterialPreset}
          onReset={handleResetMaterial}
        />
        <AiPromptPanel onApply={applyDesign} />
        <ImageReferencePanel onConfirm={handleImageReferenceConfirm} />
        <ManufacturingPanel
          object={selectedObject}
          projectName={projectName}
          scene={scene.data}
          onAssignSheetMaterial={handleAssignSheetMaterial}
          onRemoveSheetMaterial={handleRemoveSheetMaterial}
          onCapturePreview={handleCapturePreview}
        />
        <AccountPanel />
        <ServerPanel />
        <AssemblyPanel
          assemblies={scene.data.assemblies ?? []}
          onAdd={handleAddAssembly}
          onDelete={handleDeleteAssembly}
        />
        <JobsPanel />
        <ProjectsPanel
          projects={projects}
          activeId={activeProjectId}
          name={projectName}
          status={projectsStatus}
          message={projectsMessage}
          saving={savingProject}
          unsaved={hasUnsavedWork}
          onNameChange={setProjectName}
          onSave={handleSaveProject}
          onNew={handleNewProject}
          onOpen={handleOpenProject}
          onDelete={handleDeleteProject}
        />
        <ExportControls
          format={exportFormat}
          includeRoom={includeRoom}
          status={exportStatus}
          message={exportMessage}
          disabled={!paramsValid}
          onFormatChange={setExportFormat}
          onIncludeRoomChange={setIncludeRoom}
          onExport={handleExportFile}
          onImportFile={handleImportJson}
        />
        <RenderExportPanel
          preset={pngPreset}
          quality={settings.qualityPreset}
          status={renderStatus}
          message={renderMessage}
          disabled={false}
          onPresetChange={setPngPreset}
          onQualityChange={handleQuality}
          onExport={handleExportPng}
        />
      </FurniturePanel>

      <main className="stage">
        {/* C8.2: three.js loads behind a lazy boundary so the shell paints first
            and a failed chunk request shows a retry instead of a blank stage. */}
        <LazyViewer
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

        {!paramsValid && (
          <div className="banner" role="alert">
            Mebel qiymatlari noto&apos;g&apos;ri — model oxirgi to&apos;g&apos;ri holatda ko&apos;rsatilmoqda.
          </div>
        )}

        {(outsideCount > 0 || collisionCount > 0) && (
          <div className="banner" role="status" aria-live="polite">
            Joylashuv ogohlantirishi:
            {outsideCount > 0 && ` ${outsideCount} obyekt xona tashqarisida`}
            {outsideCount > 0 && collisionCount > 0 && ' ·'}
            {collisionCount > 0 && ` ${collisionCount} to'qnashuv`}
            . Obyektni tanlab, «Devorga joylash» yoki joylashuvni qo&apos;lda to&apos;g&apos;rilang.
          </div>
        )}
      </main>
    </div>
  );
}
