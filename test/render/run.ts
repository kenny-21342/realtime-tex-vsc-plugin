// Render check: draws page lists with the preview's own code in headless Chromium and writes a
// PNG per page, for test/render/compare.py to compare with MuPDF's rendering of the PDF.
//
//   node out/render/run.js OUT_DIR DPI GFX.jsonl
//
// RTEX_RENDER_PROJECT: the project directory; bitmap images (PNG, JPEG) the pages name in
// `images_info` are loaded from it (otherwise images are drawn as placeholders).
// GFX.jsonl: realtime-tex's `gfx_dump` example output for the page lists (one line per page
// file: {"file", "ok", "page": NativePage}). Fonts are loaded the way the extension loads them
// (src/resources.ts: font files by name, Type1 through pdftex.map), so kpsewhich must be on PATH.
// CHROMIUM: the browser executable; PLAYWRIGHT_CORE: path of the playwright-core package.
import { promises as fs, readFileSync } from 'fs';
import * as path from 'path';
import { ResourceLoader } from '../../src/resources';
import type { DisplayList } from '../../src/protocol';

async function main() {
  const [out, dpiArg, gfx] = process.argv.slice(2);
  const dpi = Number(dpiArg);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const bundle = readFileSync(path.join(__dirname, 'harness.js'), 'utf8');
  await page.setContent(`<!doctype html><html><body><script>${bundle}</script></body></html>`);
  const loader = new ResourceLoader(process.env, (m) => console.error(m));
  const have = new Set<string>();
  await fs.mkdir(out, { recursive: true });
  const summary: unknown[] = [];
  for (const lineText of readFileSync(gfx, 'utf8').split('\n')) {
    if (!lineText.trim()) continue;
    const e = JSON.parse(lineText);
    const dl: DisplayList = JSON.parse(readFileSync(e.file, 'utf8'));
    const pno = Number(/page(\d+)\.json$/.exec(e.file)![1]);
    const res = await loader.fontsFor([dl], have);
    const wire = [...res].map(([k, r]) => {
      have.add(k);
      return [k, r.kind === 'sfnt' ? { kind: 'sfnt', b64: Buffer.from(r.data).toString('base64') } : r];
    });
    await page.evaluate((w: unknown) => (window as unknown as { addFonts: (w: unknown) => void }).addFonts(w), wire);
    const project = process.env.RTEX_RENDER_PROJECT;
    const pics: [string, string, string][] = [];
    for (const info of Object.values(dl.images_info ?? {})) {
      const mime = /\.png$/i.test(info.file) ? 'image/png' : /\.jpe?g$/i.test(info.file) ? 'image/jpeg' : undefined;
      if (!project || !mime || have.has(`image:${info.file}`)) continue;
      try {
        pics.push([info.file, mime, readFileSync(path.resolve(project, info.file)).toString('base64')]);
        have.add(`image:${info.file}`);
      } catch {
        // not in the project (a TeX Live image): drawn as a placeholder
      }
    }
    await page.evaluate((l: unknown) => (window as unknown as { addImages: (l: unknown) => Promise<void> }).addImages(l), pics);
    const r = await page.evaluate(
      ([d, n, x]: [DisplayList, unknown, number]) => (window as unknown as { renderPage: (...a: unknown[]) => { png: string; native: boolean; reason: string | null } }).renderPage(d, n, x),
      [dl, e.ok ? e.page : undefined, dpi] as const,
    );
    await fs.writeFile(path.join(out, `page${pno}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
    summary.push({ page: pno, native: r.native, reason: r.reason, candidate: e.candidate });
  }
  await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
