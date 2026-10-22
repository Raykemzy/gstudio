import { useState } from 'react';
import type { FieldSpec, Side } from '../model/schema';
import { cloneGarment, garmentDef, type GarmentParams } from '../garments';

interface Props {
  params: GarmentParams;
  /** Propose new params. Returns an error message if rejected. `key` groups a gesture into one undo step. */
  onChange: (next: GarmentParams, key: string) => string | null;
}

// Field values are addressed by key; each garment's form spec says which keys exist.
type Bag = Record<string, number | string | boolean>;

/** A slider plus a typed number box. `factor` scales stored half-widths to the full width shown to the user. */
function NumberField({ spec, value, factor = 1, unit = 'cm', onCommit, id }: { spec: FieldSpec; value: number; factor?: number; unit?: string; onCommit: (v: number, gesture: boolean) => void; id: string }) {
  const display = Math.round(value * factor * 100) / 100;
  // While typing, keep a local draft; otherwise always show the model value (so rejected edits snap back).
  const [draft, setDraft] = useState<string | null>(null);
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
  const form = garmentDef(params).form;
  const propose = (next: GarmentParams, key: string) => setMessage(onChange(next, key));
  const core = params.core as Bag;
  const sideBag = (side: Side) => params[side] as Record<string, number>;
  const unitOf = (k: string) => (form.degreeKeys?.has(k) ? '°' : 'cm');

  const setCore = (k: string, v: number | string | boolean, key: string) => {
    const next = cloneGarment(params);
    (next.core as Bag)[k] = v;
    propose(next, key);
  };
  const setSide = (side: Side | 'both', k: string, v: number, gesture: boolean) => {
    const next = cloneGarment(params);
    const l = next.left as Record<string, number>, r = next.right as Record<string, number>;
    if (side === 'both') l[k] = r[k] = v;
    else (side === 'left' ? l : r)[k] = v;
    propose(next, gesture ? `side:${side}:${k}` : `side:${side}:${k}:${Date.now()}`);
  };

  const sideField = (k: string) => {
    const spec = form.sideFields[k];
    const isHalf = form.halfWidthKeys.has(k);
    if (params.mirror) {
      return (
        <NumberField key={k} id={`f-${k}`} spec={spec} unit={unitOf(k)} value={sideBag('left')[k]} factor={isHalf ? 2 : 1} onCommit={(v, g) => setSide('both', k, v, g)} />
      );
    }
    return (
      <div key={k} className="side-pair">
        {(['right', 'left'] as Side[]).map((side) => (
          <NumberField
            key={side}
            id={`f-${k}-${side}`}
            spec={{ ...spec, label: `${spec.label}${isHalf ? ' (half)' : ''}, wearer's ${side}` }}
            unit={unitOf(k)}
            value={sideBag(side)[k]}
            onCommit={(v, g) => setSide(side, k, v, g)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="controls">
      {!params.mirror && <p className="note">Asymmetric: each side has its own values (wearer's left and right). Switch back with the Symmetric button above the garment.</p>}
      {message && <p className="error" role="alert">{message}</p>}

      {form.groups.map((g) => (
        <details key={g.id} open={g.open}>
          <summary>{g.title}</summary>
          {(g.enums ?? []).map((k) => (
            <div className="field" key={k}>
              <label htmlFor={`f-${k}`}>{form.enums[k].label}</label>
              <select id={`f-${k}`} value={String(core[k])} onChange={(e) => setCore(k, e.target.value, `${k}:${Date.now()}`)}>
                {form.enums[k].options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ))}
          {g.core.map((k) => (
            <NumberField key={k} id={`f-${k}`} spec={form.coreFields[k]} unit={unitOf(k)} value={core[k] as number} onCommit={(v, gst) => setCore(k, v, gst ? `core:${k}` : `core:${k}:${Date.now()}`)} />
          ))}
          {g.side.map(sideField)}
          {(g.toggles ?? []).map((k) => (
            <label className="toggle" key={k}>
              <input type="checkbox" checked={Boolean(core[k])} onChange={(e) => setCore(k, e.target.checked, `${k}:${Date.now()}`)} /> {form.toggles[k].label}
            </label>
          ))}
        </details>
      ))}
    </div>
  );
}
