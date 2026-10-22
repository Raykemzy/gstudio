import { useEffect, useMemo, useRef, useState } from 'react';
import type { TShirtParams } from '../model/schema';
import { clampPanelPoint, fromModel, type Panel } from '../model/style';
import type { NeckSurface } from '../geometry/outline';
import { getHandles, type Handle } from '../geometry/handles';
import { bounds, type Vec } from '../geometry/polygon';
import { garmentPaths, toView, viewSign } from '../render/paths';
import { flatView, panelFrame, panelModelPoints, panelPath } from '../render/layers';

interface Props {
  params: TShirtParams;
  surface: NeckSurface;
  /** Outline of another saved design to overlay for comparison. */
  compare?: { params: TShirtParams; name: string } | null;
  /** Called for every pointer move during a drag. Returns an error message if the move was rejected. */
  onDrag: (handle: Handle, pointer: { x: number; y: number }, gestureId: string) => string | null;
  onDragEnd: () => void;
  /** Panel editing. */
  selectedPanelId: string | null;
  selectedPoint: number | null;
  onSelectPanel: (id: string | null) => void;
  onSelectPoint: (index: number | null) => void;
  onPanelChange: (panel: Panel, gestureId: string) => void;
}

const GRID = 10;
const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

type Drag = { kind: 'handle'; handle: Handle; gesture: string } | { kind: 'point'; panel: Panel; index: number; gesture: string };

