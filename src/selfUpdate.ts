// The extension updating itself. It is not on the Marketplace, so a newer .vsix is fetched from
// the extension's GitHub repository (the rolling build of `main` the main-build workflow
// publishes, or the latest release) and installed with VS Code's own installer; the new version
// runs after a window reload.
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { download, getText, sha256File } from './prebuilt';
import { compareVersions, githubRepo, sha256For, vsixAsset } from './release';

/** The prerelease the main-build workflow keeps up to date with the latest build of `main`. */
export const MAIN_BUILD_TAG = 'main-build';

const LAST_CHECK = 'realtimeTex.lastExtensionCheck';
/** A version installed but not running yet (the window was not reloaded). */
const PENDING = 'realtimeTex.pendingExtensionVersion';
const DAY = 24 * 60 * 60 * 1000;
const UA = { 'User-Agent': 'realtime-tex-vscode', Accept: 'application/vnd.github+json' };

type Channel = 'main' | 'releases' | 'off';

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('realtimeTex');
}

/** `owner/name` of the repository updates come from: `realtimeTex.extensionRepository`, else
 * the extension's own `repository` (package.json). */
export function extensionRepo(ctx: vscode.ExtensionContext): string | undefined {
  const pkg = ctx.extension.packageJSON as { repository?: string | { url?: string } };
  const own = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const set = cfg().get<string>('extensionRepository', '').trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(set)) return set;
  return githubRepo(set || own || '');
}

/** Look for a newer version of the extension (at most once a day unless `manual`) on the
 * `realtimeTex.extensionUpdates` channel, and install it. */
export async function checkForExtensionUpdate(ctx: vscode.ExtensionContext, manual = false): Promise<void> {
  const setting = cfg().get<Channel>('extensionUpdates', 'main');
  if (setting === 'off' && !manual) return;
  const channel: Channel = setting === 'off' ? 'main' : setting;
  const running = String((ctx.extension.packageJSON as { version?: string }).version ?? '0.0.0');
  const pending = ctx.globalState.get<string>(PENDING);
  if (pending && compareVersions(pending, running) <= 0) await ctx.globalState.update(PENDING, undefined);
  if (!manual) {
    if (Date.now() - ctx.globalState.get<number>(LAST_CHECK, 0) < DAY) return;
    await ctx.globalState.update(LAST_CHECK, Date.now());
  }
  const say = (msg: string, error = false) => {
    if (manual) void (error ? vscode.window.showErrorMessage(msg) : vscode.window.showInformationMessage(msg));
  };
  const repo = extensionRepo(ctx);
  if (!repo) return say('Realtime TeX: set realtimeTex.extensionRepository to the GitHub repository updates come from.', true);
  const api = `https://api.github.com/repos/${repo}/releases/${channel === 'main' ? `tags/${MAIN_BUILD_TAG}` : 'latest'}`;
  let release: { assets?: { name: string; browser_download_url: string }[] };
  try {
    release = JSON.parse(await getText(api, UA));
  } catch (e) {
    return say(`Could not look for a newer Realtime TeX: ${e instanceof Error ? e.message : String(e)}`, true); // offline: another day
  }
  const asset = vsixAsset(release.assets ?? []);
  if (!asset) return say(`No Realtime TeX package found in ${repo}'s ${channel === 'main' ? 'main build' : 'latest release'}.`, true);
  const newest = ctx.globalState.get<string>(PENDING) ?? running;
  if (compareVersions(asset.version, newest) <= 0) return say(`Realtime TeX is up to date (${newest}).`);

  const dir = path.join(ctx.globalStorageUri.fsPath, 'extension-updates');
  const file = path.join(dir, asset.name);
  try {
    await fs.mkdir(dir, { recursive: true });
    await download(asset.url, file, () => undefined);
    if (asset.sha256Url) {
      const want = sha256For(await getText(asset.sha256Url), asset.name);
      if (!want || want !== (await sha256File(file))) throw new Error(`${asset.name} does not match its published checksum`);
    }
    // a file: URI: the installer takes only file: and vscode-remote: ones, and globalStorageUri
    // has the vscode-userdata: scheme (installing from it fails with "No Servers")
    await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(file));
  } catch (e) {
    await fs.rm(file, { force: true });
    void vscode.window.showErrorMessage(`Updating Realtime TeX to ${asset.version} failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  await ctx.globalState.update(PENDING, asset.version);
  // keep only the package just installed
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) if (f !== asset.name) await fs.rm(path.join(dir, f), { force: true });
  const pick = await vscode.window.showInformationMessage(`Realtime TeX was updated to ${asset.version}. Reload the window to use it.`, 'Reload Window');
  if (pick) await vscode.commands.executeCommand('workbench.action.reloadWindow');
}
