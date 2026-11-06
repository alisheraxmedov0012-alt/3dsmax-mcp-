import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BACKEND_CONFIGURED } from './api/client';
import { AccountPanel } from './components/AccountPanel';
import { ServerPanel } from './components/ServerPanel';
import { AssemblyPanel } from './components/AssemblyPanel';
import { JobsPanel } from './components/JobsPanel';
import { AiPromptPanel } from './components/AiPromptPanel';
import { ImageReferencePanel } from './components/ImageReferencePanel';
import { FurniturePanel } from './components/FurniturePanel';
import { ExportControls, type ExportStatus } from './components/ExportControls';
import { ImportPanel } from './components/ImportPanel';
import { LightingPanel } from './components/LightingPanel';
import { MaterialPanel } from './components/MaterialPanel';
import { LazyManufacturingPanel } from './components/LazyManufacturingPanel';
import { AiBudgetPanel } from './components/AiBudgetPanel';
import { AiEditPanel } from './components/AiEditPanel';
import { AiFurniturePanel } from './components/AiFurniturePanel';
import { ConfiguratorPanel } from './components/ConfiguratorPanel';
import { ObjectPanel } from './components/ObjectPanel';
import { ProjectsPanel, type ProjectsStatus } from './components/ProjectsPanel';
import { RenderExportPanel, type RenderProgress, type RenderStatus } from './components/RenderExportPanel';
import { PrintReadinessPanel } from './components/PrintReadinessPanel';
import { RoomPanel } from './components/RoomPanel';
import { SceneHierarchyPanel } from './components/SceneHierarchyPanel';
import { SceneSettingsPanel } from './components/SceneSettingsPanel';
import { LazyViewer } from './components/LazyViewer';
import { downloadBlob } from './export/downloadFile';
import type { SheetMaterialId } from './manufacturing/sheetMaterial';
import type { HardwareItem } from './manufacturing/hardware';
import { exportSceneToFormat } from './export/sceneFileExport';
import { parseSceneJson } from './export/sceneJson';
import type { ParsedImport } from './import/parseModel';
import { importedModelStore } from './import/importedModelStore';
import { ExportError } from './export/exportTypes';
import type { ExportFormatId } from './export/exportFormats';
import { preflightExportScene } from './export/quality/preflight';
import {
  DEFAULT_QUALITY_PROFILE_ID,
  createCustomProfile,
  resolveQualityProfile,
} from './export/quality/profiles';
import type {
  BudgetSeverity,
  QualityLimitsOverride,
  QualityPreflightResult,
  QualityProfileId,
} from './export/quality/types';
import { exportScenePng, renderPngFilename, resolvePngSize, type PngPreset } from './export/sceneImage';
import { RenderBatchError, exportRenderBatch } from './export/renderBatch';
import { describeCaptureError } from './viewer/captureErrors';
import {
  createFurnitureParams,
  furnitureParamsToFieldValues,
  parseFurnitureValues,
  type FurnitureParams,
  type FurnitureType,
} from './geometry/furniture';
import { createLocalProjectRepository } from './projects/localProjectRepository';
import { isStorageQuotaError } from './projects/storageErrors';
import type { ProjectRepository, SavedProject } from './projects/types';
import {
  hasUnsavedChanges,
  sceneSignature,
  shouldProtectUnload,
} from './projects/unsavedChanges';
import { findSceneObject, sceneReducer } from './scene/sceneReducer';
import { sceneForPersistence } from './scene/persistence';
import { validateSceneObject } from './scene/sceneValidation';
import { createSceneObjectId } from './scene/sceneIds';
import {
  createLayoutObjects,
  isLayoutPresetId,
  type LayoutPresetId,
} from './scene/layoutPresets';
import { findPlacementIssues, type WallId } from './scene/placement';
import {
  isPreviewApplicable,
  previewCaptureBlockReason,
  previewScene,
  type SpecPreview,
} from './scene/preview';
import { specToFurnitureParams } from './image/referenceInference';
import type { DesignSpec } from './image/designSpec';
import type { CameraPreset, LightSettings, RoomMaterialSettings } from './scene/sceneSettings';
import {
  ROOM_DEFAULTS,
  ROOM_OBJECT_ID,
  createDefaultSceneState,
  createImportedSceneObject,
  isFurnitureSceneObject,
  type ObjectMaterial,
  type SceneAssembly,
  type OpeningKind,
  type RoomConfig,
  type SceneSpec,
  type Vec3,
} from './scene/types';
import type { SceneViewer } from './viewer/SceneViewer';
import type { CameraAngleId } from './viewer/cameraAngles';
import type { MaterialPresetId } from './materials/types';
import type { TextureAssetRef, TextureMapRole } from './materials/asset';
import type {
  LightingPresetChoice,
  QualityPresetId,
  ToneMappingMode,
} from './render/renderPresets';
import './App.css';

