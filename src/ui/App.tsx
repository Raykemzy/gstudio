import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cloneParams, newDesign, newId, paramsEqual, type DesignRecord, type TShirtParams } from '../model/schema';
import { validateParams, type Issue } from '../model/validate';
import { applyHandleDrag, type Handle } from '../geometry/handles';
import type { NeckSurface } from '../geometry/outline';
import { History } from '../state/history';
import { DesignStore, MemoryStorage, StorageFullError, type DesignSummary } from '../state/store';
import { duplicateDesign, parseDesign, serializeDesign } from '../state/designFile';
import { buildExportSvg, downloadBlob, safeFilename, svgToPngBlob } from '../render/exportImage';
import { fetchAiStatus, generateConcept, type AiStatus, type GeneratorKind } from '../ai/generate';
import type { AppliedProposal } from '../ai/proposal';
import { Editor2D } from './Editor2D';
import { Preview3D, type Preview3DApi } from './Preview3D';
import { Controls } from './Controls';
import { PresetGallery } from './PresetGallery';
import { PRESETS, findPreset } from '../model/presets';

const LAST_OPEN_KEY = 'garment-studio:last-open';
const GALLERY_SEEN_KEY = 'garment-studio:gallery-seen';

function openStorage(): { storage: Storage; persistent: boolean } {
  try {
    const s = window.localStorage;
    s.setItem('garment-studio:probe', '1');
    s.removeItem('garment-studio:probe');
    return { storage: s, persistent: true };
  } catch {
    return { storage: new MemoryStorage(), persistent: false };
  }
}

interface Saved {
  params: TShirtParams;
  name: string;
  imageKey: string | null;
}

type Notice = { kind: 'info' | 'error'; text: string } | null;

function initialDesign(store: DesignStore, storage: Storage): { design: DesignRecord; saved: Saved | null; warnings: Issue[]; image: string | null } {
  const lastId = storage.getItem(LAST_OPEN_KEY);
  const candidates = [lastId, store.list()[0]?.id].filter(Boolean) as string[];
  for (const id of candidates) {
    const r = store.load(id);
    if (r.ok) {
      const d = r.design;
      return {
        design: d,
        saved: { params: d.params, name: d.name, imageKey: d.referenceImage?.key ?? null },
        warnings: r.warnings,
        image: d.referenceImage ? store.loadImage(d.referenceImage.key) : null,
      };
    }
  }
  return { design: newDesign(PRESETS[0].params(), 'Untitled tee', { kind: 'preset' }), saved: null, warnings: [], image: null };
}

