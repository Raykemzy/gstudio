import { useMemo, useState } from 'react';
import { garmentPoms, type GarmentParams } from '../garments';
import { SIZES, formatMeasure, graded, type Size, type Unit } from '../model/pom';

interface Props {
  params: GarmentParams;
  unit: Unit;
  base: Size;
  onUnit: (u: Unit) => void;
  onBase: (s: Size) => void;
  onDownload: () => void;
}

export function MeasurementSheet({ params, unit, base, onUnit, onBase, onDownload }: Props) {
  const poms = useMemo(() => garmentPoms(params), [params]);
  const [allSizes, setAllSizes] = useState(false);
  const cols: Size[] = allSizes ? [...SIZES] : [base];

  return (
    <div className="measure-sheet">
      <p className="note">
        Finished measurements laid flat, as a factory measures a sample. Your design is the <strong>{base}</strong>; other sizes are graded from it with
        typical steps. Agree tolerances and grading with your factory.
      </p>
      <div className="gen-row">
        <div className="segmented" role="group" aria-label="Units">
          <button className={unit === 'cm' ? 'on' : ''} onClick={() => onUnit('cm')}>cm</button>
          <button className={unit === 'in' ? 'on' : ''} onClick={() => onUnit('in')}>in</button>
        </div>
        <label className="small-label">
          Sample size{' '}
          <select value={base} onChange={(e) => onBase(e.target.value as Size)} aria-label="Sample size">
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="toggle small-label">
          <input type="checkbox" checked={allSizes} onChange={(e) => setAllSizes(e.target.checked)} /> All sizes
        </label>
      </div>
      <div className={`table-scroll${allSizes ? ' wide' : ''}`}>
        <table>
          <thead>
            <tr>
              <th>POM</th>
              <th>Measure</th>
              {cols.map((s) => <th key={s} className={s === base ? 'base' : ''}>{s}</th>)}
              <th title="Allowed difference on a sample">±</th>
            </tr>
          </thead>
          <tbody>
            {poms.map((m) => (
              <tr key={m.code}>
                <td className="code">{m.code}</td>
                <td title={m.howToMeasure}>
                  {m.name}
                  {!allSizes && <small>{m.howToMeasure}</small>}
                </td>
                {cols.map((s) => <td key={s} className={`num${s === base ? ' base' : ''}`}>{formatMeasure(graded(m, s, base), unit)}</td>)}
                <td className="num">{formatMeasure(m.tolerance, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        {params.kind === 'tshirt' && 'HPS = high point shoulder, the top of the shoulder beside the neck. '}L / R = wearer's left / right.
      </p>
      <button className="small" onClick={onDownload}>Download spec sheet (.csv for Excel / Sheets)</button>
    </div>
  );
}
