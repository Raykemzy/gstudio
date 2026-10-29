import type { FieldSpec, Side } from '../model/schema';
import type { Issue } from '../model/validate';
import type { Pom } from '../model/pom';
import type { PanelFrame } from '../model/style';
import type { Vec } from '../geometry/polygon';
import type { NeckSurface } from '../geometry/outline';

/**
 * What every garment type provides. The editor, 3D preview, export and
 * measurement sheet only talk to this interface, so adding a garment type
 * means writing one module, not touching the rest of the app.
 */

export type Surface = NeckSurface;

export interface GarmentHandle {
  id: string;
  kind: string;
  side?: Side;
  /** Model frame (wearer's left = +x). */
  pos: Vec;
  label: string;
}

/** One drawn element of a flat view, in the model frame (the view mirrors it for the back). */
export interface FlatPart {
  kind: 'sleeve' | 'rib' | 'seam' | 'detail' | 'hidden' | 'fold';
  points: Vec[];
  closed: boolean;
  /** The style colour to fill with ('shade' = the body colour in shadow, e.g. the inside of the back neck); omitted = no fill. */
  fill?: 'body' | 'sleeves' | 'rib' | 'shade';
  /** Seam-coloured stroke. */
  stroke?: boolean;
  weight?: number;
  dashed?: boolean;
  /** Clip to the garment ('all'), the body without sleeves ('body'), or not at all. */
  clip: 'all' | 'body' | 'none';
}

export interface FlatParts {
  outline: Vec[];
  /** Outline without sleeves (same as outline for garments without sleeves). */
  body: Vec[];
  /** Drawn under the panels (e.g. sleeves). */
  under: FlatPart[];
  /** Drawn over the panels (ribs, seams, pockets, stitching). */
  over: FlatPart[];
}

export interface MeshSpec {
  /** Silhouette used for the 3D form. */
  outer: Vec[];
  /** Approximate garment half-thickness, cm. */
  maxDepth: number;
  /** Curves to place vertex rows along (so cut-outs follow them); parts outside the silhouette are ignored. */
  guides: Vec[][];
  /** Regions cut out of each surface (e.g. the neck opening). */
  hole?: Partial<Record<Surface, (v: Vec) => boolean>>;
  /** Lines drawn as rib tubes on each surface (e.g. necklines). */
  ribs?: Partial<Record<Surface, Vec[]>>;
  ribRadius?: number;
}

export interface FormGroup {
  id: string;
  title: string;
  core: string[];
  side: string[];
  enums?: string[];
  toggles?: string[];
  open?: boolean;
}

export interface FormSpec {
  coreFields: Record<string, FieldSpec>;
  sideFields: Record<string, FieldSpec>;
  /** Side fields stored as half-widths, shown doubled when mirrored. */
  halfWidthKeys: ReadonlySet<string>;
  enums: Record<string, { label: string; options: { value: string; label: string }[] }>;
  toggles: Record<string, { label: string }>;
  groups: FormGroup[];
  /** Fields measured in degrees rather than cm. */
  degreeKeys?: ReadonlySet<string>;
}

export interface StyleLabels {
  body: string;
  /** Omitted when the garment has no separate sleeves. */
  sleeves?: string;
  rib: string;
  /** Omitted when the garment has no armhole seam. */
  armholeSeam?: string;
}

export interface GarmentDef<P> {
  kind: string;
  label: string;
  defaults(): P;
  form: FormSpec;
  styleLabels: StyleLabels;
  flatParts(p: P, surface: Surface): FlatParts;
  handles(p: P, surface: Surface): GarmentHandle[];
  drag(p: P, handle: Pick<GarmentHandle, 'kind' | 'side'>, pointer: Vec, surface: Surface): P;
  validate(p: P): Issue[];
  mesh(p: P): MeshSpec;
  panelFrame(p: P): PanelFrame;
  pointsOfMeasure(p: P): Pom[];
  /** Short plain-language summary lines (titles, notes). */
  hint: string;
}
