import { newId } from '../model/schema';
import { PANEL_TEMPLATES, SWATCHES, withBodyColour, type Fill, type GarmentStyle, type Panel } from '../model/style';
import type { NeckSurface } from '../geometry/outline';
import type { StyleLabels } from '../garments/types';

interface Props {
  style: GarmentStyle;
  /** What this garment calls its parts; parts it doesn't have are left out. */
  labels: StyleLabels;
  surface: NeckSurface;
  selectedPanelId: string | null;
  selectedPoint: number | null;
  /** `key` groups a continuous gesture (e.g. dragging a colour picker) into one undo step. */
  onChange: (style: GarmentStyle, key: string) => void;
  onSelectPanel: (id: string | null) => void;
  onSelectPoint: (index: number | null) => void;
}

function ColourPicker({ label, fill, onPick }: { label: string; fill: Fill; onPick: (color: string, continuous: boolean) => void }) {
  return (
    <div className="colour-row">
      <div className="colour-head">
        <span>{label}</span>
        <label className="custom-colour" title="Pick any colour">
          <input type="color" value={fill.color} onChange={(e) => onPick(e.target.value, true)} aria-label={`${label}: custom colour`} />
          <span className="chip" style={{ background: fill.color }} />
          Custom
        </label>
      </div>
      <div className="swatches" role="group" aria-label={`${label} colour`}>
        {SWATCHES.map((s) => (
          <button
            key={s.color}
            className={`swatch${s.color.toLowerCase() === fill.color.toLowerCase() ? ' on' : ''}`}
            style={{ background: s.color }}
            title={s.name}
            aria-label={s.name}
            aria-pressed={s.color.toLowerCase() === fill.color.toLowerCase()}
            onClick={() => onPick(s.color, false)}
          />
        ))}
      </div>
    </div>
  );
}

