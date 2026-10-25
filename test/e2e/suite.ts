// Integration suite, run inside the VS Code extension host by runTest.ts.
import { execFile } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ParagraphUpdateEvent } from '../../src/protocol';
import type { Api } from '../../src/extension';
import { activeManaged, installedRelease, releaseBinary } from '../../src/config';
import { installRelease } from '../../src/prebuilt';
import { runTask, sq } from '../../src/setup';
import { runLarge } from './large';

const shots = process.env.RTEX_E2E_OUT ?? '';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(what: string, cond: () => boolean, timeoutMs = 60000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

function screenshot(name: string): Promise<void> {
  if (!shots) return Promise.resolve();
  mkdirSync(shots, { recursive: true });
  if (process.platform === 'darwin') {
    // Capture the test window even when another application is in front. A desktop shot
    // can accidentally validate the wrong app and expose unrelated local content.
    const windowScript = `import CoreGraphics; for w in CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as! [[String:Any]] { let name = w[kCGWindowName as String] as? String ?? ""; if name.contains("[Extension Development Host]") && (w[kCGWindowOwnerPID as String] as? Int) == ${process.ppid} { print(w[kCGWindowNumber as String]!); break } }`;
    return new Promise((resolve, reject) => execFile('swift', ['-e', windowScript], (err, stdout) => {
      const id = stdout.trim();
      if (err || !/^\d+$/.test(id)) { reject(err ?? new Error('cannot find the VS Code test window')); return; }
      execFile('screencapture', ['-x', '-l', id, path.join(shots, name)], (captureError) => captureError ? reject(captureError) : resolve());
    }));
  }
  if (!process.env.DISPLAY) return Promise.resolve();
  return new Promise((resolve) => execFile('import', ['-window', 'root', path.join(shots, name)], () => resolve()));
}

async function insertAfter(doc: vscode.TextDocument, needle: string, text: string): Promise<void> {
  const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  const at = doc.positionAt(doc.getText().indexOf(needle) + needle.length);
  await editor.edit((e) => e.insert(at, text));
}

export async function run(): Promise<void> {
  try {
    if (process.env.RTEX_E2E_LARGE_PROJECT) {
      await runLarge(screenshot);
      return;
    }
    await steps();
  } catch (e) {
    const s = vscode.extensions.getExtension<Api>('henryxiaoyang.realtime-tex')?.exports.session();
    console.log('[e2e] status at failure:', JSON.stringify(s?.status));
    await screenshot('failure.png');
    throw e;
  }
}

async function steps(): Promise<void> {
  const ext = vscode.extensions.getExtension<Api>('henryxiaoyang.realtime-tex')!;
  const api = await ext.activate();
  const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const steps: string[] = [];
  const step = (s: string) => {
    steps.push(s);
    console.log(`[e2e] ✓ ${s}`);
  };

  // a clean window for the screenshots
  for (const c of ['workbench.action.closeAuxiliaryBar', 'workbench.action.closeSidebar', 'workbench.action.closePanel']) {
    await vscode.commands.executeCommand(c).then(undefined, () => undefined);
  }

  // 1. open an included file and the preview: the main file is found through \input
  const intro = await vscode.workspace.openTextDocument(path.join(folder, 'intro.tex'));
  await vscode.window.showTextDocument(intro, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('realtimeTex.openPreview');
  await waitFor('a session', () => api.session() !== undefined, 10000);
  const s = api.session()!;
  if (path.basename(s.mainFile) !== 'main.tex') throw new Error(`main file ${s.mainFile}`);
  step('main file found through \\input');
  await waitFor('the first layout', () => s.status.phase === 'live' && s.model.hasLayout, 120000);
  step(`first layout: ${s.model.pagesTotal} page(s)`);
  // type once the layout has settled, as a person would (an edit made while the layout is
  // still catching up goes to the full compile)
  await waitFor('the layout to settle', () => s.status.convergence?.state === 'Converged' && !s.status.pending, 120000);
  await sleep(1500);
  await vscode.commands.executeCommand('notifications.clearAll');
  await screenshot('1-preview.png');

  await waitFor('the initial layout message', () => api.panel()!.transportStats.layouts > 0);
  if (api.panel()!.transportStats.pdfBytes !== 0) throw new Error('exact/native fixture unnecessarily transferred the full PDF');
  step('exact/native full layout displayed without transferring the document PDF');

  // 2. a keystroke in the main file takes the fast path
  const main = await vscode.workspace.openTextDocument(path.join(folder, 'main.tex'));
  await insertAfter(main, 'This paragraph is typeset', ' live and instantly');
  await waitFor('a fast update', () => s.status.lastFastMs !== undefined && s.model.overlays.size > 0, 30000);
  step(`fast update in ${s.status.lastFastMs!.toFixed(2)} ms`);
  await sleep(800);
  await screenshot('2-fast-edit.png');
  // the gutter marks the edited paragraph live and the preamble as waiting for the full compile
  const marks = await s.liveMarks(main);
  const at = (needle: string) => {
    const b = Buffer.byteLength(main.getText().slice(0, main.getText().indexOf(needle)));
    return marks.find((m) => m.span.range.start <= b && b < m.span.range.end)?.kind;
  };
  if (at('This paragraph is typeset') !== 'live') throw new Error(`edited paragraph marked ${at('This paragraph is typeset')}`);
  if (at('\\documentclass') !== 'full') throw new Error(`preamble marked ${at('\\documentclass')}`);
  step(`gutter: ${marks.filter((m) => m.kind === 'live').length} live part(s), ${marks.filter((m) => m.kind === 'full').length} on the full compile`);

  // 3. cursor → preview and preview → source
  const editor = await vscode.window.showTextDocument(main, vscode.ViewColumn.One);
  const pos = main.positionAt(main.getText().indexOf('A second paragraph') + 5);
  editor.selection = new vscode.Selection(pos, pos);
  if (!(await s.revealInPreview(main, pos, true))) throw new Error('revealInPreview failed');
  step('cursor position shown in the preview');
  const placements = s.placements();
  const [parId, frags] = [...placements].find(([, f]) => f.length > 0)!;
  const f = frags[0];
  if (!(await s.jumpToSource(f.page, f.xs[0], f.baselines[0]))) throw new Error('jumpToSource failed');
  const active = vscode.window.activeTextEditor!;
  step(`preview click on unit ${parId} opened ${path.basename(active.document.fileName)}:${active.selection.active.line + 1}`);

  // 4. an error shows up in the Problems panel, and goes away when fixed
  await insertAfter(main, 'A second paragraph refers', ' \\undefinedmacroxyz{}');
  await waitFor('an error diagnostic', () => vscode.languages.getDiagnostics(main.uri).some((d) => d.severity === vscode.DiagnosticSeverity.Error), 60000);
  step('LaTeX error reported as a diagnostic');
  await sleep(500);
  await screenshot('3-error.png');
  const ed2 = await vscode.window.showTextDocument(main, vscode.ViewColumn.One);
  const start = main.getText().indexOf(' \\undefinedmacroxyz{}');
  await ed2.edit((e) => e.delete(new vscode.Range(main.positionAt(start), main.positionAt(start + ' \\undefinedmacroxyz{}'.length))));
  await waitFor('the error to clear', () => !vscode.languages.getDiagnostics(main.uri).some((d) => d.severity === vscode.DiagnosticSeverity.Error), 60000);
  step('diagnostic cleared after the fix');

  // 5. a TikZ page is shown from the PDF (pdf.js under the webview's CSP)
  if (s.model.pagesTotal >= 2) {
    const pageTwo = s.model.pages.get(2);
    if (pageTwo?.exact) throw new Error('the TikZ page should be degraded');
    await api.panel()!.panel.webview.postMessage({ type: 'reveal', page: 2, x: 0, y: 0, force: true });
    await sleep(2500);
    await screenshot('4-pdf-fallback.png');
    step('TikZ page shown from the PDF');
  }

  // A label edit must draw paths and the rotated label in the live overlay, before the page
  // is replaced by the next full compile. The screenshot is taken immediately after it.
  await waitFor('the picture layout to settle', () => s.status.convergence?.state === 'Converged' && !s.status.pending, 120000);
  const pictureDoc = await vscode.workspace.openTextDocument(path.join(folder, 'intro.tex'));
  const label = '$y = x/2$';
  const labelAt = pictureDoc.getText().indexOf(label);
  if (labelAt < 0) throw new Error('missing picture label');
  // A completed earlier revision can arrive while the label's pass is still running.
  // Track source revisions before editing so a fast pass cannot be missed either.
  let pictureSettledRevision = -1;
  const pictureLayouts = s.onOutput((o) => {
    if (o.kind === 'layout' && o.ev.convergence.state === 'Converged') {
      pictureSettledRevision = Math.max(pictureSettledRevision, o.ev.versions.source_revision);
    }
  });
  const livePicture = new Promise<ParagraphUpdateEvent>((resolve, reject) => {
    const timeout = setTimeout(() => { subscription.dispose(); reject(new Error('no native live picture update')); }, 30000);
    const subscription = s.onOutput((o) => {
      if (o.kind !== 'paragraph' || !o.ev.native) return;
      clearTimeout(timeout);
      subscription.dispose();
      resolve(o.ev);
    });
  });
  const pictureEditor = await vscode.window.showTextDocument(pictureDoc, vscode.ViewColumn.One);
  await pictureEditor.edit((e) => e.replace(new vscode.Range(pictureDoc.positionAt(labelAt), pictureDoc.positionAt(labelAt + label.length)), '$y = x/2 + 1$'));
  const live = await livePicture;
  if (!live.native!.ops.some((o) => o.op === 'Paint')) throw new Error('live picture has no paints');
  if (!live.native!.transforms.some(([, m]) => Math.abs(m[1]) > 0.1 && Math.abs(m[2]) > 0.1)) throw new Error('live label lost its rotation');
  if (!live.dl.lines.flatMap((l) => l.items).some((i) => i[0] === 'g' && i[2] === 49)) throw new Error('new label is absent');
  await sleep(80); // allow the queued paragraph message and one canvas frame
  if (s.model.overlays.get(live.par_id)?.native !== live.native) throw new Error('live picture replaced before screenshot');
  await screenshot('4d-live-picture-label.png');
  step('live picture label retains native paths and rotation before the background page');
  // An older engine or an unsupported literal supplies no native drawing. Exercise the
  // session's wire-event handler: the successful previous overlay stays, without an outline.
  const previous = s.model.overlays.get(live.par_id);
  (s as unknown as { onEvent: (e: ParagraphUpdateEvent) => void }).onEvent({ ...live, native: undefined });
  if (s.model.overlays.get(live.par_id) !== previous) throw new Error('unsupported live picture replaced its previous drawing');
  if (s.heldUnits.some((u) => u.parId === live.par_id)) throw new Error('unsupported live picture was outlined as an error');
  step('unsupported live picture kept its previous overlay without an error outline');
  // The unsupported event above is injected by this test, not produced by the engine. A
  // faster engine may already have finished the real label edit while the screenshot ran.
  // Request the replacement explicitly rather than depending on a pending background pass.
  s.recompile();
  await waitFor('the edited label layout to settle', () => pictureSettledRevision >= live.versions.source_revision && s.status.convergence?.state === 'Converged' && !s.status.pending, 120000);
  pictureLayouts.dispose();

  // 5b. a half-typed coordinate in the TikZ picture: the picture keeps its last good version,
  // outlined, until the coordinate is complete (rtex ≥ 0.0.6, held pictures)
  if (s.model.pagesTotal >= 2 && !process.env.RTEX_E2E_SKIP_HELD) {
    const intro = await vscode.workspace.openTextDocument(path.join(folder, 'intro.tex'));
    const ed = await vscode.window.showTextDocument(intro, vscode.ViewColumn.One);
    const full = '(4.5,1.5)';
    const at = intro.getText().indexOf(full);
    if (at < 0) throw new Error('the picture coordinate is not in intro.tex');
    let pageBefore = s.model.pages.get(2);
    let heldLayoutSeen = false;
    let heldPageChanged = false;
    const heldLayouts = s.onOutput((o) => {
      if (o.kind !== 'layout') return;
      const page = s.model.pages.get(2);
      if (o.ev.held?.length) {
        heldLayoutSeen = true;
        heldPageChanged ||= page !== pageBefore && page?.hash !== pageBefore?.hash;
      } else if (o.ev.compile.state === 'Ok') {
        // A valid queued snapshot may arrive after the edit. The held result must retain
        // the latest good page, including such a snapshot, rather than an older baseline.
        pageBefore = page;
      }
    });
    await ed.edit((e) => e.replace(new vscode.Range(intro.positionAt(at), intro.positionAt(at + full.length)), '(4.5,'));
    await waitFor('the picture to be held in a full layout', () => heldLayoutSeen && (s.status.held ?? 0) > 0, 120000);
    heldLayouts.dispose();
    if (heldPageChanged) throw new Error('the page with the held picture changed');
    step(`broken picture held (${s.heldUnits.map((u) => `line ${u.line ?? '?'}`).join(', ')}), its page unchanged`);
    await api.panel()!.panel.webview.postMessage({ type: 'reveal', page: 2, x: 0, y: 0, force: true });
    await sleep(2500);
    await screenshot('4c-held-picture.png');
    const at2 = intro.getText().indexOf('(4.5,');
    await ed.edit((e) => e.replace(new vscode.Range(intro.positionAt(at2), intro.positionAt(at2 + '(4.5,'.length)), '(4.5,1.6)'));
    await waitFor('the edited picture', () => (s.status.held ?? 0) === 0 && s.status.compile?.state === 'Ok', 120000);
    step('the completed coordinate replaced the held picture');
  }

  // 6. export
  const pdf = await s.exportPdf();
  if (!pdf || !existsSync(pdf)) throw new Error(`export produced no PDF (${pdf})`);
  step(`exported ${path.basename(pdf)}`);

  // 7. a full compile that fails after the first layout keeps the pages. RTEX_E2E_SKIP_FAILED_PASS=1
  // skips it: rtex (e5cab6a through b858819) reports the body-only pass after a breaking preamble edit as Ok
  // with the previous pages
  if (!process.env.RTEX_E2E_SKIP_FAILED_PASS) {
    const pagesBefore = s.model.pagesTotal;
    await insertAfter(main, '\\usepackage{tikz}', '\n\\stop');
    await waitFor('a failed full compile', () => s.status.compile?.state === 'Failed', 120000);
    if (s.model.pagesTotal !== pagesBefore) throw new Error(`pages dropped: ${pagesBefore} -> ${s.model.pagesTotal}`);
    step(`failed compile kept the ${pagesBefore} page(s) on screen`);
    await sleep(800);
    await screenshot('4b-failed-pass-banner.png');
    const ed3 = await vscode.window.showTextDocument(main, vscode.ViewColumn.One);
    const bad = main.getText().indexOf('\n\\stop');
    await ed3.edit((e) => e.delete(new vscode.Range(main.positionAt(bad), main.positionAt(bad + '\n\\stop'.length))));
    await waitFor('a good full compile again', () => s.status.compile?.state === 'Ok', 120000);
    step('recovered after the preamble was fixed');
  }

  // 8. closing the preview stops the engine
  api.panel()!.panel.dispose();
  await waitFor('the engine to stop', () => !s.running, 10000);
  step('engine stopped when the preview closed');

  // A slow suffix makes the distinction between a shipped page and a completed layout observable.
  const reflowFile = path.join(folder, 'reflow.tex');
  await vscode.workspace.fs.writeFile(vscode.Uri.file(reflowFile), Buffer.from(
    '\\documentclass{article}\n\\usepackage[paperwidth=240pt,paperheight=320pt,margin=20pt]{geometry}\n' +
    '\\begin{document}\nAnchor words in a paragraph that can grow across more lines.\n\nFollowing text.\n\n' +
    '\\newpage\n\\directlua{local t=os.clock()+1; while os.clock()<t do end}\nSlow suffix.\n\\end{document}\n'));
  const reflowDoc = await vscode.workspace.openTextDocument(reflowFile);
  await vscode.window.showTextDocument(reflowDoc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('realtimeTex.openPreview');
  await waitFor('the reflow session', () => api.session()?.mainFile === reflowFile, 10000);
  const srFlow = api.session()!;
  await waitFor('the initial reflow layout', () => srFlow.status.convergence?.state === 'Converged' && !srFlow.status.pending, 120000);
  const previewsBefore = api.panel()!.transportStats.previews;
  let previewAt = 0;
  let previewRevision = 0;
  let finalAt = 0;
  const reflowProgress = srFlow.onOutput((o) => {
    if (o.kind === 'pagePreview' && o.ev.page.page === 1) {
      previewAt ||= Date.now();
      previewRevision = Math.max(previewRevision, o.ev.source_revision);
    }
    if (o.kind === 'layout' && previewRevision && o.ev.versions.source_revision >= previewRevision && o.ev.convergence.state === 'Converged') finalAt = Date.now();
  });
  try {
    await insertAfter(reflowDoc, 'Anchor words', ' additional words'.repeat(20));
    await waitFor('an accepted reflow page', () => api.panel()!.transportStats.previews > previewsBefore, 120000);
    await sleep(80);
    await screenshot('6-reflow-page-preview.png');
    await waitFor('the final reflow layout', () => finalAt > 0 && !srFlow.status.pending, 120000);
    if (finalAt - previewAt < 300) throw new Error('page preview did not precede the slow suffix');
    step('reflow page displayed before the slow document suffix completed');
    const newParagraph = new Promise<number>((resolve) => {
      const subscription = srFlow.onOutput((o) => {
        if (o.kind !== 'paragraph' || !o.ev.dl.lines.some((l) => l.items.some((i) => i[0] === 'g' && i[2] === 90))) return;
        subscription.dispose(); resolve(o.ev.par_id);
      });
    });
    const edFresh = await vscode.window.showTextDocument(reflowDoc,vscode.ViewColumn.One);
    const freshAt = reflowDoc.getText().indexOf('Following text.');
    await edFresh.edit((e) => e.insert(reflowDoc.positionAt(freshAt),'Zebra paragraph.\n\n'));
    const freshId = await newParagraph;
    await waitFor('the new paragraph page preview', () => srFlow.model.pagePreviews().some((p) => p.placements.some((u) => u.par_id===freshId)),120000);
    await insertAfter(reflowDoc,'Zebra',' live');
    await waitFor('visible live text while layout is pending', () => srFlow.status.pending && srFlow.status.liveWhilePending===true,30000);
    if (!srFlow.model.displaysRevision(freshId,srFlow.model.overlays.get(freshId)!.revision)) throw new Error('new paragraph is not drawn');
    await screenshot('6b-new-paragraph-live.png');
    await waitFor('the new paragraph layout to settle', () => srFlow.status.convergence?.state==='Converged' && !srFlow.status.pending,120000);
    step('brand new paragraph and subsequent typing remain Live before layout finishes');

  } finally { reflowProgress.dispose(); }
  api.panel()!.panel.dispose();
  await waitFor('the reflow engine to stop', () => !srFlow.running, 10000);
  // a second main file in the folder would make later steps' main file ambiguous
  await vscode.workspace.fs.delete(vscode.Uri.file(reflowFile));

  // A document without a standalone body-paragraph donor. The next paragraph must
  // borrow outer heading/list state, then become a captured green-gutter live unit.
  for (const [name, prefix] of [
    ['heading', '\\paragraph{Run-in title.} Existing text.\n'],
    ['empty-heading', '\\section{Section}\n\\paragraph{Run-in title.}\n'],
    ['display-heading', '\\paragraph{Display title.}\n'],
    ['list', '\\begin{itemize}\n\\item Existing text.\n\\end{itemize}\n'],
  ]) {
    const file = path.join(folder, `new-${name}.tex`);
    const setup = name === 'display-heading' ? '\\usepackage{titlesec}\n\\titleformat{\\paragraph}[hang]{\\normalsize\\bfseries}{}{1em}{}\n\\titlespacing*{\\paragraph}{0pt}{2ex}{1em}\n' : '';
    await vscode.workspace.fs.writeFile(vscode.Uri.file(file), Buffer.from(
      `\\documentclass{article}\n${setup}\\begin{document}\n${prefix}\n\\end{document}\n`));
    const doc = await vscode.workspace.openTextDocument(file);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('realtimeTex.openPreview');
    await waitFor('the boundary session', () => api.session()?.mainFile === file, 10000);
    const session = api.session()!;
    await waitFor('the boundary layout', () => session.status.convergence?.state === 'Converged' && !session.status.pending, 120000);
    let id: number | undefined;
    let updates = 0;
    const subscription = session.onOutput((o) => {
      if (o.kind !== 'paragraph' || !o.ev.dl.lines.some((l) => l.items.some((i) => i[0] === 'g' && i[2] === 90))) return;
      id = o.ev.par_id;
      updates++;
    });
    try {
      let at = doc.getText().indexOf('\\end{document}');
      for (const text of ['\n', 'Z', 'ebra', '\n', 'new line text.']) {
        const before = updates;
        await editor.edit((e) => e.insert(doc.positionAt(at), text));
        at += text.length;
        if (text.trim() || id !== undefined) await waitFor('a live boundary paragraph update', () => updates > before, 30000);
      }
      await waitFor('the new boundary paragraph layout', () => session.status.convergence?.state === 'Converged' && !session.status.pending, 120000);
      const marks = await session.liveMarks(doc);
      if (id === undefined || !marks.some((m) => m.span.id === id && m.kind === 'live')) {
        throw new Error(`the new paragraph after ${name} never got a green live gutter`);
      }
      const before = updates;
      await editor.edit((e) => e.insert(doc.positionAt(at), ' more text'));
      await waitFor('live editing after the new paragraph is captured', () => updates > before, 30000);
      step(`new paragraph after ${name}: Enter, typing, green gutter and subsequent live edit`);
      await screenshot(`6c-new-${name}-gutter.png`);
    } finally { subscription.dispose(); }
    api.panel()!.panel.dispose();
    await waitFor('the boundary engine to stop', () => !session.running, 10000);
    await vscode.workspace.fs.delete(vscode.Uri.file(file));
  }
  // 8b. Preview This File Only: a file without \documentclass, in the template, from the main folder
  const part = path.join(folder, 'chapters', 'part.tex');
  await vscode.workspace.fs.writeFile(vscode.Uri.file(part), Buffer.from('\\section{A part}\nA part previewed on its own, with $x^2$ inline.\n'));
  const partDoc = await vscode.workspace.openTextDocument(part);
  await vscode.window.showTextDocument(partDoc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('realtimeTex.previewFile');
  const wrapper = path.join(folder, '.rtex-preview.tex');
  await waitFor('a session for the wrapper', () => api.session()?.mainFile === wrapper, 10000);
  const sp = api.session()!;
  if (!readFileSync(wrapper, 'utf8').includes('\\input{chapters/part.tex}')) throw new Error(`wrapper: ${readFileSync(wrapper, 'utf8')}`);
  await waitFor('its first layout', () => sp.status.phase === 'live' && sp.model.hasLayout, 120000);
  await waitFor('the layout to settle', () => sp.status.convergence?.state === 'Converged' && !sp.status.pending, 120000);
  await insertAfter(partDoc, 'previewed on its own', ' and live');
  await waitFor('a fast update in the part', () => sp.status.lastFastMs !== undefined, 30000);
  step(`file previewed alone (${sp.model.pagesTotal} page(s)), fast update in ${sp.status.lastFastMs!.toFixed(2)} ms`);
  api.panel()!.panel.dispose();
  await waitFor('the wrapper to go', () => !sp.running && !existsSync(wrapper), 10000);
  step('wrapper removed when the preview closed');

  // 9. a document whose first compile fails explains why instead of waiting forever
  const broken = path.join(folder, 'broken.tex');
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(broken),
    // \stop ends the run in the preamble: no page at all
    Buffer.from('\\documentclass{article}\n\\stop\n\\begin{document}\nHello\n\\end{document}\n'),
  );
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(broken), vscode.ViewColumn.One);
  await vscode.commands.executeCommand('realtimeTex.openPreview');
  await waitFor('a session for broken.tex', () => api.session()?.mainFile === broken, 10000);
  const sb = api.session()!;
  await waitFor('the failure screen', () => sb.screen.screen === 'error', 120000);
  if (sb.screen.title !== 'The document produced no pages' || !sb.screen.message) throw new Error(`unexpected screen: ${JSON.stringify(sb.screen)}`);
  step(`failed first compile explained: ${sb.screen.message}`);
  await sleep(800);
  await screenshot('5-first-compile-failed.png');

  // 10. the terminal tasks of Install rtex / Install TeX Live reach bash intact (Git Bash on
  // Windows): quotes, command substitution and a path with a space
  const out = path.join(mkdtempSync(path.join(os.tmpdir(), 'rtex task ')), "it's here.txt");
  if (!(await runTask('Realtime TeX task check', path.dirname(out), `set -e; v="it's ok"; echo "$v $(echo nested)" > ${sq(out)}`))) throw new Error('the task failed');
  const got = existsSync(out) ? readFileSync(out, 'utf8').trim() : '(no file)';
  if (got !== "it's ok nested") throw new Error(`the task wrote ${got}`);
  step(`setup task ran in ${process.platform === 'win32' ? 'Git Bash' : 'bash'}`);

  // 11. Install rtex: download the latest release for this machine (what the command does,
  // into a scratch storage folder), then run the live preview on the downloaded engine
  const state = new Map<string, unknown>();
  const fakeCtx = {
    globalStorageUri: vscode.Uri.file(mkdtempSync(path.join(os.tmpdir(), 'rtex storage '))),
    globalState: { get: (k: string) => state.get(k), update: async (k: string, v: unknown) => void state.set(k, v) },
  } as unknown as vscode.ExtensionContext;
  const progress: string[] = [];
  const res = await installRelease(fakeCtx, { report: (p) => void (p.message && progress.push(p.message)) });
  if (!res.ok) throw new Error(`installing the release failed: ${res.error}`);
  if (installedRelease(fakeCtx) !== res.tag || activeManaged(fakeCtx) !== 'release') throw new Error('the release is not the active rtex');
  step(`downloaded and verified ${res.version} (${res.tag})`);
  const cfg = vscode.workspace.getConfiguration('realtimeTex');
  const builtServer = cfg.get<string>('serverPath');
  await cfg.update('serverPath', releaseBinary(fakeCtx, res.tag), vscode.ConfigurationTarget.Global);
  try {
    await vscode.window.showTextDocument(main, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('realtimeTex.openPreview');
    await waitFor('a session on the downloaded rtex', () => api.session()?.mainFile === main.fileName && api.session()!.running, 20000);
    const sr = api.session()!;
    await waitFor('its first layout', () => sr.status.phase === 'live' && sr.model.hasLayout, 120000);
    await waitFor('the layout to settle', () => sr.status.convergence?.state === 'Converged' && !sr.status.pending, 120000);
    await insertAfter(main, 'A second paragraph refers', ' quickly');
    await waitFor('a fast update from the downloaded rtex', () => sr.status.lastFastMs !== undefined, 30000);
    step(`downloaded rtex typesets live (${sr.status.lastFastMs!.toFixed(2)} ms)`);
  } finally {
    await cfg.update('serverPath', builtServer, vscode.ConfigurationTarget.Global);
  }
  console.log(`[e2e] all ${steps.length} steps passed`);
}
