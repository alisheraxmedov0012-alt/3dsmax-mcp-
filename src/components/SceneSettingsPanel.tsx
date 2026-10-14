import {
  CAMERA_PRESETS,
  CAMERA_PRESET_LABELS,
  type CameraPreset,
  type RoomMaterialSettings,
} from '../scene/sceneSettings';
import {
  EXPOSURE_LIMITS,
  LIGHTING_PRESETS,
  LIGHTING_PRESET_LABELS,
  TONE_MAPPING_LABELS,
  TONE_MAPPING_MODES,
  type LightingPresetChoice,
  type ToneMappingMode,
} from '../render/renderPresets';

interface SceneSettingsPanelProps {
  background: string;
  cameraPreset: CameraPreset;
  roomMaterials: RoomMaterialSettings;
  lightingPreset: LightingPresetChoice;
  exposure: number;
  toneMapping: ToneMappingMode;
  onBackground: (color: string) => void;
  onCameraPreset: (preset: CameraPreset) => void;
  onRoomMaterials: (patch: Partial<RoomMaterialSettings>) => void;
  onLightingPreset: (preset: LightingPresetChoice) => void;
  onExposure: (value: number) => void;
  onToneMapping: (mode: ToneMappingMode) => void;
}

const BACKGROUND_SWATCHES = ['#1b1f24', '#0f1115', '#2a2f36', '#f2f4f7', '#c9d3e0', '#3b2f2f'];

export function SceneSettingsPanel({
  background,
  cameraPreset,
  roomMaterials,
  lightingPreset,
  exposure,
  toneMapping,
  onBackground,
  onCameraPreset,
  onRoomMaterials,
  onLightingPreset,
  onExposure,
  onToneMapping,
}: SceneSettingsPanelProps) {
  return (
    <section className="visual">
      <h2 className="visual__title">Sahna va kamera</h2>

      <div className="field">
        <span className="field__label">Fon rangi</span>
        <div className="swatches">
          {BACKGROUND_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className={color === background ? 'swatch swatch--active' : 'swatch'}
              style={{ backgroundColor: color }}
              aria-label={`Fon rangi ${color}`}
              aria-pressed={color === background}
              onClick={() => onBackground(color)}
            />
          ))}
        </div>
        <input
          className="field__input"
          type="color"
          value={background}
          aria-label="Fon rangini tanlash"
          onChange={(event) => onBackground(event.target.value)}
        />
      </div>

      <div className="field">
        <span className="field__label">Kamera rakursi</span>
        <div className="preset-grid">
          {CAMERA_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={preset === cameraPreset ? 'preset preset--active' : 'preset'}
              aria-pressed={preset === cameraPreset}
              onClick={() => onCameraPreset(preset)}
            >
              {CAMERA_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">Yoritish preseti</span>
        <div className="preset-grid">
          {LIGHTING_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={preset === lightingPreset ? 'preset preset--active' : 'preset'}
              aria-pressed={preset === lightingPreset}
              onClick={() => onLightingPreset(preset)}
            >
              {LIGHTING_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        {lightingPreset === 'custom' && (
          <p className="visual__hint">Yoritish qo&apos;lda sozlangan (preset yo&apos;q).</p>
        )}
      </div>

      <div className="field">
        <span className="field__label">Tone mapping</span>
        <select
          className="field__input"
          value={toneMapping}
          aria-label="Tone mapping"
          onChange={(event) => onToneMapping(event.target.value as ToneMappingMode)}
        >
          {TONE_MAPPING_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {TONE_MAPPING_LABELS[mode]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="exposure">
          Ekspozitsiya
          <span className="field__range">
            {EXPOSURE_LIMITS.min}–{EXPOSURE_LIMITS.max}
          </span>
        </label>
        <input
          id="exposure"
          type="range"
          min={EXPOSURE_LIMITS.min}
          max={EXPOSURE_LIMITS.max}
          step={EXPOSURE_LIMITS.step}
          value={exposure}
          onChange={(event) => onExposure(Number(event.target.value))}
        />
      </div>

      <div className="field">
        <span className="field__label">Xona materiali</span>
        <div className="axis">
          <span className="axis__label">Pol</span>
          <input
            type="color"
            value={roomMaterials.floorColor}
            aria-label="Pol rangi"
            onChange={(event) => onRoomMaterials({ floorColor: event.target.value })}
          />
        </div>
        <div className="axis">
          <span className="axis__label">Devor</span>
          <input
            type="color"
            value={roomMaterials.wallColor}
            aria-label="Devor rangi"
            onChange={(event) => onRoomMaterials({ wallColor: event.target.value })}
          />
        </div>
      </div>
    </section>
  );
}