export function StyleControls({ style, labels, surface, selectedPanelId, selectedPoint, onChange, onSelectPanel, onSelectPoint }: Props) {
  const stamp = () => Date.now();
  const setFill = (part: 'body' | 'sleeves' | 'rib', color: string, continuous: boolean) =>
    onChange(part === 'body' ? withBodyColour(style, color) : { ...style, [part]: { color } }, continuous ? `fill:${part}` : `fill:${part}:${stamp()}`);

  const panel = style.panels.find((p) => p.id === selectedPanelId) ?? null;
  const updatePanel = (next: Panel, key: string) => onChange({ ...style, panels: style.panels.map((p) => (p.id === next.id ? next : p)) }, key);

  const addPanel = (templateId: string) => {
    const t = PANEL_TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    // A darker shade on light garments and vice versa, so the new panel is visible straight away.
    const n = parseInt(style.body.color.slice(1), 16);
    const light = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.5;
    const p: Panel = {
      id: newId(),
      name: t.name,
      surface,
      points: t.points.map(([u, v]) => [u, v] as [number, number]),
      curved: t.curved,
      mirrored: t.mirrored,
      seam: true,
      area: t.area,
      fill: { color: light ? '#3a3c40' : '#b9bcc2' },
    };
    onChange({ ...style, panels: [...style.panels, p] }, `panel-add:${stamp()}`);
    onSelectPanel(p.id);
    onSelectPoint(null);
  };

  const move = (dir: -1 | 1) => {
    if (!panel) return;
    const i = style.panels.indexOf(panel);
    const j = i + dir;
    if (j < 0 || j >= style.panels.length) return;
    const panels = style.panels.slice();
    [panels[i], panels[j]] = [panels[j], panels[i]];
    onChange({ ...style, panels }, `panel-order:${stamp()}`);
  };

  const remove = () => {
    if (!panel) return;
    onChange({ ...style, panels: style.panels.filter((p) => p.id !== panel.id) }, `panel-del:${stamp()}`);
    onSelectPanel(null);
  };

  const copyToOtherSide = () => {
    if (!panel) return;
    const other: NeckSurface = panel.surface === 'front' ? 'back' : 'front';
    const copy: Panel = { ...structuredClone(panel), id: newId(), surface: other };
    onChange({ ...style, panels: [...style.panels, copy] }, `panel-copy:${stamp()}`);
  };

  const removePoint = () => {
    if (!panel || selectedPoint == null || panel.points.length <= 3) return;
    updatePanel({ ...panel, points: panel.points.filter((_, i) => i !== selectedPoint) }, `panel-pt-del:${stamp()}`);
    onSelectPoint(null);
  };

  return (
    <div className="style-controls">
      <details open>
        <summary>Colours</summary>
        <ColourPicker label={labels.body} fill={style.body} onPick={(c, k) => setFill('body', c, k)} />
        {labels.sleeves && <ColourPicker label={labels.sleeves} fill={style.sleeves} onPick={(c, k) => setFill('sleeves', c, k)} />}
        <ColourPicker label={labels.rib} fill={style.rib} onPick={(c, k) => setFill('rib', c, k)} />
        <label className="toggle" title="Soft lines that suggest how the fabric falls. Drawing only: they don't change the shape.">
          <input type="checkbox" checked={style.folds} onChange={(e) => onChange({ ...style, folds: e.target.checked }, `folds:${stamp()}`)} />
          Show fold lines
        </label>
        {labels.armholeSeam && (
          <label className="toggle" title="The line where each sleeve joins the body">
            <input type="checkbox" checked={style.armholeSeam} onChange={(e) => onChange({ ...style, armholeSeam: e.target.checked }, `armhole-seam:${stamp()}`)} />
            {labels.armholeSeam}
          </label>
        )}
      </details>

      <details open>
        <summary>Panels</summary>
        <p className="note">Split the garment into coloured panels. A panel only shows inside the garment, so its shape can run past the edges.</p>
        <div className="field">
          <label htmlFor="add-panel">Add a panel to the {surface}</label>
          <select id="add-panel" value="" onChange={(e) => addPanel(e.target.value)}>
            <option value="" disabled>Choose a starting shape…</option>
            {PANEL_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>{t.name}: {t.description}</option>
            ))}
          </select>
        </div>
        {style.panels.length > 0 && (
          <ul className="panel-list">
            {style.panels.map((p) => (
              <li key={p.id} className={p.id === selectedPanelId ? 'on' : ''}>
                <button className="link" onClick={() => { onSelectPanel(p.id === selectedPanelId ? null : p.id); onSelectPoint(null); }}>
                  <span className="chip" style={{ background: p.fill.color }} />
                  {p.name}
                </button>
                <small>{p.surface}{p.mirrored ? ' · both sides' : ''}</small>
              </li>
            ))}
          </ul>
        )}

        {panel && (
          <div className="panel-editor">
            <div className="field">
              <label htmlFor="panel-name">Panel name</label>
              <input id="panel-name" className="text" value={panel.name} maxLength={60} onChange={(e) => updatePanel({ ...panel, name: e.target.value }, `panel-name:${panel.id}`)} />
            </div>
            <ColourPicker label="Panel colour" fill={panel.fill} onPick={(c, k) => updatePanel({ ...panel, fill: { color: c } }, k ? `panel-fill:${panel.id}` : `panel-fill:${stamp()}`)} />
            <label className="toggle"><input type="checkbox" checked={panel.mirrored} onChange={(e) => updatePanel({ ...panel, mirrored: e.target.checked }, `panel-mirror:${stamp()}`)} /> Copy onto both sides (mirror)</label>
            <label className="toggle"><input type="checkbox" checked={panel.area === 'body'} onChange={(e) => updatePanel({ ...panel, area: e.target.checked ? 'body' : 'whole' }, `panel-area:${stamp()}`)} /> Keep off the sleeves</label>
            <label className="toggle"><input type="checkbox" checked={panel.curved} onChange={(e) => updatePanel({ ...panel, curved: e.target.checked }, `panel-curve:${stamp()}`)} /> Curved edges</label>
            <label className="toggle"><input type="checkbox" checked={panel.seam} onChange={(e) => updatePanel({ ...panel, seam: e.target.checked }, `panel-seam:${stamp()}`)} /> Show seam line</label>
            <div className="gen-row">
              <button className="small" onClick={removePoint} disabled={selectedPoint == null || panel.points.length <= 3} title="Tap a square on the garment first">Remove selected point</button>
              <button className="small" onClick={copyToOtherSide}>Copy to {panel.surface === 'front' ? 'back' : 'front'}</button>
            </div>
            <div className="gen-row">
              <button className="small" onClick={() => move(1)} disabled={style.panels.indexOf(panel) === style.panels.length - 1}>Bring forward</button>
              <button className="small" onClick={() => move(-1)} disabled={style.panels.indexOf(panel) === 0}>Send back</button>
              <button className="small" onClick={remove}>Delete panel</button>
            </div>
            <button className="primary done" onClick={() => onSelectPanel(null)}>Done</button>
          </div>
        )}
      </details>
    </div>
  );
}