/**
 * A batch failure wraps the per-frame failure; surface the frame and the typed
 * capture reason rather than a generic "export failed".
 */
function batchRenderErrorMessage(error: unknown): string {
  if (error instanceof RenderBatchError) {
    if (error.cause) {
      const frame = error.view ? `${error.view.label}: ` : '';
      return `${frame}${describeCaptureError(error.cause)}`;
    }
    return error.message;
  }
  return describeCaptureError(error);
}

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
  const [cameraAngle, setCameraAngle] = useState<CameraAngleId | null>(null);

  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [exportFormat, setExportFormat] = useState<ExportFormatId>('glb');
  const [includeRoom, setIncludeRoom] = useState(true);
  /** Print formats default to the selected product; the room is always excluded. */
  const [printSelectedOnly, setPrintSelectedOnly] = useState(true);
  const [exportTextureSize, setExportTextureSize] = useState<128 | 512>(128);
  const [exportMessage, setExportMessage] = useState('');
  const [qualityProfileId, setQualityProfileId] = useState<QualityProfileId>(
    DEFAULT_QUALITY_PROFILE_ID,
  );
  const [customQualityLimits, setCustomQualityLimits] = useState<QualityLimitsOverride>({});
  const [customQualitySeverity, setCustomQualitySeverity] =
    useState<BudgetSeverity>('WARNING');
  const [qualityPreflight, setQualityPreflight] = useState<QualityPreflightResult | null>(null);
  const [qualityPreflightStatus, setQualityPreflightStatus] = useState<'idle' | 'running'>(
    'idle',
  );
  const [qualityMessage, setQualityMessage] = useState('');
  const [pngPreset, setPngPreset] = useState<PngPreset>('standard');
  const [pngTransparent, setPngTransparent] = useState(false);
  const [transparentAvailable, setTransparentAvailable] = useState(true);
  const [batchProgress, setBatchProgress] = useState<RenderProgress | null>(null);
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
  /** Cached alpha-capability result for the current viewer instance. */
  const transparentProbeRef = useRef<boolean | null>(null);
  /** Synchronous guard: React state alone cannot stop a same-tick double click. */
  const renderExportBusyRef = useRef(false);

  const getRepository = (): ProjectRepository => {
    if (!repositoryRef.current) {
      repositoryRef.current = createLocalProjectRepository({ storage: window.localStorage });
    }
    return repositoryRef.current;
  };

  const selectedObject = findSceneObject(scene, scene.selectedId);
  const [specPreview, setSpecPreview] = useState<SpecPreview | null>(null);
  // A preview is only shown while it still belongs to the selected object and was
  // computed from its current spec.
  const activePreview = isPreviewApplicable(specPreview, selectedObject) ? specPreview : null;
  /**
   * Phase 6.2: the parameter form only describes parametric furniture. An
   * imported model has no editable parameters, so every parametric control uses
   * this narrowed value and stays inert for it.
   */
  const furnitureObject =
    selectedObject && isFurnitureSceneObject(selectedObject) ? selectedObject : null;
  const viewScene = useMemo(
    () => (activePreview ? previewScene(scene.data, activePreview) : scene.data),
    [scene.data, activePreview],
  );
  const parsed = useMemo(
    () => (furnitureObject ? parseFurnitureValues(furnitureObject.type, values) : null),
    [furnitureObject, values],
  );
  const paramsValid = parsed ? parsed.valid : true;
  const settings = scene.data.settings;
  const qualityProfile = useMemo(
    () =>
      qualityProfileId === 'custom'
        ? createCustomProfile(customQualityLimits, customQualitySeverity)
        : resolveQualityProfile(qualityProfileId),
    [qualityProfileId, customQualityLimits, customQualitySeverity],
  );

  useEffect(() => {
    setQualityPreflight(null);
    setQualityMessage('');
    setQualityPreflightStatus('idle');
  }, [scene.data, exportFormat, includeRoom, exportTextureSize, qualityProfile]);
  const importBlockedReason =
    exportStatus === 'exporting'
      ? "Eksport tugaguncha import qilib bo'lmaydi."
      : renderStatus === 'working'
        ? "Render tugaguncha import qilib bo'lmaydi."
        : undefined;
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
    if (object && isFurnitureSceneObject(object)) {
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
    setSpecPreview(null);
  }, [scene.selectedId]);

  useEffect(() => {
    void refreshProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleParamsChange = (field: string, value: string) => {
    if (!furnitureObject) {
      return;
    }
    const next = { ...values, [field]: value };
    setValues(next);
    const result = parseFurnitureValues(furnitureObject.type, next);
    if (result.valid && result.params) {
      dispatch({ type: 'UPDATE_PARAMS', id: furnitureObject.id, params: result.params });
    }
  };

  /**
   * Stage 3.2: the configurator validates a patch through `updateFurnitureSpec`
   * and hands over the canonical spec; the reducer only accepts that spec.
   */
  const handleSpecUpdate = (spec: SceneSpec) => {
    if (selectedObject) {
      dispatch({ type: 'UPDATE_SPEC', id: selectedObject.id, spec });
    }
  };

  const handleSpecPreview = (preview: SpecPreview) => {
    setSpecPreview(preview);
  };

  const handleSpecCancel = () => {
    setSpecPreview(null);
  };

  const handleSpecApply = (spec: SceneSpec) => {
    setSpecPreview(null);
    if (selectedObject) {
      dispatch({ type: 'UPDATE_SPEC', id: selectedObject.id, spec });
    }
  };

  const handleSpecUndo = () => {
    dispatch({ type: 'UNDO_SPEC' });
  };

  const handleSpecRedo = () => {
    dispatch({ type: 'REDO_SPEC' });
  };

  const handleParamsReset = () => {
    if (!furnitureObject) {
      return;
    }
    const defaults = createFurnitureParams(furnitureObject.type);
    setValues(furnitureParamsToFieldValues(furnitureObject.type, defaults));
    dispatch({ type: 'UPDATE_PARAMS', id: furnitureObject.id, params: defaults });
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

  const applyDesign = (
    type: FurnitureType,
    params: FurnitureParams,
    materialPresetId: MaterialPresetId | null = null,
  ) => {
    // W13: a generated design creates a NEW object. It never overwrites the
    // current selection, so an AI prompt cannot silently destroy existing work.
    // The material preset travels with the creation, so the object never exists
    // for a moment with the wrong material.
    dispatch({
      type: 'ADD_FURNITURE',
      furnitureType: type,
      id: createSceneObjectId(),
      params,
      materialPresetId,
    });
    setValues(furnitureParamsToFieldValues(type, params));
  };

  const handleAddAssembly = (assembly: SceneAssembly) =>
    dispatch({ type: 'ADD_ASSEMBLY', assembly });

  const handleDeleteAssembly = (id: string) => dispatch({ type: 'DELETE_ASSEMBLY', id });

  const handleResetView = () => {
    setCameraAngle(null);
    setResetToken((token) => token + 1);
  };

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

  const handleBaseColor = (color: string) => {
    if (!selectedObject) {
      return;
    }
    if (selectedObject.definitionId !== undefined) {
      dispatch({ type: 'UPDATE_MATERIAL', id: selectedObject.id, material: { baseColor: color } });
    } else {
      // Legacy pieces keep params.color as the single source of truth.
      dispatch({
        type: 'UPDATE_PARAMS',
        id: selectedObject.id,
        params: { ...selectedObject.params, color },
      });
    }
  };

  const handleMaterialMap = (role: TextureMapRole, ref: TextureAssetRef | null) => {
    if (selectedObject) {
      dispatch({
        type: 'SET_MATERIAL_MAP',
        id: selectedObject.id,
        role,
        ref,
      });
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

  const handleUpdateHardware = (hardware: HardwareItem[]) => {
    if (selectedObject) {
      dispatch({ type: 'SET_HARDWARE', id: selectedObject.id, hardware });
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
  const handleEnvironment = (patch: { enabled?: boolean; intensity?: number }) =>
    dispatch({ type: 'SET_ENVIRONMENT', ...patch });
  const handleResetLights = () => dispatch({ type: 'RESET_LIGHTS' });
  const handleRoomMaterials = (patch: Partial<RoomMaterialSettings>) =>
    dispatch({
      type: 'UPDATE_ROOM_MATERIALS',
      floorColor: patch.floorColor,
      wallColor: patch.wallColor,
    });
  const handleCameraPreset = (preset: CameraPreset) => {
    setCameraAngle(null);
    dispatch({ type: 'SET_CAMERA_PRESET', preset });
    setCameraPresetToken((token) => token + 1);
  };

  const handleCameraAngle = (angle: CameraAngleId) => {
    setCameraAngle(angle);
    viewerRef.current?.applyCameraAngle(angle);
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
      // Imported models are session-only: their geometry lives in the runtime
      // store, so a saved record could never be rebuilt. They are left out of the
      // saved scene and the user is told, rather than finding an empty object
      // after reloading.
      const persisted = sceneForPersistence(scene.data);
      const importedNote =
        persisted.droppedImported > 0
          ? ` ${persisted.droppedImported} import qilingan model saqlanmadi — u faqat sessiyada ishlaydi.`
          : '';
      if (activeProjectId) {
        const updated = await repository.update(activeProjectId, {
          name: projectName,
          scene: persisted.scene,
        });
        if (!updated) {
          setProjectsStatus('error');
          setProjectsMessage("Loyiha topilmadi. Iltimos, ro'yxatni yangilang.");
        } else {
          setProjectsStatus('ok');
          setProjectsMessage(`Loyiha yangilandi.${importedNote}`);
          setSavedSignature(sceneSignature(projectName, scene.data));
        }
      } else {
        const created = await repository.create({ name: projectName, scene: persisted.scene });
        setActiveProjectId(created.id);
        setProjectName(created.name);
        setProjectsStatus('ok');
        setProjectsMessage(`Loyiha saqlandi.${importedNote}`);
        setSavedSignature(sceneSignature(created.name, scene.data));
      }
      await refreshProjects();
    } catch (error) {
      setProjectsStatus('error');
      setProjectsMessage(
        isStorageQuotaError(error)
          ? "Brauzer xotirasi to'ldi. Eski loyihalarni o'chiring yoki JSON sifatida eksport qilib, qayta urinib ko'ring."
          : "Loyihani saqlab bo'lmadi.",
      );
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
    // A project may open on an imported object; the parameter form then describes
    // the first *parametric* piece, or the table defaults when there is none.
    const first = project.scene.objects.find(isFurnitureSceneObject);
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

  const resolvePrintTargetId = (): string | undefined => {
    const isPrintFormat = exportFormat === 'stl' || exportFormat === '3mf';
    if (!isPrintFormat || !printSelectedOnly || !selectedObject) {
      return undefined;
    }
    // Resolve against current objects so a stale selection cannot empty the export.
    return scene.data.objects.find((object) => object.id === selectedObject.id)?.id;
  };

  const handleRunQualityPreflight = async () => {
    if (qualityPreflightStatus === 'running' || exportStatus === 'exporting') {
      return;
    }
    setQualityPreflightStatus('running');
    setQualityMessage('');
    try {
      const isPrintFormat = exportFormat === 'stl' || exportFormat === '3mf';
      const printTargetId = resolvePrintTargetId();
      const result = preflightExportScene(scene.data, {
        profile: qualityProfile,
        format: exportFormat,
        includeRoom: isPrintFormat ? false : includeRoom,
        ...(exportFormat === 'glb' ? { textureSize: exportTextureSize } : {}),
        ...(isPrintFormat ? { onlyObjectId: printTargetId } : {}),
      });
      setQualityPreflight(result);
      setQualityMessage(result.status === 'BLOCK' ? result.message : '');
    } catch (error) {
      setQualityPreflight(null);
      setQualityMessage(
        error instanceof Error ? error.message : 'Sifat tekshiruvi bajarilmadi.',
      );
    } finally {
      setQualityPreflightStatus('idle');
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
      const isPrintFormat = exportFormat === 'stl' || exportFormat === '3mf';
      // STL/3MF are print deliverables: the room is never part of them, and the
      // selected product can narrow the export to one object.
      const printTargetId = resolvePrintTargetId();
      const artifact = await exportSceneToFormat(exportFormat, scene.data, metadata, {
        includeRoom: isPrintFormat ? false : includeRoom,
        textureSize: exportFormat === 'glb' ? exportTextureSize : undefined,
        qualityProfile,
        ...(isPrintFormat ? { onlyObjectId: printTargetId } : {}),
      });
      downloadBlob(artifact.blob, artifact.filename);
      setExportStatus('success');
      if (artifact.quality) {
        setQualityPreflight(artifact.quality);
        setQualityMessage(artifact.quality.status === 'WARNING' ? artifact.quality.message : '');
      } else {
        setQualityPreflight(null);
        setQualityMessage('');
      }
      // The JSON document is a saved scene, so it carries parametric objects only.
      const importedNote =
        exportFormat === 'json' && sceneForPersistence(scene.data).droppedImported > 0
          ? ' Import qilingan modellar faylga kiritilmadi (faqat sessiyada ishlaydi).'
          : '';
      setExportMessage(`Sahna "${artifact.filename}" sifatida yuklab olindi.${importedNote}`);
    } catch (error) {
      if (error instanceof ExportError && error.quality) {
        setQualityPreflight(error.quality);
        setQualityMessage(error.message);
      }
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
      // Say when stored values had to be adjusted: the project is not the file.
      const adjusted =
        result.normalizedObjects > 0
          ? ` ${result.normalizedObjects} obyektning parametri ruxsat etilgan oraliqqa keltirildi.`
          : '';
      // Say when assembly data did not survive. This is only added when something
      // really was dropped, and the loss becomes permanent the first time the
      // project is saved, so staying silent here would mislead the user.
      const assembliesDropped =
        result.droppedAssemblies > 0
          ? ` ${result.droppedAssemblies} assembly o'qib bo'lmagani uchun tashlab yuborildi.`
          : '';
      setExportMessage(
        result.droppedObjects > 0
          ? `Import qilindi; ${result.droppedObjects} yaroqsiz obyekt o'tkazib yuborildi.${assembliesDropped}${adjusted}`
          : `JSON loyiha import qilindi.${assembliesDropped}${adjusted}`,
      );
    } catch (error) {
      setExportStatus('error');
      setExportMessage("Faylni o'qib bo'lmadi.");
      console.error('JSON import xatosi:', error);
    }
  };

  /**
   * Phase 6.2.1 — adds a parsed GLB to the scene.
   *
   * The metadata is validated before the geometry is registered: a record the
   * reducer would refuse must not leave an entry orphaned in the runtime store
   * that nothing can ever delete. The store, not the scene, owns the model, so a
   * later `DELETE_OBJECT` releases it through the viewer.
   */
  const handleImportModel = (model: ParsedImport): void => {
    const id = createSceneObjectId();
    if (!validateSceneObject(createImportedSceneObject(id, model.meta))) {
      model.dispose();
      throw new Error("Import ma'lumotlari tekshiruvdan o'tmadi.");
    }
    importedModelStore.register(id, { root: model.root, dispose: model.dispose });
    dispatch({ type: 'ADD_IMPORTED_OBJECT', id, imported: model.meta });
  };

  /**
   * C8: hand the live 3D view to the product panel. Returns null rather than
   * throwing when the renderer is not ready, so the panel can say so instead of
   * showing a broken image.
   */
  const handleCapturePreview = async (preset: PngPreset): Promise<Blob | null> => {
    // A pending AI proposal is rendered in the viewer; capturing it would export
    // geometry the user has not applied.
    if (previewCaptureBlockReason(activePreview)) {
      return null;
    }
    const viewer = viewerRef.current;
    if (!viewer) {
      return null;
    }
    const size = resolvePngSize(preset);
    return viewer.capturePng(size.width, size.height);
  };

  /**
   * A2.2: the product shots that go into the ZIP.
   *
   * Returned as plain bytes so the package builder stays renderer-free. `null`
   * means the viewer is not ready — the caller then packages without previews and
   * says so, rather than shipping blank images.
   */
  const handleCaptureProductPreviews = async (): Promise<
    Array<{ name: string; bytes: Uint8Array }> | null
  > => {
    if (previewCaptureBlockReason(activePreview)) {
      return null;
    }
    const viewer = viewerRef.current;
    if (!viewer) {
      return null;
    }
    const size = resolvePngSize('package');
    const shots = await viewer.captureProductPreviews(size.width, size.height);
    return shots.map((shot) => ({ name: shot.filename, bytes: shot.bytes }));
  };

  /**
   * The alpha probe renders a real frame, so it runs once per viewer instance
   * and the result is cached. A failed probe switches the option off instead of
   * silently producing opaque "transparent" files.
   */
  const ensureTransparentCapture = async (viewer: SceneViewer): Promise<boolean> => {
    if (transparentProbeRef.current !== null) {
      return transparentProbeRef.current;
    }
    const probe = await viewer.probeTransparentCapture();
    transparentProbeRef.current = probe.supported;
    setTransparentAvailable(probe.supported);
    if (!probe.supported) {
      setPngTransparent(false);
      setRenderStatus('error');
      setRenderMessage(probe.reason ?? "Brauzer shaffof fonni saqlamayapti.");
    }
    return probe.supported;
  };

  const handleExportPng = async () => {
    if (renderExportBusyRef.current) {
      return;
    }

    const captureBlock = previewCaptureBlockReason(activePreview);
    if (captureBlock) {
      setRenderStatus('error');
      setRenderMessage(captureBlock);
      return;
    }

    const viewer = viewerRef.current;
    if (!viewer) {
      setRenderStatus('error');
      setRenderMessage("3D ko'rinish hali tayyor emas. Birozdan so'ng urinib ko'ring.");
      return;
    }

    renderExportBusyRef.current = true;
    setBatchProgress(null);
    setRenderStatus('working');
    setRenderMessage('Render qilinmoqda…');

    try {
      if (pngTransparent && !(await ensureTransparentCapture(viewer))) {
        return;
      }
      const projectLabel = projectName.trim() !== '' ? projectName.trim() : '3d-studio-ai';
      const result = await exportScenePng(
        pngPreset,
        {
          capture: (size, request) =>
            viewer.capturePng(
              size.width,
              size.height,
              request?.transparent ? { transparent: true } : {},
            ),
          download: (blob, filename) => downloadBlob(blob, filename),
        },
        {
          filename: renderPngFilename(projectLabel, pngPreset),
          transparent: pngTransparent,
        },
      );
      setRenderStatus('success');
      setRenderMessage(
        `PNG saqlandi (${result.size.width}×${result.size.height}, ` +
          `${Math.round(result.bytes / 1024)} KB).`,
      );
    } catch (error) {
      setRenderStatus('error');
      setRenderMessage(describeCaptureError(error));
      console.error('PNG eksport xatosi:', error);
    } finally {
      renderExportBusyRef.current = false;
    }
  };

  const handleExportBatchPng = async () => {
    if (renderExportBusyRef.current) {
      return;
    }

    const captureBlock = previewCaptureBlockReason(activePreview);
    if (captureBlock) {
      setRenderStatus('error');
      setRenderMessage(captureBlock);
      return;
    }

    const viewer = viewerRef.current;
    if (!viewer) {
      setRenderStatus('error');
      setRenderMessage("3D ko'rinish hali tayyor emas. Birozdan so'ng urinib ko'ring.");
      return;
    }

    renderExportBusyRef.current = true;
    setBatchProgress(null);
    setRenderStatus('working');
    setRenderMessage('6 rakurs tayyorlanmoqda…');

    try {
      if (pngTransparent && !(await ensureTransparentCapture(viewer))) {
        return;
      }
      const projectLabel = projectName.trim() !== '' ? projectName.trim() : '3d-studio-ai';
      const result = await exportRenderBatch(
        pngPreset,
        {
          capture: (view, size) =>
            viewer.capturePng(size.width, size.height, {
              cameraAngle: view.cameraAngle,
              includeRoom: false,
              hideSelection: true,
              transparent: pngTransparent,
            }),
          download: (blob, filename) => downloadBlob(blob, filename),
        },
        {
          projectName: projectLabel,
          onProgress: (progress) =>
            setBatchProgress({
              current: progress.current,
              total: progress.total,
              label: progress.view.label,
            }),
        },
      );
      setRenderStatus('success');
      setRenderMessage(
        `ZIP saqlandi (${result.files.length} ta PNG, ` +
          `${(result.bytes / 1024 / 1024).toFixed(1)} MB).`,
      );
    } catch (error) {
      setRenderStatus('error');
      setRenderMessage(batchRenderErrorMessage(error));
      console.error('6 rakursli ZIP eksport xatosi:', error);
    } finally {
      setBatchProgress(null);
      renderExportBusyRef.current = false;
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
        mobileSections
      >
        <div className="panel__section" data-section="scene">
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
            cameraAngle={cameraAngle}
            roomMaterials={settings.roomMaterials}
            lightingPreset={settings.lightingPreset}
            exposure={settings.exposure}
            toneMapping={settings.toneMapping}
            onBackground={handleBackground}
            onCameraPreset={handleCameraPreset}
            onCameraAngle={handleCameraAngle}
            onRoomMaterials={handleRoomMaterials}
            onLightingPreset={handleLightingPreset}
            onExposure={handleExposure}
            onToneMapping={handleToneMapping}
          />
          <LightingPanel
            lights={settings.lights}
            environmentEnabled={settings.environmentEnabled}
            environmentIntensity={settings.environmentIntensity}
            onUpdate={handleLights}
            onEnvironmentUpdate={handleEnvironment}
            onReset={handleResetLights}
          />
        </div>

        <div className="panel__section" data-section="objects">
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
          <ConfiguratorPanel object={selectedObject} onApplySpec={handleSpecUpdate} />
        </div>

        <div className="panel__section" data-section="materials">
          <MaterialPanel
            object={selectedObject}
            onMaterial={handleMaterial}
            onApplyPreset={handleApplyMaterialPreset}
            onMaterialMap={handleMaterialMap}
            onBaseColor={handleBaseColor}
            onReset={handleResetMaterial}
          />
        </div>

        <div className="panel__section" data-section="ai">
          <AiFurniturePanel
            onCreate={(definitionId, spec) =>
              dispatch({
                type: 'ADD_UNIVERSAL_FURNITURE',
                id: createSceneObjectId(),
                definitionId,
                spec,
              })
            }
          />
          <AiEditPanel
            key={selectedObject?.id ?? 'none'}
            object={selectedObject}
            preview={activePreview}
            canUndo={(scene.history?.past.length ?? 0) > 0}
            canRedo={(scene.history?.future.length ?? 0) > 0}
            onPreview={handleSpecPreview}
            onApply={handleSpecApply}
            onCancel={handleSpecCancel}
            onUndo={handleSpecUndo}
            onRedo={handleSpecRedo}
          />
          <AiBudgetPanel />
          <AiPromptPanel onApply={applyDesign} backendConfigured={BACKEND_CONFIGURED} />
          <ImageReferencePanel onConfirm={handleImageReferenceConfirm} />
        </div>

        <div className="panel__section" data-section="export">
          {/* C8.3: the manufacturing document stack is not needed for the first
              screen, so it loads in its own chunk instead of the entry bundle. */}
          <LazyManufacturingPanel
            object={selectedObject}
            projectName={projectName}
            scene={scene.data}
            onAssignSheetMaterial={handleAssignSheetMaterial}
            onRemoveSheetMaterial={handleRemoveSheetMaterial}
            onUpdateHardware={handleUpdateHardware}
            captureBlockedReason={previewCaptureBlockReason(activePreview) ?? undefined}
            onCapturePreview={handleCapturePreview}
            onCaptureProductPreviews={handleCaptureProductPreviews}
          />
        </div>

        <div className="panel__section" data-section="other">
          {/* Account, server readiness and server jobs are real backend flows.
              Without VITE_API_BASE_URL they cannot work, so a frontend-only build
              explains that instead of showing a login that always fails. */}
          {BACKEND_CONFIGURED ? (
            <>
              <AccountPanel />
              <ServerPanel />
            </>
          ) : (
            <p className="panel__hint" data-testid="backend-unavailable-note">
              Akkaunt, serverda saqlash, vazifalar va to‘lovlar bu versiyada mavjud emas.
              Loyihalar shu qurilmada saqlanadi.
            </p>
          )}
          <AssemblyPanel
            assemblies={scene.data.assemblies ?? []}
            onAdd={handleAddAssembly}
            onDelete={handleDeleteAssembly}
          />
        </div>

        {BACKEND_CONFIGURED && (
          <div className="panel__section" data-section="ai">
            <JobsPanel />
          </div>
        )}

        <div className="panel__section" data-section="other">
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
        </div>

        <div className="panel__section" data-section="export">
          {/* Phase 6.2.1: a model import allocates geometry and textures, so it is
              refused while an export or a capture still owns the renderer. */}
          <ImportPanel blockedReason={importBlockedReason} onImport={handleImportModel} />
          <ExportControls
            format={exportFormat}
            includeRoom={includeRoom}
            status={exportStatus}
            message={exportMessage}
            disabled={!paramsValid}
            textureSize={exportTextureSize}
            printScopeSelected={printSelectedOnly}
            selectedObjectName={selectedObject?.name ?? null}
            onPrintScopeChange={setPrintSelectedOnly}
            onFormatChange={setExportFormat}
            onTextureSizeChange={setExportTextureSize}
            onIncludeRoomChange={setIncludeRoom}
            onExport={handleExportFile}
            onImportFile={handleImportJson}
            qualityProfileId={qualityProfileId}
            qualityProfile={qualityProfile}
            qualityPreflight={qualityPreflight}
            qualityPreflightStatus={qualityPreflightStatus}
            qualityMessage={qualityMessage}
            customLimits={customQualityLimits}
            customBudgetSeverity={customQualitySeverity}
            onQualityProfileChange={setQualityProfileId}
            onCustomLimitsChange={setCustomQualityLimits}
            onCustomBudgetSeverityChange={setCustomQualitySeverity}
            onRunQualityPreflight={handleRunQualityPreflight}
          />
          <RenderExportPanel
            preset={pngPreset}
            quality={settings.qualityPreset}
            transparent={pngTransparent}
            transparentAvailable={transparentAvailable}
            status={renderStatus}
            message={renderMessage}
            progress={batchProgress}
            disabled={false}
            onPresetChange={setPngPreset}
            onQualityChange={handleQuality}
            onTransparentChange={setPngTransparent}
            onExportCurrent={handleExportPng}
            onExportBatch={handleExportBatchPng}
          />
          <PrintReadinessPanel object={selectedObject} />
        </div>
      </FurniturePanel>

      <main className="stage">
        {/* C8.2: three.js loads behind a lazy boundary so the shell paints first
            and a failed chunk request shows a retry instead of a blank stage. */}
        <LazyViewer
          scene={viewScene}
          selectedId={scene.selectedId}
          resetToken={resetToken}
          cameraPreset={settings.cameraPreset}
          cameraPresetToken={cameraPresetToken}
          onSelect={handleSelect}
          onReady={(viewer) => {
            viewerRef.current = viewer;
            transparentProbeRef.current = null;
            setTransparentAvailable(true);
            if (viewer && cameraAngle) {
              viewer.applyCameraAngle(cameraAngle);
            }
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
