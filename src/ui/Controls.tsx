import { useState } from 'react';
import {
  CORE_FIELDS,
  HALF_WIDTH_KEYS,
  HEM_STYLES,
  NECK_STYLES,
  SIDE_FIELDS,
  cloneParams,
  type CoreKey,
  type FieldSpec,
  type HemStyle,
  type NeckStyle,
  type Side,
  type SideKey,
  type TShirtParams,
} from '../model/schema';

interface Props {
  params: TShirtParams;
  /** Propose new params. Returns an error message if rejected. `key` groups a gesture into one undo step. */
  onChange: (next: TShirtParams, key: string) => string | null;
}

const GROUPS: { id: string; title: string; core: CoreKey[]; side: SideKey[]; open?: boolean }[] = [
  { id: 'body', title: 'Body', core: ['bodyLength'], side: ['chestHalf', 'hemHalf', 'hemOffset'], open: true },
  { id: 'shoulders', title: 'Shoulders', core: [], side: ['shoulderHalf', 'shoulderDrop'], open: true },
  { id: 'sleeves', title: 'Sleeves', core: [], side: ['sleeveLength', 'sleeveOpening', 'sleeveAngle', 'armholeDepth'], open: true },
  { id: 'neck', title: 'Neckline & collar', core: ['neckWidth', 'neckDepthFront', 'neckDepthBack', 'collarWidth'], side: [] },
];

const NECK_LABELS: Record<NeckStyle, string> = { crew: 'Crew (round)', scoop: 'Scoop (U)', v: 'V-neck', square: 'Square', boat: 'Boat (wide, shallow)' };
const HEM_LABELS: Record<HemStyle, string> = { curved: 'Curved', straight: 'Straight lines' };

/** A slider plus a typed number box. `factor` scales stored half-widths to the full width shown to the user. */
function NumberField({ spec, value, factor = 1, onCommit, id }: { spec: FieldSpec; value: number; factor?: number; onCommit: (v: number, gesture: boolean) => void; id: string }) {
  const display = Math.round(value * factor * 100) / 100;
  // While typing, keep a local draft; otherwise always show the model value (so rejected edits snap back).
  const [draft, setDraft] = useState<string | null>(null);
  const unit = id.includes('sleeveAngle') ? '°' : 'cm';
  const commit = (v: number, gesture: boolean) => onCommit(v / factor, gesture);
  return (
    <div className="field">
      <label htmlFor={id} title={spec.help}>{spec.label}</label>
      <input
        type="range"
        min={spec.min * factor}
        max={spec.max * factor}
        step={spec.step * factor}
        value={display}
        onChange={(e) => commit(Number(e.target.value), true)}
        aria-label={spec.label}
      />
      <input
        id={id}
        className="num"
        type="number"
        min={spec.min * factor}
        max={spec.max * factor}
        step={spec.step * factor}
        value={draft ?? String(display)}
        onFocus={() => setDraft(String(display))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = Number(draft);
          if (draft?.trim() && Number.isFinite(v) && v !== display) commit(v, false);
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="unit">{unit}</span>
      <small className="help">{spec.help}</small>
    </div>
  );
}

export function Controls({ params, onChange }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const propose = (next: TShirtParams, key: string) => setMessage(onChange(next, key));

  const setCore = (k: CoreKey, v: number, gesture: boolean) => {
    const next = cloneParams(params);
    next.core[k] = v;
    propose(next, gesture ? `core:${k}` : `core:${k}:${Date.now()}`);
  };
  const setSide = (side: Side | 'both', k: SideKey, v: number, gesture: boolean) => {
    const next = cloneParams(params);
    if (side === 'both') next.left[k] = next.right[k] = v;
    else next[side][k] = v;
    propose(next, gesture ? `side:${side}:${k}` : `side:${side}:${k}:${Date.now()}`);
  };

  const sideField = (k: SideKey) => {
    const spec = SIDE_FIELDS[k];
    const isHalf = HALF_WIDTH_KEYS.has(k);
    if (params.mirror) {
      return (
        <NumberField key={k} id={`f-${k}`} spec={spec} value={params.left[k]} factor={isHalf ? 2 : 1} onCommit={(v, g) => setSide('both', k, v, g)} />
      );
    }
    return (
      <div key={k} className="side-pair">
        {(['right', 'left'] as Side[]).map((side) => (
          <NumberField
            key={side}
            id={`f-${k}-${side}`}
            spec={{ ...spec, label: `${spec.label}${isHalf ? ' (half)' : ''}, wearer's ${side}` }}
            value={params[side][k]}
            onCommit={(v, g) => setSide(side, k, v, g)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="controls">
      <label className="toggle" title="When on, both sides change together. Turn off for asymmetric designs.">
        <input
          type="checkbox"
          checked={params.mirror}
          onChange={(e) => {
            const next = cloneParams(params);
            next.mirror = e.target.checked;
            if (next.mirror) next.right = { ...next.left }; // re-symmetrise from the wearer's left
            propose(next, `mirror:${Date.now()}`);
          }}
        />
        Symmetric (mirror left and right)
      </label>
      {!params.mirror && <p className="note">Asymmetric mode: each side has its own values. Turning symmetry back on copies the wearer's left side onto the right.</p>}
      {message && <p className="error" role="alert">{message}</p>}

      {GROUPS.map((g) => (
        <details key={g.id} open={g.open}>
          <summary>{g.title}</summary>
          {g.id === 'body' && (
            <div className="field">
              <label htmlFor="f-hemStyle">{'Hem shape'}</label>
              <select
                id="f-hemStyle"
                value={params.core.hemStyle}
                onChange={(e) => {
                  const next = cloneParams(params);
                  next.core.hemStyle = e.target.value as HemStyle;
                  propose(next, `hemStyle:${Date.now()}`);
                }}
              >
                {HEM_STYLES.map((s) => <option key={s} value={s}>{HEM_LABELS[s]}</option>)}
              </select>
            </div>
          )}
          {g.id === 'neck' && (
            <div className="field">
              <label htmlFor="f-neckStyle">{'Neckline style'}</label>
              <select
                id="f-neckStyle"
                value={params.core.neckStyle}
                onChange={(e) => {
                  const next = cloneParams(params);
                  next.core.neckStyle = e.target.value as NeckStyle;
                  propose(next, `neckStyle:${Date.now()}`);
                }}
              >
                {NECK_STYLES.map((s) => <option key={s} value={s}>{NECK_LABELS[s]}</option>)}
              </select>
            </div>
          )}
          {g.core.map((k) => (
            <NumberField key={k} id={`f-${k}`} spec={CORE_FIELDS[k]} value={params.core[k]} onCommit={(v, gst) => setCore(k, v, gst)} />
          ))}
          {g.side.map(sideField)}
        </details>
      ))}
    </div>
  );
}