export function App() {
  const { storage, persistent } = useMemo(openStorage, []);
  const store = useMemo(() => new DesignStore(storage), [storage]);
  const init = useMemo(() => initialDesign(store, storage), [store, storage]);

  const history = useRef(new History<TShirtParams>(init.design.params));
  const [params, setParams] = useState<TShirtParams>(init.design.params);
  const [design, setDesign] = useState<DesignRecord>(init.design);
  const [saved, setSaved] = useState<Saved | null>(init.saved);
  const [image, setImage] = useState<string | null>(init.image);
  const [warnings, setWarnings] = useState<Issue[]>(init.warnings);
  const [list, setList] = useState<DesignSummary[]>(() => store.list());
  const [surface, setSurface] = useState<NeckSurface>('front');
  const [compareId, setCompareId] = useState<string>('');
  const [notice, setNotice] = useState<Notice>(
    persistent ? null : { kind: 'error', text: 'Browser storage is unavailable, so designs will not survive a reload. Use "Download .json" to keep your work.' },
  );
  const [, bump] = useState(0); // re-render after history changes that don't change params identity
  const preview = useRef<Preview3DApi | null>(null);

  const dirty = !saved || !paramsEqual(params, saved.params) || design.name !== saved.name || (design.referenceImage?.key ?? null) !== saved.imageKey;
  const refreshList = useCallback(() => setList(store.list()), [store]);

  // ----- editing -----

  /** The single entry point for every edit (controls, handles, mirror toggle). */
  const commit = useCallback(
    (next: TShirtParams, key: string): string | null => {
      const issues = validateParams(next);
      // A valid design is never allowed to become invalid. A design that was loaded already broken can be edited freely while it is being fixed.
      if (issues.length && validateParams(history.current.present).length === 0) return issues[0].message;
      history.current.commit(next, key);
      setParams(next);
      setWarnings(issues);
      return null;
    },
    [],
  );

  const onDrag = useCallback(
    (handle: Handle, pointer: { x: number; y: number }, gesture: string) => commit(applyHandleDrag(history.current.present, handle, pointer, surface), gesture),
    [commit, surface],
  );

  const undo = useCallback(() => {
    const p = history.current.undo();
    setParams(p);
    setWarnings(validateParams(p));
    bump((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const p = history.current.redo();
    setParams(p);
    setWarnings(validateParams(p));
    bump((n) => n + 1);
  }, []);

  // ----- design lifecycle -----

  const confirmDiscard = () => !dirty || window.confirm('You have unsaved changes to this design. Discard them?');

  const openRecord = (d: DesignRecord, s: Saved | null, img: string | null, w: Issue[] = validateParams(d.params)) => {
    history.current.reset(cloneParams(d.params));
    setParams(history.current.present);
    setDesign(d);
    setSaved(s);
    setImage(img);
    setWarnings(w);
    setCompareId('');
    if (s) storage.setItem(LAST_OPEN_KEY, d.id);
  };

  const openSaved = (id: string) => {
    if (id === design.id || !confirmDiscard()) return;
    const r = store.load(id);
    if (!r.ok) return setNotice({ kind: 'error', text: r.error });
    const d = r.design;
    openRecord(d, { params: d.params, name: d.name, imageKey: d.referenceImage?.key ?? null }, d.referenceImage ? store.loadImage(d.referenceImage.key) : null, r.warnings);
    setNotice(r.warnings.length ? { kind: 'error', text: 'This design opened, but has geometry problems listed below. Edit it to fix them.' } : null);
  };

  // First visit: offer the starter shapes straight away (once per browser).
  const [galleryOpen, setGalleryOpen] = useState(() => list.length === 0 && !storage.getItem(GALLERY_SEEN_KEY));
  useEffect(() => {
    if (galleryOpen) storage.setItem(GALLERY_SEEN_KEY, '1');
  }, [galleryOpen, storage]);

  const newFromPreset = (presetId: string) => {
    if (!confirmDiscard()) return;
    const pr = findPreset(presetId)!;
    setGalleryOpen(false);
    openRecord(newDesign(pr.params(), pr.id === 'classic' ? 'Untitled tee' : pr.name, { kind: 'preset' }), null, null);
    setNotice({ kind: 'info', text: `New design from "${pr.name}". It isn't saved until you press Save.` });
  };

  const persist = (d: DesignRecord, img: string | null): DesignRecord | null => {
    try {
      if (d.referenceImage && img) store.saveImage(d.referenceImage.key, img);
      return store.save(d);
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof StorageFullError ? e.message : `Save failed: ${(e as Error).message}` });
      return null;
    }
  };

  const save = () => {
    const out = persist({ ...design, params: cloneParams(params) }, image);
    if (!out) return;
    if (saved?.imageKey && saved.imageKey !== out.referenceImage?.key) store.deleteImage(saved.imageKey);
    setDesign(out);
    setSaved({ params: out.params, name: out.name, imageKey: out.referenceImage?.key ?? null });
    storage.setItem(LAST_OPEN_KEY, out.id);
    refreshList();
    setNotice({ kind: 'info', text: `Saved "${out.name}".` });
  };

  /** Save the current edits as a NEW design, leaving the original as it was last saved. */
  const saveAsCopy = () => {
    const copy = duplicateDesign({ ...design, params: cloneParams(params) }, `${design.name} v${design.lineage.iteration + 1}`);
    if (copy.referenceImage) copy.referenceImage = { ...copy.referenceImage, key: newId() };
    const out = persist(copy, image);
    if (!out) return;
    openRecord(out, { params: out.params, name: out.name, imageKey: out.referenceImage?.key ?? null }, image);
    refreshList();
    setNotice({ kind: 'info', text: saved ? `Saved as a new design "${out.name}". The original is unchanged.` : `Saved as "${out.name}".` });
  };

  const duplicateSaved = (id: string) => {
    const r = store.load(id);
    if (!r.ok) return setNotice({ kind: 'error', text: r.error });
    const copy = duplicateDesign(r.design);
    const img = r.design.referenceImage ? store.loadImage(r.design.referenceImage.key) : null;
    if (copy.referenceImage) copy.referenceImage = { ...copy.referenceImage, key: newId() };
    if (persist(copy, img)) {
      refreshList();
      setNotice({ kind: 'info', text: `Duplicated as "${copy.name}". The original is unchanged.` });
    }
  };

  const deleteSaved = (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}" permanently? This cannot be undone.`)) return;
    store.delete(id);
    if (id === design.id) setSaved(null);
    if (compareId === id) setCompareId('');
    refreshList();
  };

  /** Symmetric copies the wearer's left side onto the right; undo brings the asymmetric version back. */
  const setMirror = (on: boolean) => {
    if (on === params.mirror) return;
    const next = cloneParams(params);
    next.mirror = on;
    const differed = JSON.stringify(next.left) !== JSON.stringify(next.right);
    if (on) next.right = { ...next.left };
    const err = commit(next, `mirror:${Date.now()}`);
    if (err) return setNotice({ kind: 'error', text: `Can't make it symmetric: ${err}` });
    setNotice(
      on
        ? differed
          ? { kind: 'info', text: "Now symmetric: the wearer's left side was copied onto the right. Press Undo to get the asymmetric version back." }
          : null
        : { kind: 'info', text: 'Now asymmetric: each side can be edited on its own.' },
    );
  };

  // ----- files -----

  const exportJson = () =>
    downloadBlob(new Blob([serializeDesign({ ...design, params })], { type: 'application/json' }), `${safeFilename(design.name)}.garment.json`);

  const importJson = async (file: File) => {
    if (!confirmDiscard()) return;
    const r = parseDesign(await file.text());
    if (!r.ok) return setNotice({ kind: 'error', text: `Import failed: ${r.error}` });
    // Imported designs get a fresh id so they can never overwrite an existing one.
    const d: DesignRecord = { ...r.design, id: newId(), origin: { ...r.design.origin, kind: 'import' }, referenceImage: null };
    openRecord(d, null, null, r.warnings);
    setNotice({ kind: 'info', text: `Imported "${d.name}". Press Save to keep it.` });
  };

  const export2D = async (kind: 'png' | 'svg') => {
    const svg = buildExportSvg(params, surface, design.name);
    const name = `${safeFilename(design.name)}-${surface}`;
    if (kind === 'svg') return downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
    try {
      downloadBlob(await svgToPngBlob(svg), `${name}.png`);
    } catch (e) {
      setNotice({ kind: 'error', text: `PNG export failed: ${(e as Error).message}` });
    }
  };

  const export3D = async () => {
    const blob = await preview.current?.capturePng();
    if (blob) downloadBlob(blob, `${safeFilename(design.name)}-3d.png`);
    else setNotice({ kind: 'error', text: '3D export is unavailable (no WebGL).' });
  };

  const attachImage = async (file: File) => {
    try {
      const { dataUrl, width, height } = await downscaleImage(file, 1024);
      setImage(dataUrl);
      setDesign((d) => ({ ...d, referenceImage: { key: newId(), name: file.name, mime: 'image/jpeg', width, height } }));
    } catch {
      setNotice({ kind: 'error', text: 'That file could not be read as an image.' });
    }
  };

  // ----- AI / offline generation -----

  const [ai, setAi] = useState<AiStatus>({ available: false });
  const [generator, setGenerator] = useState<GeneratorKind>('offline');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(AppliedProposal & { source: GeneratorKind; prompt: string }) | { error: string } | null>(null);
  useEffect(() => {
    fetchAiStatus().then((s) => {
      setAi(s);
      if (s.available) setGenerator('ai');
    });
  }, []);

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setResult(null);
    const r = await generateConcept(prompt, generator);
    setBusy(false);
    setResult(r.ok ? { ...r, prompt } : { error: r.error });
  };

  const openGenerated = () => {
    if (!result || 'error' in result || !confirmDiscard()) return;
    const d = newDesign(result.params, result.name, {
      kind: result.source === 'ai' ? 'ai' : 'offline-interpreter',
      prompt: result.prompt,
      notes: [...result.notes, ...result.unsupported.map((u) => `Not represented: ${u}`)],
    });
    openRecord(d, null, null);
    setResult(null);
    setNotice({ kind: 'info', text: `Opened "${d.name}" as a new, editable design. Press Save to keep it.` });
  };

  // ----- keyboard & unload -----

  const actions = useRef({ undo, redo, save });
  actions.current = { undo, redo, save };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.matches('textarea, input[type=text], input[type=number], input:not([type])')) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) actions.current.undo();
      else if ((k === 'z' && e.shiftKey) || k === 'y') actions.current.redo();
      else if (k === 's') actions.current.save();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const compare = useMemo(() => {
    if (!compareId) return null;
    const r = store.load(compareId);
    return r.ok ? { params: r.design.params, name: r.design.name } : null;
  }, [compareId, store, list]);

  // ----- layout -----

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">Garment Studio</strong>
        <input
          className="name"
          aria-label="Design name"
          value={design.name}
          onChange={(e) => setDesign((d) => ({ ...d, name: e.target.value.slice(0, 80) }))}
          onBlur={(e) => !e.target.value.trim() && setDesign((d) => ({ ...d, name: 'Untitled tee' }))}
        />
        <span className={`status ${dirty ? 'dirty' : ''}`}>{!saved ? 'Not saved yet' : dirty ? 'Unsaved changes' : 'Saved'}</span>
        <div className="spacer" />
        <button onClick={() => setGalleryOpen(true)} title="Start a new design from a shape">New</button>
        <button onClick={undo} disabled={!history.current.canUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={redo} disabled={!history.current.canRedo} title="Redo (Ctrl+Shift+Z)">Redo</button>
        <button className="primary" onClick={save} title="Save (Ctrl+S)">Save</button>
        <button onClick={saveAsCopy} title="Save the current edits as a new design, keeping the original">Save as copy</button>
      </header>

      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          {notice.text}
          <button className="link" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="workspace">
        <aside className="left">
          <section>
            <h2>Adjust</h2>
            <Controls params={params} onChange={commit} />
          </section>
        </aside>

        <main className="centre">
          <div className="view-toolbar">
            <div className="segmented" role="group" aria-label="View">
              <button className={surface === 'front' ? 'on' : ''} onClick={() => setSurface('front')}>Front</button>
              <button className={surface === 'back' ? 'on' : ''} onClick={() => setSurface('back')}>Back</button>
            </div>
            <div className="segmented" role="group" aria-label="Symmetry" title="Symmetric: both sides change together. Asymmetric: edit each side separately.">
              <button className={params.mirror ? 'on' : ''} onClick={() => setMirror(true)} aria-pressed={params.mirror}>Symmetric</button>
              <button className={!params.mirror ? 'on' : ''} onClick={() => setMirror(false)} aria-pressed={!params.mirror}>Asymmetric</button>
            </div>
            <label>
              Compare with{' '}
              <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
                <option value="">(nothing)</option>
                {list.filter((s) => s.id !== design.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="spacer" />
            <button onClick={() => export2D('png')}>Export PNG</button>
            <button onClick={() => export2D('svg')}>Export SVG</button>
          </div>
          {warnings.length > 0 && (
            <div className="warnings" role="alert">
              <strong>This shape has problems:</strong>
              <ul>{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            </div>
          )}
          <Editor2D params={params} surface={surface} compare={compare} onDrag={onDrag} onDragEnd={() => bump((n) => n + 1)} />
        </main>

        <aside className="right">
          <section className="preview-section">
            <h2>3D preview <button className="small" onClick={export3D}>Export PNG</button></h2>
            <Preview3D params={params} apiRef={preview} designKey={design.id} />
          </section>

          <section>
            <h2>Generate a concept</h2>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. An oversized boxy tee with dropped shoulders, short wide sleeves and a deep but narrow neckline."
            />
            <div className="gen-row">
              <select value={generator} onChange={(e) => setGenerator(e.target.value as GeneratorKind)} aria-label="Generator">
                <option value="ai" disabled={!ai.available}>AI ({ai.available ? `${ai.provider} · ${ai.model}` : 'no API key configured'})</option>
                <option value="offline">Offline keyword matcher (not AI)</option>
              </select>
              <button className="primary" onClick={generate} disabled={busy || !prompt.trim()}>{busy ? 'Generating…' : 'Generate'}</button>
            </div>
            {!ai.available && <p className="note">AI generation is off (no key on the server). The offline matcher understands common garment words. Everything else works without AI.</p>}
            {result && 'error' in result && <p className="error">{result.error}</p>}
            {result && !('error' in result) && (
              <div className="gen-result">
                <strong>{result.name}</strong> <small>({result.source === 'ai' ? 'AI' : 'offline matcher'})</small>
                {result.summary && <p>{result.summary}</p>}
                {result.unsupported.length > 0 && (
                  <>
                    <p className="label">Not represented in the design:</p>
                    <ul>{result.unsupported.map((u, i) => <li key={i}>{u}</li>)}</ul>
                  </>
                )}
                {result.notes.length > 0 && (
                  <>
                    <p className="label">Adjusted to keep the shape valid:</p>
                    <ul>{result.notes.map((u, i) => <li key={i}>{u}</li>)}</ul>
                  </>
                )}
                <div className="gen-row">
                  <button className="primary" onClick={openGenerated}>Open as new design</button>
                  <button onClick={() => setResult(null)}>Discard</button>
                </div>
              </div>
            )}
          </section>

          <section>
            <h2>Saved designs</h2>
            {list.length === 0 && <p className="note">Nothing saved yet.</p>}
            <ul className="design-list">
              {list.map((s) => (
                <li key={s.id} className={s.id === design.id ? 'current' : ''}>
                  <button className="link name" onClick={() => openSaved(s.id)} title="Open">{s.name}</button>
                  <small>v{s.iteration} · {new Date(s.updatedAt).toLocaleString()}</small>
                  <span className="row-actions">
                    <button className="small" onClick={() => duplicateSaved(s.id)}>Duplicate</button>
                    <button className="small" onClick={() => deleteSaved(s.id, s.name)}>Delete</button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="gen-row">
              <button className="small" onClick={exportJson}>Download .json</button>
              <label className="file-button small">
                Import .json
                <input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importJson(f); }} />
              </label>
            </div>
          </section>

          <section>
            <h2>Reference image</h2>
            {image ? (
              <div className="reference">
                <img src={image} alt={design.referenceImage?.name ?? 'Reference'} />
                <button className="small" onClick={() => { setImage(null); setDesign((d) => ({ ...d, referenceImage: null })); }}>Remove</button>
              </div>
            ) : (
              <label className="file-button small">
                Attach image…
                <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attachImage(f); }} />
              </label>
            )}
            <p className="note">Stored with the design for reference only. It isn't analysed.</p>
          </section>

          {design.origin.prompt && (
            <section>
              <h2>Origin</h2>
              <p className="note">Generated from: “{design.origin.prompt}”</p>
            </section>
          )}
        </aside>
      </div>
      {galleryOpen && <PresetGallery onPick={newFromPreset} onClose={() => setGalleryOpen(false)} />}
    </div>
  );
}

async function downscaleImage(file: File, maxSide: number): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height };
}