export function Editor2D(props: Props) {
  const { params, surface, compare, onDrag, onDragEnd, selectedPanelId, selectedPoint, onSelectPanel, onSelectPoint, onPanelChange } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Handle | null>(null);
  const [blocked, setBlocked] = useState(false);
  const frozenBox = useRef<string | null>(null);
  const [, setMeasured] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(() => setMeasured((n) => n + 1));
    if (svgRef.current) ro.observe(svgRef.current);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => flatView(params, surface), [params, surface]);
  const comparePaths = useMemo(() => (compare ? garmentPaths(compare.params, surface) : null), [compare, surface]);
  const handles = useMemo(() => getHandles(params, surface), [params, surface]);
  const panel = params.style.panels.find((p) => p.id === selectedPanelId) ?? null;
  const editingPanel = panel && panel.surface === surface ? panel : null;
  const frame = panelFrame(params);

  // Fit the view to the garment, snapped to the grid so small edits don't make it jump.
  // While dragging, the view is frozen so the point stays under the pointer.
  const fitted = useMemo(() => {
    const b = comparePaths
      ? bounds([
          { x: view.bounds.minX, y: view.bounds.minY }, { x: view.bounds.maxX, y: view.bounds.maxY },
          { x: comparePaths.bounds.minX, y: comparePaths.bounds.minY }, { x: comparePaths.bounds.maxX, y: comparePaths.bounds.maxY },
        ])
      : view.bounds;
    const half = Math.ceil((Math.max(Math.abs(b.minX), Math.abs(b.maxX)) + 12) / GRID) * GRID;
    const top = Math.floor((Math.min(b.minY, 0) - 12) / GRID) * GRID;
    const bottom = Math.ceil((b.maxY + 14) / GRID) * GRID;
    return { x: -half, y: top, w: 2 * half, h: bottom - top };
  }, [view, comparePaths]);
  const viewBox = drag && frozenBox.current ? frozenBox.current : `${fitted.x} ${fitted.y} ${fitted.w} ${fitted.h}`;
  const [vx, vy, vw, vh] = viewBox.split(' ').map(Number);
  const r = vw / 95; // handle radius in cm, roughly constant on screen
  // Fingers need a bigger target than a mouse: an invisible ring at least ~44px (touch) / 20px (mouse) across.
  const svgEl = svgRef.current;
  const pxPerCm = svgEl ? Math.min(svgEl.clientWidth / vw, svgEl.clientHeight / vh) || 1 : 1;
  const hitR = Math.max(r * 1.6, (coarsePointer ? 22 : 10) / pxPerCm);
  const strokePx = (weight = 1) => 2 * weight;

  const toModel = (e: React.PointerEvent): Vec => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return { x: pt.x * viewSign(surface), y: pt.y };
  };

  const begin = (e: React.PointerEvent, d: Drag) => {
    e.preventDefault();
    e.stopPropagation();
    svgRef.current!.setPointerCapture(e.pointerId);
    frozenBox.current = `${fitted.x} ${fitted.y} ${fitted.w} ${fitted.h}`;
    setDrag(d);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const m = toModel(e);
    if (drag.kind === 'handle') {
      setBlocked(onDrag(drag.handle, m, drag.gesture) !== null);
    } else {
      const points = drag.panel.points.slice();
      points[drag.index] = clampPanelPoint(fromModel(m, frame));
      const next = { ...drag.panel, points };
      setDrag({ ...drag, panel: next });
      onPanelChange(next, drag.gesture);
    }
  };
  const end = () => {
    if (!drag) return;
    setDrag(null);
    setBlocked(false);
    frozenBox.current = null;
    onDragEnd();
  };

  /** Clicking a "+" between two points inserts a point there and starts dragging it. */
  const insertPoint = (e: React.PointerEvent, p: Panel, afterIndex: number, at: Vec) => {
    const points = p.points.slice();
    points.splice(afterIndex + 1, 0, clampPanelPoint(fromModel(at, frame)));
    const next = { ...p, points };
    const gesture = `panel-${p.id}-${Date.now()}`;
    onPanelChange(next, gesture);
    onSelectPoint(afterIndex + 1);
    begin(e, { kind: 'point', panel: next, index: afterIndex + 1, gesture });
  };

  const gridLines = [];
  for (let x = Math.ceil(vx / GRID) * GRID; x <= vx + vw; x += GRID)
    gridLines.push(<line key={`x${x}`} x1={x} y1={vy} x2={x} y2={vy + vh} className={x === 0 ? 'grid centre' : 'grid'} />);
  for (let y = Math.ceil(vy / GRID) * GRID; y <= vy + vh; y += GRID)
    gridLines.push(<line key={`y${y}`} x1={vx} y1={y} x2={vx + vw} y2={y} className={y === 0 ? 'grid centre' : 'grid'} />);

  const leftHem = toView(handles.find((h) => h.id === 'hemSide:left')!.pos, surface);
  const rightHem = toView(handles.find((h) => h.id === 'hemSide:right')!.pos, surface);
  const shownHandle = drag?.kind === 'handle' ? drag.handle : hover;
  const clipId = `garment-clip-${surface}`;

  let hint: string;
  if (editingPanel) hint = 'Drag the squares to reshape the panel. Tap a + to add a point. Tap outside the garment to finish.';
  else if (panel) hint = `“${panel.name}” is on the ${panel.surface}. Switch to the ${panel.surface === 'front' ? 'Front' : 'Back'} view to edit it.`;
  else if (shownHandle) hint = shownHandle.label;
  else hint = 'Drag the dots to reshape the garment. Tap a panel to edit it.';

  // Panel edit overlay (primary copy only; the mirror copy follows).
  const editPoints = editingPanel ? panelModelPoints(editingPanel, frame).map((v) => toView(v, surface)) : [];

  return (
    <div className="editor2d">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerDown={() => {
          // A tap on empty canvas finishes panel editing.
          if (selectedPanelId) onSelectPanel(null);
        }}
        role="img"
        aria-label={`${surface} view of the garment`}
      >
        {gridLines}
        <text x={vx + r} y={vy + vh - r} className="scale-label" fontSize={r * 1.6}>grid = 10 cm</text>
        {comparePaths && <path d={comparePaths.outline} className="compare" />}
        <clipPath id={clipId}><path d={view.clip} /></clipPath>
        <clipPath id={`${clipId}-body`}><path d={view.bodyClip} /></clipPath>
        {view.layers.map((l, i) => (
          <path
            key={i}
            d={l.d}
            fill={l.fill ?? 'none'}
            stroke={l.stroke}
            strokeWidth={l.stroke ? strokePx(l.weight) : undefined}
            strokeDasharray={l.dashed ? '5 4' : undefined}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            clipPath={l.clipped ? `url(#${clipId}${l.bodyOnly ? '-body' : ''})` : undefined}
            className={l.kind === 'panel' ? `panel-shape${l.panelId === selectedPanelId ? ' selected' : ''}` : undefined}
            data-panel={l.kind === 'panel' ? l.panelId : undefined}
            pointerEvents={l.kind === 'panel' ? 'visiblePainted' : 'none'}
            onPointerDown={
              l.kind === 'panel'
                ? (e) => {
                    e.stopPropagation();
                    onSelectPanel(l.panelId!);
                    onSelectPoint(null);
                  }
                : undefined
            }
          />
        ))}
        {!editingPanel && (
          <>
            <text x={leftHem.x} y={leftHem.y + r * 3.5} fontSize={r * 1.7} className="side-label" textAnchor="middle">wearer's L</text>
            <text x={rightHem.x} y={rightHem.y + r * 3.5} fontSize={r * 1.7} className="side-label" textAnchor="middle">wearer's R</text>
          </>
        )}

        {editingPanel && (
          <g className="panel-edit">
            <path d={panelPath(editingPanel, frame, surface)} className="panel-outline" vectorEffect="non-scaling-stroke" />
            {editingPanel.mirrored && <path d={panelPath(editingPanel, frame, surface, true)} className="panel-outline mirror" vectorEffect="non-scaling-stroke" />}
            {editingPanel.points.length < 24 &&
              editPoints.map((v, i) => {
                const w = editPoints[(i + 1) % editPoints.length];
                const mid = { x: (v.x + w.x) / 2, y: (v.y + w.y) / 2 };
                return (
                  <g key={`m${i}`} className="panel-add" onPointerDown={(e) => insertPoint(e, editingPanel, i, { x: mid.x * viewSign(surface), y: mid.y })}>
                    <title>Add a point here</title>
                    <circle cx={mid.x} cy={mid.y} r={hitR} className="hit" />
                    <circle cx={mid.x} cy={mid.y} r={r * 0.7} className="dot" />
                    <path d={`M${mid.x - r * 0.4} ${mid.y}H${mid.x + r * 0.4}M${mid.x} ${mid.y - r * 0.4}V${mid.y + r * 0.4}`} className="plus" />
                  </g>
                );
              })}
            {editPoints.map((v, i) => (
              <g
                key={`p${i}`}
                className={`panel-point${selectedPoint === i ? ' selected' : ''}`}
                data-point={i}
                onPointerDown={(e) => {
                  onSelectPoint(i);
                  begin(e, { kind: 'point', panel: editingPanel, index: i, gesture: `panel-${editingPanel.id}-${Date.now()}` });
                }}
              >
                <title>Drag to reshape the panel</title>
                <circle cx={v.x} cy={v.y} r={hitR} className="hit" />
                <rect x={v.x - r} y={v.y - r} width={2 * r} height={2 * r} className="dot" />
              </g>
            ))}
          </g>
        )}

        {!selectedPanelId &&
          handles.map((h) => {
            const v = toView(h.pos, surface);
            const isActive = drag?.kind === 'handle' && drag.handle.id === h.id;
            return (
              <g
                key={h.id}
                className={`handle${isActive ? ' active' : ''}${isActive && blocked ? ' blocked' : ''}`}
                onPointerDown={(e) => begin(e, { kind: 'handle', handle: h, gesture: `${h.id}-${Date.now()}` })}
                onPointerEnter={() => setHover(h)}
                onPointerLeave={() => setHover((cur) => (cur?.id === h.id ? null : cur))}
                data-handle={h.id}
              >
                <title>{h.label}</title>
                <circle cx={v.x} cy={v.y} r={hitR} className="hit" />
                <circle cx={v.x} cy={v.y} r={isActive ? r * 1.25 : r} className="dot" />
              </g>
            );
          })}
      </svg>
      <div className={`hint${blocked ? ' warn' : ''}`}>
        {hint}
        {compare && <span className="compare-key"> · dashed outline: {compare.name}</span>}
      </div>
    </div>
  );
}
