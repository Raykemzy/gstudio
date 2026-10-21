import { useMemo, useRef, useState } from 'react';
import type { TShirtParams } from '../model/schema';
import type { NeckSurface } from '../geometry/outline';
import { getHandles, type Handle } from '../geometry/handles';
import { bounds } from '../geometry/polygon';
import { garmentPaths, toView, viewSign } from '../render/paths';

interface Props {
  params: TShirtParams;
  surface: NeckSurface;
  /** Outline of another saved design to overlay for comparison. */
  compare?: { params: TShirtParams; name: string } | null;
  /** Called for every pointer move during a drag. Returns an error message if the move was rejected. */
  onDrag: (handle: Handle, pointer: { x: number; y: number }, gestureId: string) => string | null;
  onDragEnd: () => void;
}

const GRID = 10;

export function Editor2D({ params, surface, compare, onDrag, onDragEnd }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<{ handle: Handle; gesture: string } | null>(null);
  const [hover, setHover] = useState<Handle | null>(null);
  const [blocked, setBlocked] = useState(false);
  const frozenBox = useRef<string | null>(null);

  const paths = useMemo(() => garmentPaths(params, surface), [params, surface]);
  const comparePaths = useMemo(() => (compare ? garmentPaths(compare.params, surface) : null), [compare, surface]);
  const handles = useMemo(() => getHandles(params, surface), [params, surface]);

  // Fit the view to the garment, snapped to the grid so small edits don't make it jump.
  // While dragging, the view is frozen so the handle stays under the pointer.
  const fitted = useMemo(() => {
    const b = comparePaths
      ? bounds([
          { x: paths.bounds.minX, y: paths.bounds.minY }, { x: paths.bounds.maxX, y: paths.bounds.maxY },
          { x: comparePaths.bounds.minX, y: comparePaths.bounds.minY }, { x: comparePaths.bounds.maxX, y: comparePaths.bounds.maxY },
        ])
      : paths.bounds;
    const half = Math.ceil((Math.max(Math.abs(b.minX), Math.abs(b.maxX)) + 12) / GRID) * GRID;
    const top = Math.floor((Math.min(b.minY, 0) - 12) / GRID) * GRID;
    const bottom = Math.ceil((b.maxY + 14) / GRID) * GRID;
    return { x: -half, y: top, w: 2 * half, h: bottom - top };
  }, [paths, comparePaths]);
  const viewBox = active && frozenBox.current ? frozenBox.current : `${fitted.x} ${fitted.y} ${fitted.w} ${fitted.h}`;
  const [vx, vy, vw, vh] = viewBox.split(' ').map(Number);
  const r = vw / 95; // handle radius in cm, roughly constant on screen

  const toModel = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: pt.x * viewSign(surface), y: pt.y };
  };

  const startDrag = (e: React.PointerEvent, h: Handle) => {
    e.preventDefault();
    svgRef.current!.setPointerCapture(e.pointerId);
    frozenBox.current = `${fitted.x} ${fitted.y} ${fitted.w} ${fitted.h}`;
    setActive({ handle: h, gesture: `${h.id}-${Date.now()}` });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!active) return;
    setBlocked(onDrag(active.handle, toModel(e), active.gesture) !== null);
  };
  const endDrag = () => {
    if (!active) return;
    setActive(null);
    setBlocked(false);
    frozenBox.current = null;
    onDragEnd();
  };

  const gridLines = [];
  for (let x = Math.ceil(vx / GRID) * GRID; x <= vx + vw; x += GRID)
    gridLines.push(<line key={`x${x}`} x1={x} y1={vy} x2={x} y2={vy + vh} className={x === 0 ? 'grid centre' : 'grid'} />);
  for (let y = Math.ceil(vy / GRID) * GRID; y <= vy + vh; y += GRID)
    gridLines.push(<line key={`y${y}`} x1={vx} y1={y} x2={vx + vw} y2={y} className={y === 0 ? 'grid centre' : 'grid'} />);

  const leftHem = toView(handles.find((h) => h.id === 'hemSide:left')!.pos, surface);
  const rightHem = toView(handles.find((h) => h.id === 'hemSide:right')!.pos, surface);
  const shown = active?.handle ?? hover;

  return (
    <div className="editor2d">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="img"
        aria-label={`${surface} view of the garment`}
      >
        {gridLines}
        <text x={vx + r} y={vy + vh - r} className="scale-label" fontSize={r * 1.6}>grid = 10 cm</text>
        {comparePaths && <path d={comparePaths.outline} className="compare" />}
        <clipPath id="garment-clip"><path d={paths.outline} /></clipPath>
        <path d={paths.outline} className="garment" />
        {paths.collar && <path d={paths.collar} className="collar" clipPath="url(#garment-clip)" />}
        {paths.otherNeck && <path d={paths.otherNeck} className="hidden-line" />}
        <text x={leftHem.x} y={leftHem.y + r * 3.5} fontSize={r * 1.7} className="side-label" textAnchor="middle">wearer's L</text>
        <text x={rightHem.x} y={rightHem.y + r * 3.5} fontSize={r * 1.7} className="side-label" textAnchor="middle">wearer's R</text>
        {handles.map((h) => {
          const v = toView(h.pos, surface);
          const isActive = active?.handle.id === h.id;
          return (
            <circle
              key={h.id}
              cx={v.x}
              cy={v.y}
              r={isActive ? r * 1.25 : r}
              className={`handle${isActive ? ' active' : ''}${isActive && blocked ? ' blocked' : ''}`}
              onPointerDown={(e) => startDrag(e, h)}
              onPointerEnter={() => setHover(h)}
              onPointerLeave={() => setHover((cur) => (cur?.id === h.id ? null : cur))}
              data-handle={h.id}
            >
              <title>{h.label}</title>
            </circle>
          );
        })}
      </svg>
      <div className={`hint${blocked ? ' warn' : ''}`}>
        {shown ? shown.label : 'Drag the dots to reshape the garment, or use the controls on the left.'}
        {compare && <span className="compare-key"> · dashed outline: {compare.name}</span>}
      </div>
    </div>
  );
}
