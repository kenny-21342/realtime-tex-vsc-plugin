// Native drawing of TikZ/pgf pages (realtime-tex docs/DISPLAY_LIST.md, "Native drawing"): which
// pages can be drawn without the PDF, and where each drawing operation goes among the items.
// Pure module (no DOM), unit-tested with node:test.
import type { DisplayList, GfxColor, GfxOp, Matrix, NativePage } from '../src/protocol';

/** Flags native drawing resolves (rtex_dl::gfx::RESOLVED_FLAGS). */
const RESOLVED = new Set(['literal', 'shading']);

/** The page's native drawing, when rtex sent one and every flag of the page is one it resolves. */
export function nativeOf(page: { exact: boolean; dl: DisplayList; native?: NativePage }): NativePage | undefined {
  if (page.exact || !page.native) return undefined;
  const flags = page.dl.flags && typeof page.dl.flags === 'object' && !Array.isArray(page.dl.flags) ? Object.keys(page.dl.flags as object) : [];
  return flags.every((f) => RESOLVED.has(f) || f.endsWith('_detail')) ? page.native : undefined;
}

/** Operations and item transforms of one row (`null`: the page's `other` items), by item index. */
export interface RowNative {
  /** ops to run right after item k */
  after: Map<number, GfxOp[]>;
  transforms: Map<number, Matrix>;
}

export function indexNative(n: NativePage): Map<number | null, RowNative> {
  const rows = new Map<number | null, RowNative>();
  const row = (line: number | null) => {
    let r = rows.get(line);
    if (!r) rows.set(line, (r = { after: new Map(), transforms: new Map() }));
    return r;
  };
  for (const op of n.ops) {
    const r = row(op.at.line);
    const list = r.after.get(op.at.item);
    if (list) list.push(op);
    else r.after.set(op.at.item, [op]);
  }
  for (const [at, m] of n.transforms) row(at.line).transforms.set(at.item, m);
  return rows;
}

/** CSS rgba() of a PDF device color (CMYK by the plain formula, as rtex's Color::rgb). */
export function cssColor(c: GfxColor, alpha = c.alpha): string {
  const v = c.comps;
  let rgb: number[];
  if (v.length === 1) rgb = [v[0], v[0], v[0]];
  else if (v.length === 3) rgb = v;
  else if (v.length === 4) rgb = [(1 - v[0]) * (1 - v[3]), (1 - v[1]) * (1 - v[3]), (1 - v[2]) * (1 - v[3])];
  else rgb = [0, 0, 0];
  const b = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return `rgba(${b(rgb[0])},${b(rgb[1])},${b(rgb[2])},${Math.max(0, Math.min(1, alpha))})`;
}

/** The band of an axial shading without extension: the quadrilateral of `bbox` points whose
 * projection on the axis lies between its ends (user space), or undefined for a degenerate axis. */
export function axialBand(coords: number[], bbox: [number, number, number, number]): [number, number][] | undefined {
  const [x0, y0, x1, y1] = coords;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (!len) return undefined;
  // the bbox's extent along the normal: enough to cover it
  const [bx0, by0, bx1, by1] = bbox;
  const far = Math.hypot(bx1 - bx0, by1 - by0) + Math.hypot(x0 - bx0, y0 - by0) + len;
  const nx = (-dy / len) * far;
  const ny = (dx / len) * far;
  return [
    [x0 + nx, y0 + ny],
    [x1 + nx, y1 + ny],
    [x1 - nx, y1 - ny],
    [x0 - nx, y0 - ny],
  ];
}
