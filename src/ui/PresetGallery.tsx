import { useEffect, useMemo, useState } from 'react';
import { CATEGORY_GROUP, PRESETS, PRESET_CATEGORIES, type Preset } from '../model/presets';
import { flatView } from '../render/layers';

/** Small front view, drawn with the same layers as the editor (colours and panels included). */
function Thumbnail({ preset }: { preset: Preset }) {
  const v = useMemo(() => flatView(preset.params(), 'front'), [preset]);
  const pad = 6;
  const half = Math.max(Math.abs(v.bounds.minX), Math.abs(v.bounds.maxX)) + pad;
  const top = Math.min(v.bounds.minY, 0) - pad;
  const size = Math.max(2 * half, v.bounds.maxY - top + pad);
  const clipId = `thumb-${preset.id}`;
  return (
    <svg viewBox={`${-size / 2} ${top} ${size} ${size}`} aria-hidden="true">
      <clipPath id={clipId}><path d={v.clip} /></clipPath>
      {v.layers.map((l, i) => (
        <path
          key={i}
          d={l.d}
          fill={l.fill ?? 'none'}
          stroke={l.stroke}
          strokeWidth={l.stroke ? 1.5 * (l.weight ?? 1) : undefined}
          strokeDasharray={l.dashed ? '3 2' : undefined}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          clipPath={l.clipped ? `url(#${clipId})` : undefined}
        />
      ))}
    </svg>
  );
}

const GROUPS = [...new Set(Object.values(CATEGORY_GROUP))];

export function PresetGallery({ onPick, onClose, initialGroup }: { onPick: (id: string) => void; onClose: () => void; initialGroup?: string }) {
  const [group, setGroup] = useState(initialGroup && GROUPS.includes(initialGroup) ? initialGroup : GROUPS[0]);
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
        <div className="segmented gallery-tabs" role="tablist" aria-label="Garment type">
          {GROUPS.map((g) => (
            <button key={g} role="tab" aria-selected={g === group} className={g === group ? 'on' : ''} onClick={() => setGroup(g)}>
              {g}
            </button>
          ))}
        </div>
        <p className="note">Every shape is a starting point: all of it stays editable.</p>
        {PRESET_CATEGORIES.filter((cat) => CATEGORY_GROUP[cat] === group).map((cat) => (
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
