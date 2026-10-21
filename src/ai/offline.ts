import { defaultParams, type CoreParams, type SideParams } from '../model/schema';

/**
 * Offline keyword interpreter: NOT AI. It recognises a fixed vocabulary of
 * garment phrases and maps them to parameter changes, producing the same
 * proposal shape as the AI service (and going through the same validation).
 * It exists so concept generation degrades gracefully without an API key.
 */

interface Draft {
  core: CoreParams;
  left: SideParams;
  right: SideParams;
  unsupported: string[];
}

type Rule = { re: RegExp; label: string; apply: (d: Draft) => void };

const both = (d: Draft, v: Partial<SideParams>) => {
  Object.assign(d.left, v);
  Object.assign(d.right, v);
};

const RULES: Rule[] = [
  { re: /\b(oversized?|boxy|baggy|loose)\b/, label: 'oversized/boxy', apply: (d) => { both(d, { chestHalf: 33, hemHalf: 33, shoulderHalf: 30, shoulderDrop: 6, armholeDepth: 26, sleeveOpening: 22, sleeveLength: 23 }); d.core.hemStyle = 'straight'; } },
  { re: /\b(slim|fitted|tight[- ]fit|skinny)\b/, label: 'slim fit', apply: (d) => both(d, { chestHalf: 22, hemHalf: 21, shoulderHalf: 21, armholeDepth: 18, sleeveOpening: 14 }) },
  { re: /\b(broad|wide)\s+body\b|\bunusually broad\b/, label: 'broad body', apply: (d) => both(d, { chestHalf: 37, hemHalf: 37 }) },
  { re: /\bdrop(ped)?[- ]shoulders?\b/, label: 'dropped shoulders', apply: (d) => both(d, { shoulderHalf: Math.max(d.left.chestHalf + 4, 31), shoulderDrop: 9, armholeDepth: 27, sleeveAngle: 38 }) },
  { re: /\b(exaggerated|extended|huge|big|strong|broad|wide)\s+shoulders?\b|\bshoulder proportions\b/, label: 'exaggerated shoulders', apply: (d) => both(d, { shoulderHalf: 38, shoulderDrop: 1.5, armholeDepth: 26, sleeveAngle: 18 }) },
  { re: /\bcrop(ped)?\b/, label: 'cropped', apply: (d) => { d.core.bodyLength = 48; both(d, { armholeDepth: Math.min(d.left.armholeDepth, 24) }); } },
  { re: /\b(longline|long body|extra long|tunic|elongated)\b/, label: 'long body', apply: (d) => { d.core.bodyLength = 90; } },
  { re: /\b(sleeveless|tank|muscle tee)\b/, label: 'sleeveless', apply: (d) => both(d, { sleeveLength: 0, sleeveOpening: 22 }) },
  { re: /\blong[- ]sleeves?d?\b/, label: 'long sleeves', apply: (d) => both(d, { sleeveLength: 60, sleeveAngle: 48, sleeveOpening: 12 }) },
  { re: /\b(3\/4|three[- ]quarter)\b/, label: '3/4 sleeves', apply: (d) => both(d, { sleeveLength: 42, sleeveAngle: 40, sleeveOpening: 14 }) },
  { re: /\bshort(,)?\s+(\w+\s+)?sleeves?\b|\bshort[- ]sleeved?\b|\bcap sleeves?\b/, label: 'short sleeves', apply: (d) => both(d, { sleeveLength: Math.min(d.left.sleeveLength, 14) }) },
  { re: /\b(wide|bell|flared|voluminous|big)\s+(\w+\s+)?sleeves?\b|\bsleeves?\s+(are\s+)?wide\b/, label: 'wide sleeves', apply: (d) => both(d, { sleeveOpening: 30, armholeDepth: Math.max(d.left.armholeDepth, 25), sleeveAngle: Math.min(d.left.sleeveAngle, 22) }) },
  { re: /\b(narrow|tight|slim)\s+sleeves?\b/, label: 'narrow sleeves', apply: (d) => both(d, { sleeveOpening: 12 }) },
  { re: /\bv[- ]?neck(line)?\b/, label: 'v-neck', apply: (d) => { d.core.neckStyle = 'v'; d.core.neckDepthFront = Math.max(d.core.neckDepthFront, 14); } },
  { re: /\bscoop\b/, label: 'scoop neck', apply: (d) => { d.core.neckStyle = 'scoop'; d.core.neckDepthFront = 15; } },
  { re: /\bsquare[- ]neck/, label: 'square neck', apply: (d) => { d.core.neckStyle = 'square'; d.core.neckDepthFront = 11; } },
  { re: /\b(boat|bateau)[- ]?neck/, label: 'boat neck', apply: (d) => { d.core.neckStyle = 'boat'; d.core.neckWidth = 28; d.core.neckDepthFront = 3.5; } },
  { re: /\bcrew[- ]?neck/, label: 'crew neck', apply: (d) => { d.core.neckStyle = 'crew'; } },
  { re: /\bdeep\b(?!\s+armhole)/, label: 'deep neckline', apply: (d) => { d.core.neckDepthFront = 20; } },
  { re: /\bhigh(er)?[- ]neck(line)?\b|\bmock[- ]?neck\b/, label: 'high neckline', apply: (d) => { d.core.neckDepthFront = 4; d.core.neckDepthBack = 1.5; } },
  { re: /\bnarrow\s+neck(line)?\b|\bdeep but narrow\b|\bnarrow\b(?=[^.]*neck)/, label: 'narrow neck', apply: (d) => { d.core.neckWidth = 14.5; } },
  { re: /\bwide\s+neck(line)?\b/, label: 'wide neck', apply: (d) => { d.core.neckWidth = 27; } },
  { re: /\b(raw[- ]edge|no rib|without rib)/, label: 'no collar rib', apply: (d) => { d.core.collarWidth = 0; } },
  { re: /\b(heavyweight|heavy rib|thick rib|chunky rib)/, label: 'thick rib', apply: (d) => { d.core.collarWidth = 3.5; } },
  { re: /\b(curved|shirttail|rounded)\s+hem\b/, label: 'curved hem', apply: (d) => { d.core.hemStyle = 'curved'; both(d, { hemOffset: -6 }); } },
  { re: /\bstraight\s+hem\b/, label: 'straight hem', apply: (d) => { d.core.hemStyle = 'straight'; } },
  { re: /\b(flared?|a[- ]line|trapeze|swing)\b(?!\s+sleeves?)/, label: 'flared body', apply: (d) => both(d, { hemHalf: d.left.chestHalf + 9 }) },
  { re: /\btapered\b/, label: 'tapered body', apply: (d) => both(d, { hemHalf: d.left.chestHalf - 5 }) },
  { re: /\basymmetric(al)?\b/, label: 'asymmetric', apply: (d) => { d.core.hemStyle = 'straight'; d.left.hemOffset = 10; d.right.hemOffset = -8; } },
  { re: /\blonger\s+(on\s+the\s+)?left\b|\bleft\s+(side|hem)\s+(is\s+)?longer\b/, label: 'longer left hem', apply: (d) => { d.core.hemStyle = 'straight'; d.left.hemOffset = 13; d.right.hemOffset = -8; } },
  { re: /\blonger\s+(on\s+the\s+)?right\b|\bright\s+(side|hem)\s+(is\s+)?longer\b/, label: 'longer right hem', apply: (d) => { d.core.hemStyle = 'straight'; d.right.hemOffset = 13; d.left.hemOffset = -8; } },
];

