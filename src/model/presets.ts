import { defaultParams, type CoreParams, type SideParams, type TShirtParams } from './schema';

/**
 * Starter pack of silhouettes, authored for this editor (generic shapes, not copies
 * of any brand's garment). Each one is ordinary, fully editable parameters; the
 * geometry tests check that every preset is valid. To add one, append an entry.
 */

export interface Preset {
  id: string;
  name: string;
  category: PresetCategory;
  description: string;
  params: () => TShirtParams;
}

export const PRESET_CATEGORIES = ['Essentials', 'Oversized', 'Cropped', 'Sleeves', 'Necklines & hems', 'Experimental'] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

/** Defaults overridden by `core` and `side`; `right` (if given) makes the preset asymmetric. */
function make(core: Partial<CoreParams>, side: Partial<SideParams>, right?: Partial<SideParams>): () => TShirtParams {
  return () => {
    const p = defaultParams();
    Object.assign(p.core, core);
    Object.assign(p.left, side);
    Object.assign(p.right, side, right ?? {});
    p.mirror = !right;
    return p;
  };
}

export const PRESETS: Preset[] = [
  // ----- Essentials -----
  { id: 'classic', name: 'Classic tee', category: 'Essentials', description: 'Regular fit, crew neck, short set-in sleeves.', params: make({}, {}) },
  {
    id: 'slim',
    name: 'Slim fit',
    category: 'Essentials',
    description: 'Close to the body with narrow sleeves.',
    params: make({ bodyLength: 70 }, { chestHalf: 23, hemHalf: 22, shoulderHalf: 21.5, armholeDepth: 18, sleeveLength: 19, sleeveOpening: 14.5, sleeveAngle: 28 }),
  },
  {
    id: 'heavyweight',
    name: 'Heavyweight boxy',
    category: 'Essentials',
    description: 'Roomy, square body with a thick rib and straight hem.',
    params: make(
      { bodyLength: 70, neckWidth: 19, neckDepthFront: 7.5, collarWidth: 3, hemStyle: 'straight' },
      { chestHalf: 30, hemHalf: 30, shoulderHalf: 27, shoulderDrop: 5.5, armholeDepth: 24, sleeveLength: 22, sleeveOpening: 20, sleeveAngle: 30 },
    ),
  },
  {
    id: 'longline',
    name: 'Longline',
    category: 'Essentials',
    description: 'Extra length with a gently curved hem.',
    params: make({ bodyLength: 88 }, { chestHalf: 27, hemHalf: 27, hemOffset: -6, sleeveLength: 22 }),
  },

  // ----- Oversized -----
  {
    id: 'boxy',
    name: 'Oversized boxy',
    category: 'Oversized',
    description: 'Wide and square with dropped shoulders.',
    params: make(
      { bodyLength: 72, neckWidth: 20, neckDepthFront: 8, collarWidth: 2.5, hemStyle: 'straight' },
      { chestHalf: 34, hemHalf: 34, shoulderHalf: 32, shoulderDrop: 7, armholeDepth: 27, sleeveLength: 24, sleeveOpening: 23, sleeveAngle: 32 },
    ),
  },
  {
    id: 'drop-shoulder',
    name: 'Extreme drop shoulder',
    category: 'Oversized',
    description: 'Shoulder seam far down the arm, deep armholes.',
    params: make(
      { bodyLength: 72, neckWidth: 20, hemStyle: 'straight' },
      { chestHalf: 33, hemHalf: 33, shoulderHalf: 38, shoulderDrop: 10, armholeDepth: 30, sleeveLength: 18, sleeveOpening: 25, sleeveAngle: 40 },
    ),
  },
  {
    id: 'cocoon',
    name: 'Cocoon',
    category: 'Oversized',
    description: 'Full through the body, tapering in at the hem.',
    params: make(
      { bodyLength: 74 },
      { chestHalf: 36, hemHalf: 26, shoulderHalf: 33, shoulderDrop: 8, armholeDepth: 30, sleeveLength: 26, sleeveOpening: 22, sleeveAngle: 35 },
    ),
  },
  {
    id: 'swing',
    name: 'Swing (A-line)',
    category: 'Oversized',
    description: 'Fitted shoulders flaring out to a wide hem.',
    params: make({ bodyLength: 72 }, { chestHalf: 27, hemHalf: 40, shoulderHalf: 23, sleeveLength: 18 }),
  },

  // ----- Cropped -----
  {
    id: 'cropped',
    name: 'Cropped, wide sleeves',
    category: 'Cropped',
    description: 'Short boxy body with broad short sleeves.',
    params: make(
      { bodyLength: 48, neckWidth: 19, neckDepthFront: 7, hemStyle: 'straight' },
      { chestHalf: 31, hemHalf: 32, shoulderHalf: 28, shoulderDrop: 5, armholeDepth: 24, sleeveLength: 22, sleeveOpening: 30, sleeveAngle: 20 },
    ),
  },
  {
    id: 'fitted-crop',
    name: 'Fitted crop',
    category: 'Cropped',
    description: 'Short and close-fitting with a scoop neck.',
    params: make(
      { bodyLength: 45, neckStyle: 'scoop', neckWidth: 20, neckDepthFront: 12 },
      { chestHalf: 22, hemHalf: 21, shoulderHalf: 20, armholeDepth: 17, sleeveLength: 14, sleeveOpening: 14, sleeveAngle: 25 },
    ),
  },
  {
    id: 'square-crop',
    name: 'Square-neck crop',
    category: 'Cropped',
    description: 'Boxy crop with a square neckline.',
    params: make(
      { bodyLength: 50, neckStyle: 'square', neckWidth: 22, neckDepthFront: 9, hemStyle: 'straight' },
      { chestHalf: 29, hemHalf: 29, shoulderHalf: 26, armholeDepth: 22, sleeveLength: 18, sleeveOpening: 20, sleeveAngle: 25 },
    ),
  },

  // ----- Sleeves -----
  {
    id: 'muscle',
    name: 'Sleeveless',
    category: 'Sleeves',
    description: 'No sleeves, narrow shoulders, deep armholes.',
    params: make({}, { shoulderHalf: 18, sleeveLength: 0, sleeveAngle: -17, sleeveOpening: 27, armholeDepth: 26 }),
  },
  {
    id: 'cap-sleeve',
    name: 'Cap sleeve',
    category: 'Sleeves',
    description: 'Tiny sleeves that just cover the shoulder.',
    params: make({}, { chestHalf: 25, hemHalf: 25, shoulderHalf: 22, sleeveLength: 7, sleeveOpening: 15, sleeveAngle: 15 }),
  },
  {
    id: 'wide-elbow',
    name: 'Wide elbow sleeve',
    category: 'Sleeves',
    description: 'Elbow-length sleeves with a wide opening.',
    params: make(
      { bodyLength: 70 },
      { chestHalf: 30, hemHalf: 30, shoulderHalf: 28, shoulderDrop: 6, armholeDepth: 26, sleeveLength: 38, sleeveOpening: 28, sleeveAngle: 35 },
    ),
  },
  {
    id: 'long-sleeve',
    name: 'Long sleeve',
    category: 'Sleeves',
    description: 'Full-length narrow sleeves.',
    params: make({}, { armholeDepth: 21, sleeveLength: 62, sleeveOpening: 10.5, sleeveAngle: 50 }),
  },

  // ----- Necklines & hems -----
  { id: 'deep-v', name: 'Deep V', category: 'Necklines & hems', description: 'A long, narrow V-neck.', params: make({ neckStyle: 'v', neckWidth: 19, neckDepthFront: 22 }, {}) },
  {
    id: 'boat-neck',
    name: 'Boat neck',
    category: 'Necklines & hems',
    description: 'Wide, shallow neckline across the collarbones.',
    params: make({ neckStyle: 'boat', neckWidth: 30, neckDepthFront: 4, neckDepthBack: 2 }, { shoulderHalf: 25 }),
  },
  {
    id: 'shirttail',
    name: 'Curved shirttail hem',
    category: 'Necklines & hems',
    description: 'Longer at the centre, curving up at the sides.',
    params: make({ bodyLength: 76, hemStyle: 'curved' }, { hemOffset: -9 }),
  },

  // ----- Experimental -----
  {
    id: 'asymmetric',
    name: 'Asymmetric hem',
    category: 'Experimental',
    description: 'Diagonal hem, longer on the wearer\'s left, with uneven sleeves.',
    params: make(
      { bodyLength: 68, neckWidth: 17, neckDepthFront: 12, neckStyle: 'v', hemStyle: 'straight' },
      { chestHalf: 28, hemHalf: 30, shoulderHalf: 26, shoulderDrop: 3, sleeveLength: 18, sleeveOpening: 18, sleeveAngle: 22, hemOffset: 14 },
      { hemOffset: -12, sleeveLength: 30, hemHalf: 27 },
    ),
  },
  {
    id: 'uneven-sleeves',
    name: 'One long sleeve',
    category: 'Experimental',
    description: 'A long sleeve on the wearer\'s left, a short one on the right.',
    params: make({}, { armholeDepth: 21, sleeveLength: 60, sleeveOpening: 11, sleeveAngle: 50 }, { sleeveLength: 12, sleeveOpening: 17, sleeveAngle: 25 }),
  },
  {
    id: 'power-shoulder',
    name: 'Exaggerated shoulders',
    category: 'Experimental',
    description: 'Very broad, square shoulders over a narrower hem.',
    params: make(
      { bodyLength: 66, hemStyle: 'straight' },
      { chestHalf: 30, hemHalf: 26, shoulderHalf: 40, shoulderDrop: 0, armholeDepth: 26, sleeveLength: 18, sleeveOpening: 20, sleeveAngle: 15 },
    ),
  },
];

export const findPreset = (id: string) => PRESETS.find((p) => p.id === id);
