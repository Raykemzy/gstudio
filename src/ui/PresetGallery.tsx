import { useEffect, useMemo } from 'react';
import { PRESETS, PRESET_CATEGORIES, type Preset } from '../model/presets';
import { garmentPaths } from '../render/paths';

/** Small front-view outline, drawn with the same path code as the editor. */
function Thumbnail({ preset }: { preset: Preset }) {
  const g = useMemo(() => garmentPaths(preset.params(), 'front'), [preset]);
  const pad = 6;
  const half = Math.max(Math.abs(g.bounds.minX), Math.abs(g.bounds.maxX)) + pad;
  const top = Math.min(g.bounds.minY, 0) - pad;
  const size = Math.max(2 * half, g.bounds.maxY - top + pad);
  return (
    <svg viewBox={`${-size / 2} ${top} ${size} ${size}`} aria-hidden="true">
      <path d={g.outline} className="thumb-garment" />
      {g.collar && <path d={g.collar} className="thumb-collar" />}
    </svg>
  );
}

export function PresetGallery({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Choose a starting shape" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Start from a shape</h2>
          <button onClick={onClose} aria-label="Close">Close</button>
        </div>
        <p className="note">Every shape is a starting point: all of it stays editable.</p>
        {PRESET_CATEGORIES.map((cat) => (
          <section key={cat}>
            <h3>{cat}</h3>
            <div className="preset-grid">
              {PRESETS.filter((p) => p.category === cat).map((p) => (
                <button key={p.id} className="preset-card" onClick={() => onPick(p.id)} title={p.description}>
                  <Thumbnail preset={p} />
                  <span className="preset-name">{p.name}</span>
                  <span className="preset-desc">{p.description}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
