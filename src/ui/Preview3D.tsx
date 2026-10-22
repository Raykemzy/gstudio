import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TShirtParams } from '../model/schema';
import { buildGarmentMesh } from '../geometry/mesh3d';
import { buildOutline } from '../geometry/outline';
import { flatView, type FlatView } from '../render/layers';
import { drawFlatView } from '../render/canvas';

export interface Preview3DApi {
  capturePng: () => Promise<Blob | null>;
}

interface Props {
  params: TShirtParams;
  /** Changes when a different design is opened: the camera re-frames it (unless the angle is locked). */
  designKey?: string;
  apiRef?: React.RefObject<Preview3DApi | null>;
}

type ViewName = 'front' | 'back' | 'side' | 'angle';

interface Skin {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  material: THREE.MeshStandardMaterial;
}

function makeSkin(): Skin {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  return { canvas, texture, material };
}

const TEXTURE_PX = 1024;

/**
 * Paint a flat view into a skin. Texture space is the model frame (wearer's left = +x),
 * so the back view, which is drawn mirrored, is flipped back here.
 */
function paintSkin(skin: Skin, view: FlatView, box: { minX: number; minY: number; width: number; height: number }, mirrored: boolean, base: string) {
  const k = TEXTURE_PX / Math.max(box.width, box.height);
  const w = Math.max(4, Math.round(box.width * k)), h = Math.max(4, Math.round(box.height * k));
  if (skin.canvas.width !== w || skin.canvas.height !== h) {
    skin.canvas.width = w;
    skin.canvas.height = h;
    // A new size needs a new GPU texture.
    skin.texture.dispose();
    skin.texture = new THREE.CanvasTexture(skin.canvas);
    skin.texture.colorSpace = THREE.SRGBColorSpace;
    skin.texture.anisotropy = 4;
    skin.material.map = skin.texture;
    skin.material.needsUpdate = true;
  }
  const ctx = skin.canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(mirrored ? -k : k, 0, 0, k, -box.minX * k, -box.minY * k);
  // The 3D view draws its own outline, and the hidden back-neck line belongs to the flat sketch only.
  drawFlatView(ctx, { ...view, layers: view.layers.filter((l) => l.kind !== 'outline' && l.kind !== 'hidden') }, 0.3);
  skin.texture.needsUpdate = true;
}

/** A locked camera, remembered in this browser so the same angle comes back after a reload. */
interface LockedView {
  position: [number, number, number];
  target: [number, number, number];
}
const LOCK_KEY = 'garment-studio:3d-locked-view';

function readLock(): LockedView | null {
  try {
    const v = JSON.parse(localStorage.getItem(LOCK_KEY) ?? 'null');
    return Array.isArray(v?.position) && Array.isArray(v?.target) ? v : null;
  } catch {
    return null;
  }
}

function writeLock(v: LockedView | null) {
  try {
    if (v) localStorage.setItem(LOCK_KEY, JSON.stringify(v));
    else localStorage.removeItem(LOCK_KEY);
  } catch {
    // Storage unavailable: the lock still works for this visit.
  }
}

/** Locked: no rotate/zoom, and touches scroll the page instead of spinning the garment. */
function applyLock(s: SceneState, locked: boolean) {
  s.controls.enabled = !locked;
  s.renderer.domElement.style.touchAction = locked ? 'pan-y' : 'none';
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: THREE.Mesh;
  seam: THREE.LineLoop;
  rib: THREE.Group;
  ribMaterial: THREE.MeshStandardMaterial;
  /** One painted texture per surface: the same flat drawing as the 2D editor. */
  skins: { front: Skin; back: Skin };
  render: () => void;
  center: THREE.Vector3;
  radius: number;
}

