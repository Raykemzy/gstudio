import { z } from 'zod';
import type { NeckSurface } from '../geometry/outline';
import type { Vec } from '../geometry/polygon';

/**
 * How a garment is dressed: colours and colour-blocked panels. Stored alongside the
 * shape so undo, save and AI all treat it as part of the design.
 *
 * Panel points use GARMENT-RELATIVE coordinates so a panel follows the shape when
 * the garment is resized:
 *   u = x / chest half-width of that side   (-1 = wearer's right side seam, +1 = left)
 *   v = y / body length                     (0 = shoulder line by the neck, 1 = centre hem)
 * A panel is any closed shape; only the part inside the garment is shown (it is
 * clipped to the outline), so shapes can overflow the edges freely.
 */

export interface Fill {
  /** #rrggbb. Later: patterns and textures. */
  color: string;
}

export interface Panel {
  id: string;
  name: string;
  surface: NeckSurface;
  /** Closed shape in garment-relative (u, v) coordinates. */
  points: [number, number][];
  /** Smooth curve through the points, or straight lines between them. */
  curved: boolean;
  /** Also draw a mirror copy on the other side of the centre line. */
  mirrored: boolean;
  /** Draw the panel's edge as a seam line. */
  seam: boolean;
  /** 'body': stays off the sleeves. 'whole': can run across the sleeves too. */
  area: 'body' | 'whole';
  fill: Fill;
}

export interface GarmentStyle {
  body: Fill;
  sleeves: Fill;
  rib: Fill;
  /** Draw the seam where each sleeve joins the body. */
  armholeSeam: boolean;
  /** Draw soft fold lines (drawing realism only; no effect on the shape). */
  folds: boolean;
  /** Bottom to top: later panels cover earlier ones. */
  panels: Panel[];
}

/** Flat-sketch grey, the industry convention for undyed flats. */
export const DEFAULT_BODY = '#cccccc';
/** What older designs used for the rib before rib colours followed the body. */
export const DEFAULT_RIB = '#c9ced8';

export function defaultStyle(): GarmentStyle {
  return { body: { color: DEFAULT_BODY }, sleeves: { color: DEFAULT_BODY }, rib: { color: DEFAULT_BODY }, armholeSeam: true, folds: false, panels: [] };
}

/** Garment colours a beginner is likely to want, light to dark. */
export const SWATCHES: { name: string; color: string }[] = [
  { name: 'Optic white', color: '#f7f7f5' },
  { name: 'Light grey', color: '#eef0f3' },
  { name: 'Flat grey', color: '#cccccc' },
  { name: 'Heather grey', color: '#b9bcc2' },
  { name: 'Cream', color: '#e9dfc9' },
  { name: 'Sand', color: '#cdb994' },
  { name: 'Brown', color: '#6b4f3a' },
  { name: 'Olive', color: '#5b5e3c' },
  { name: 'Forest', color: '#2f4535' },
  { name: 'Navy', color: '#1f2a44' },
  { name: 'Burgundy', color: '#5c1f2a' },
  { name: 'Red', color: '#b3261e' },
  { name: 'Charcoal', color: '#3a3c40' },
  { name: 'Washed black', color: '#2a2a2c' },
  { name: 'Black', color: '#121214' },
];

// ---------- garment-relative coordinates ----------

export interface PanelFrame {
  leftHalf: number;
  rightHalf: number;
  length: number;
}

/** u > 0 is the wearer's left (+x in the model frame). */
export function toModel([u, v]: [number, number], f: PanelFrame): Vec {
  return { x: u * (u >= 0 ? f.leftHalf : f.rightHalf), y: v * f.length };
}

export function fromModel(p: Vec, f: PanelFrame): [number, number] {
  return [p.x / (p.x >= 0 ? f.leftHalf : f.rightHalf), p.y / f.length];
}

export const PANEL_LIMITS = { minPoints: 3, maxPoints: 24, minU: -2.5, maxU: 2.5, minV: -0.5, maxV: 1.6 };

export function clampPanelPoint([u, v]: [number, number]): [number, number] {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return [
    r(Math.min(PANEL_LIMITS.maxU, Math.max(PANEL_LIMITS.minU, u))),
    r(Math.min(PANEL_LIMITS.maxV, Math.max(PANEL_LIMITS.minV, v))),
  ];
}

// ---------- templates ----------

export interface PanelTemplate {
  id: string;
  name: string;
  description: string;
  points: [number, number][];
  curved: boolean;
  mirrored: boolean;
  area: 'body' | 'whole';
}

