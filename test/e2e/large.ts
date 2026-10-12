// Optional local integration against a scratch copy of a large document. No private fixture
// content or path is stored here; runTest copies the supplied project before any edit.
import * as vscode from 'vscode';
import * as path from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { performance } from 'perf_hooks';
import type { Api } from '../../src/extension';
import type { Span } from '../../src/protocol';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what: string, condition: () => boolean): Promise<void> {
  const until = performance.now() + 300000;
  while (!condition()) {
    if (performance.now() > until) throw new Error(`waiting for ${what}`);
    await sleep(50);
  }
}

export async function runLarge(screenshot: (name: string) => Promise<void>): Promise<void> {
  const ext = vscode.extensions.getExtension<Api>('henryxiaoyang.realtime-tex')!;
  const api = await ext.activate();
  const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const doc = await vscode.workspace.openTextDocument(path.join(folder, 'main.tex'));
  const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('realtimeTex.openPreview');
  await waitFor('the large session', () => api.session()?.model.hasLayout === true);
  const s = api.session()!;
  await waitFor('a converged large layout', () => s.status.convergence?.state === 'Converged' && !s.status.pending);
  const byte = Number(process.env.RTEX_E2E_LARGE_BYTE);
  const initial = doc.getText();
  let character = Buffer.from(initial, 'utf8').subarray(0, byte).toString('utf8').length;
  const spans = await (s as unknown as { spans: (rel: string) => Promise<Span[]> }).spans('main.tex');
  let span = spans.find((sp) => sp.range.start <= byte && sp.range.end >= byte);
  if (!span) throw new Error('the requested edit has no source span');
  const page = s.model.placements.get(span!.id)?.[0]?.page;
  if (!page) throw new Error('the edit has no page placement');
  const cursor = doc.positionAt(character);
  editor.selection = new vscode.Selection(cursor, cursor);
  editor.revealRange(new vscode.Range(cursor, cursor), vscode.TextEditorRevealType.InCenter);
  await s.revealInPreview(doc, cursor, true);
  await sleep(700);
  await screenshot('large-before.png');
  const count = api.panel()!.transportStats.previews;
  const started = performance.now();
  let firstPreview: number | undefined;
  let updatesWhileTyping = 0;
  let typing = true;
  let visibleLiveUpdates = 0;
  const liveStatus = s.onStatus((status) => { if (typing && status.pending && status.liveWhilePending) visibleLiveUpdates++; });
  let lastRevision = 0;
  let settledRevision = 0;
  const subscription = s.onOutput((o) => {
    if (o.kind === 'paragraph') lastRevision = Math.max(lastRevision, o.ev.versions.source_revision);
    if (o.kind === 'layout' && o.ev.convergence.state === 'Converged') settledRevision = Math.max(settledRevision, o.ev.versions.source_revision);
    if (o.kind === 'pagePreview' && o.ev.placements.some((p) => p.par_id === span!.id)) {
      firstPreview ??= performance.now() - started;
      if (typing) updatesWhileTyping++;
    }
  });
  try {
    for (let i = 0; i < 60; i++) {
      const added = process.env.RTEX_E2E_NEW_PARAGRAPH && i===0 ? '\n\nZebra new paragraph' : ' additional';
      await editor.edit((e) => e.insert(doc.positionAt(character), added));
      character += added.length;
      if (process.env.RTEX_E2E_NEW_PARAGRAPH && i===0) {
        const byteNow=Buffer.byteLength(doc.getText().slice(0,character))-1;
        const current = await (s as unknown as { spans: (rel: string) => Promise<Span[]> }).spans('main.tex');
        span=current.find((sp) => sp.range.start<=byteNow && sp.range.end>byteNow);
        if (!span) throw new Error('the inserted paragraph has no span');
      }
      await sleep(Math.max(0, started + (i + 1) * 100 - performance.now()));
    }
    typing = false;
    await waitFor('an accepted page preview', () => api.panel()!.transportStats.previews > count);
    await s.revealInPreview(doc, doc.positionAt(character), true);
    await sleep(400);
    await screenshot('large-during-reflow.png');
    if (!updatesWhileTyping) throw new Error('no affected-page preview while typing');
    s.recompile();
    await waitFor('the final large layout', () => settledRevision >= lastRevision && s.status.convergence?.state === 'Converged' && !s.status.pending);
    await screenshot('large-settled.png');
    const result = { visibleLiveUpdates, pages: s.model.pagesTotal, editedPage: page, firstPreviewMs: firstPreview, previewsWhileTyping: updatesWhileTyping, sentPreviews: api.panel()!.transportStats.previews - count };
    console.log('[e2e-large]', JSON.stringify(result));
    const out = process.env.RTEX_E2E_OUT;
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(path.join(out, 'large-result.json'), JSON.stringify(result, null, 2)); }
  } finally { subscription.dispose(); liveStatus.dispose(); }
}