export function Preview3D({ params, apiRef, designKey }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const pending = useRef<number | null>(null);
  const [locked, setLocked] = useState(() => readLock() !== null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  // One-time scene setup.
  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      host.textContent = '3D preview unavailable: this browser could not start WebGL. The 2D editor still works.';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf4f5f7);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(60, 90, 120);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.7);
    rim.position.set(-80, 40, -100);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 40;
    controls.maxDistance = 1200;

    const skins = { front: makeSkin(), back: makeSkin() };
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), [skins.front.material, skins.back.material]);
    scene.add(mesh);
    const seam = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x1f2430 }));
    scene.add(seam);
    const rib = new THREE.Group();
    scene.add(rib);
    const ribMaterial = new THREE.MeshStandardMaterial({ color: 0x8c93a1, roughness: 0.9 });

    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    sceneRef.current = { renderer, camera, controls, mesh, seam, rib, ribMaterial, skins, render, center: new THREE.Vector3(), radius: 60 };
    applyLock(sceneRef.current, lockedRef.current);
    if (apiRef)
      apiRef.current = {
        capturePng: () =>
          new Promise((resolve) => {
            // Render once at high resolution for export, then restore the on-screen size.
            const prev = renderer.getPixelRatio();
            renderer.setPixelRatio(4);
            renderer.setSize(host.clientWidth, host.clientHeight, false);
            render();
            renderer.domElement.toBlob((b) => {
              renderer.setPixelRatio(prev);
              renderer.setSize(host.clientWidth, host.clientHeight, false);
              render();
              resolve(b);
            }, 'image/png');
          }),
      };
    resize();

    return () => {
      ro.disconnect();
      controls.dispose();
      mesh.geometry.dispose();
      seam.geometry.dispose();
      for (const sk of Object.values(skins)) {
        sk.texture.dispose();
        sk.material.dispose();
      }
      ribMaterial.dispose();
      rib.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [apiRef]);

  // Rebuild the mesh from the shared garment definition, at most once per animation frame.
  const firstBuild = useRef(true);
  const framedKey = useRef(designKey);
  useEffect(() => {
    if (pending.current != null) cancelAnimationFrame(pending.current);
    pending.current = requestAnimationFrame(() => {
      pending.current = null;
      const s = sceneRef.current;
      if (!s) return;
      let data;
      try {
        data = buildGarmentMesh(params);
      } catch (e) {
        console.error('3D preview build failed', e);
        return;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
      geo.addGroup(0, data.frontIndexCount, 0);
      geo.addGroup(data.frontIndexCount, data.indices.length - data.frontIndexCount, 1);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      s.mesh.geometry.dispose();
      s.mesh.geometry = geo;

      paintSkin(s.skins.front, flatView(params, 'front'), data.uvBox, false, params.style.body.color);
      paintSkin(s.skins.back, flatView(params, 'back'), data.uvBox, true, params.style.body.color);
      s.ribMaterial.color.set(params.style.rib.color);

      const outline = buildOutline(params, 'outer').polygon;
      const seamGeo = new THREE.BufferGeometry().setFromPoints(outline.map((v) => new THREE.Vector3(v.x, -v.y, 0)));
      s.seam.geometry.dispose();
      s.seam.geometry = seamGeo;

      // Collar rib: a tube along each neckline, sized from the rib width.
      s.rib.children.forEach((c) => (c as THREE.Mesh).geometry.dispose());
      s.rib.clear();
      if (params.core.collarWidth > 0) {
        for (const flat of [data.necklines.front, data.necklines.back]) {
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i < flat.length; i += 3) pts.push(new THREE.Vector3(flat[i], flat[i + 1], flat[i + 2]));
          if (pts.length < 2) continue;
          const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, Math.max(0.3, params.core.collarWidth * 0.4), 8, false);
          s.rib.add(new THREE.Mesh(tube, s.ribMaterial));
        }
      }

      s.center.copy(geo.boundingSphere!.center);
      s.radius = geo.boundingSphere!.radius;
      if (firstBuild.current) {
        firstBuild.current = false;
        const saved = lockedRef.current ? readLock() : null;
        if (saved) {
          s.camera.position.set(...saved.position);
          s.controls.target.set(...saved.target);
          s.controls.update();
        } else setView(s, 'angle');
      } else if (framedKey.current !== designKey && !lockedRef.current) {
        setView(s, 'angle');
      }
      framedKey.current = designKey;
      s.render();
    });
  }, [params, designKey]);

  const toggleLock = () => {
    const s = sceneRef.current;
    const next = !locked;
    if (s) {
      applyLock(s, next);
      writeLock(next ? { position: s.camera.position.toArray(), target: s.controls.target.toArray() } : null);
    }
    setLocked(next);
  };

  return (
    <div className={`preview3d${locked ? ' locked' : ''}`}>
      <div ref={hostRef} className="canvas-host" />
      <div className="view-buttons">
        {(['front', 'angle', 'side', 'back'] as ViewName[]).map((v) => (
          <button key={v} disabled={locked} onClick={() => sceneRef.current && setView(sceneRef.current, v)}>
            {v === 'angle' ? '3/4' : v}
          </button>
        ))}
        <button className={`lock${locked ? ' on' : ''}`} onClick={toggleLock} aria-pressed={locked} title="Keep the current camera angle while you edit">
          {locked ? 'Angle locked' : 'Lock angle'}
        </button>
      </div>
      <p className="caveat">
        Simplified shape preview: not a fabric or fit simulation. Depth is estimated.{' '}
        {locked ? 'Angle is locked; unlock to rotate.' : 'Drag to rotate; scroll or pinch to zoom.'}
      </p>
    </div>
  );
}

function setView(s: SceneState, v: ViewName) {
  const dist = s.radius / Math.tan((s.camera.fov * Math.PI) / 360) * 1.05;
  const dir = { front: [0, 0.05, 1], back: [0, 0.05, -1], side: [1, 0.05, 0], angle: [0.6, 0.25, 0.85] }[v];
  const d = new THREE.Vector3(...dir).normalize().multiplyScalar(dist);
  s.camera.position.copy(s.center).add(d);
  s.controls.target.copy(s.center);
  s.controls.update();
  s.render();
}