const UNSUPPORTED: [RegExp, string][] = [
  [/\bpockets?\b/, 'Pockets are not modelled yet.'],
  [/\b(prints?|graphics?|logos?|embroider\w*|patch(es)?|text)\b/, 'Prints, graphics and embroidery are not modelled; only the silhouette is.'],
  [/\b(hood(ie)?|hooded)\b/, 'Hoods are not supported (T-shirt only).'],
  [/\b(zip\w*|buttons?|placket|drawstrings?|toggles?)\b/, 'Closures and drawstrings are not modelled.'],
  [/\b(slits?|vents?|cut[- ]?outs?)\b/, 'Slits and cut-outs are not modelled yet.'],
  [/\b(layer(ed|s)?|panels?|seams?|raglan|darts?)\b/, 'Construction details (panels, raglan seams, layering) are not modelled; only the outer silhouette is.'],
  [/\b(heavyweight|lightweight|cotton|jersey|knit|fabric|distressed|washed|denim|leather)\b/, 'Fabric and weight are not simulated; the preview only shows shape.'],
  [/\bmock[- ]?neck\b|\bturtle/, 'A standing collar is approximated as a high neckline; collar height is not modelled.'],
  [/\b(colou?r|black|white|red|blue|green)\b/, 'Colour is not part of the design data yet.'],
];

export function interpretOffline(prompt: string) {
  const text = prompt.toLowerCase();
  const base = defaultParams();
  const d: Draft = { core: base.core, left: base.left, right: base.right, unsupported: [] };
  const matched: string[] = [];
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      rule.apply(d);
      matched.push(rule.label);
    }
  }
  for (const [re, msg] of UNSUPPORTED) if (re.test(text)) d.unsupported.push(msg);
  return {
    name: matched.length ? matched.slice(0, 3).join(', ').replace(/^./, (c) => c.toUpperCase()) : 'Basic tee',
    summary: matched.length
      ? `Offline keyword interpreter recognised: ${matched.join(', ')}. Anything else in your description was not understood.`
      : 'The offline keyword interpreter did not recognise any garment terms, so this is the basic tee. Try words like oversized, cropped, dropped shoulders, wide sleeves, v-neck, asymmetric, longer left hem.',
    core: d.core,
    left: d.left,
    right: d.right,
    unsupported: d.unsupported,
    matched,
  };
}