/** Starting shapes for panels. Points are drawn for the wearer's left; mirrored ones copy to the right. */
export const PANEL_TEMPLATES: PanelTemplate[] = [
  {
    id: 'side-curve',
    name: 'Side curves',
    description: 'Curved panels sweeping from the armpits towards the centre hem.',
    points: [[1.4, 0.28], [0.98, 0.36], [0.62, 0.66], [0.22, 1.12], [1.4, 1.2]],
    curved: true,
    mirrored: true,
    area: 'body',
  },
  {
    id: 'yoke',
    name: 'Shoulder yoke',
    description: 'A band across the shoulders with a gently curved edge.',
    points: [[-2.2, -0.4], [2.2, -0.4], [2.2, 0.22], [1.0, 0.25], [0, 0.3], [-1.0, 0.25], [-2.2, 0.22]],
    curved: true,
    mirrored: false,
    area: 'whole',
  },
  {
    id: 'hem-band',
    name: 'Hem band',
    description: 'A straight band across the bottom.',
    points: [[-2.2, 0.82], [2.2, 0.82], [2.2, 1.5], [-2.2, 1.5]],
    curved: false,
    mirrored: false,
    area: 'body',
  },
  {
    id: 'diagonal',
    name: 'Diagonal split',
    description: 'Splits the body on a diagonal line.',
    points: [[-2.2, 1.5], [-2.2, 0.95], [2.2, 0.15], [2.2, 1.5]],
    curved: false,
    mirrored: false,
    area: 'body',
  },
  {
    id: 'stripe',
    name: 'Centre stripe',
    description: 'A vertical stripe down the middle.',
    points: [[-0.18, -0.4], [0.18, -0.4], [0.18, 1.5], [-0.18, 1.5]],
    curved: false,
    mirrored: false,
    area: 'body',
  },
  {
    id: 'arch',
    name: 'Arch',
    description: 'A dome rising from the hem, like a back panel.',
    points: [[-1.5, 1.5], [-1.0, 0.6], [0, 0.32], [1.0, 0.6], [1.5, 1.5]],
    curved: true,
    mirrored: false,
    area: 'body',
  },
  {
    id: 'side-stripe',
    name: 'Side stripes',
    description: 'Straight panels down both side seams.',
    points: [[0.72, 0.2], [1.6, 0.2], [1.6, 1.5], [0.72, 1.5]],
    curved: false,
    mirrored: true,
    area: 'body',
  },
];

// ---------- validation ----------

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const fillSchema = z.object({ color: hex });
const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);

export const panelSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(60),
  surface: z.enum(['front', 'back']),
  points: z.array(pointSchema).min(PANEL_LIMITS.minPoints).max(PANEL_LIMITS.maxPoints),
  curved: z.boolean(),
  mirrored: z.boolean(),
  seam: z.boolean(),
  area: z.enum(['body', 'whole']),
  fill: fillSchema,
});

export const styleSchema = z.object({
  body: fillSchema,
  sleeves: fillSchema,
  rib: fillSchema,
  // Added after v2 shipped: files without it keep the seam they always had.
  armholeSeam: z.boolean().default(true),
  // Older files had no fold lines.
  folds: z.boolean().default(false),
  panels: z.array(panelSchema).max(40),
});

/** Rib knit reads slightly different from the body fabric: a touch darker on light colours, lighter on dark ones. */
export function ribShadeOf(color: string): string {
  const n = parseInt(color.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  const mixed = rgb.map((c) => Math.round(lum < 0.45 ? c + (255 - c) * 0.12 : c * 0.88));
  return '#' + mixed.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * New body colour: the sleeves and rib follow it unless they were set separately
 * (i.e. they still match what they would have been for the old body colour).
 */
export function withBodyColour(style: GarmentStyle, color: string): GarmentStyle {
  const old = style.body.color.toLowerCase();
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const sleevesFollow = same(style.sleeves.color, old);
  const ribFollows = same(style.rib.color, ribShadeOf(old)) || same(style.rib.color, DEFAULT_RIB) || same(style.rib.color, old);
  return {
    ...style,
    body: { color },
    sleeves: sleevesFollow ? { color } : style.sleeves,
    rib: ribFollows ? { color } : style.rib,
  };
}

/** A readable text colour (seams, labels) for a given fill. */
export function contrastInk(color: string): string {
  const n = parseInt(color.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.45 ? '#e8eaee' : '#1f2430';
}
