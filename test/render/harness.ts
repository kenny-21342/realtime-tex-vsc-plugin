// Browser side of the render check: the preview's own drawing code (webview/render.ts and
// webview/native.ts) draws one page list onto a canvas. Driven by test/render/run.ts.
import type { FontResource } from '../../src/fontKey';
import type { DisplayList, NativePage } from '../../src/protocol';
import { indexNative, nativeOf } from '../../webview/native';
import { FontStore, ImageStore, inexactReason, Mat, Painter } from '../../webview/render';

type Wire = { kind: 'sfnt'; b64: string } | Exclude<FontResource, { kind: 'sfnt' }>;

const fonts = new FontStore();
const images = new ImageStore(() => Promise.reject(new Error('no PDF images in the render check')));

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

(window as unknown as Record<string, unknown>).addFonts = (list: [string, Wire][]) => {
  for (const [key, r] of list) fonts.add(key, r.kind === 'sfnt' ? { kind: 'sfnt', data: bytes(r.b64) } : r);
};

/** Draws the page as the preview does (white page, display list, native operations) at `dpi`;
 * returns the PNG as a data URL and why the page would not be drawn natively, if so. */
(window as unknown as Record<string, unknown>).renderPage = (dl: DisplayList, native: NativePage | undefined, dpi: number) => {
  const page = { exact: false, dl, native };
  const n = nativeOf(page);
  const reason = inexactReason(dl, fonts, images, dl.lines, n !== undefined);
  const k = dpi / 72 / 65781.76; // device px per sp (1 bp = 1/72 in)
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((dl.page_width ?? 0) * k);
  canvas.height = Math.round((dl.page_height ?? 0) * k);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const base: Mat = [k, 0, 0, k, 0, 0];
  const p = new Painter(ctx, base, fonts, images);
  const rows = n ? indexNative(n) : undefined;
  p.draw(dl, dl.other ?? [], 0, 0, rows?.get(null));
  dl.lines.forEach((line, i) => p.draw(dl, line.items, 0, 0, rows?.get(i)));
  return { png: canvas.toDataURL('image/png'), native: n !== undefined, reason: reason ?? null };
};
