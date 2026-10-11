// Prebuilt rtex from realtime-tex's GitHub releases: which archive fits this machine, and the
// version and checksum arithmetic around it. Pure module.

/** The engine's GitHub repository (`owner/name`): kenny-21342's fork of realtime-tex, whose
 * releases carry the fork's work. Releases come from here unless `realtimeTex.engine.repository`
 * names another GitHub repository (upstream HenryXiaoYang/realtime-tex, another fork). */
export const DEFAULT_RELEASE_REPO = 'kenny-21342/realtime-tex';

/** The fork's working branch: its `main` mirrors upstream. */
export const DEFAULT_RELEASE_BRANCH = 'kenny/main';

/** `owner/name` of a GitHub repository URL (`https://github.com/o/n`, `.git` and a trailing slash
 * allowed, or `git@github.com:o/n.git`); undefined for anything else. */
export function githubRepo(url: string): string | undefined {
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** The branch of `repo` (a URL or `owner/name`) used when `realtimeTex.engine.branch` is empty:
 * the fork's working branch for the default repository, `main` for any other. */
export function defaultBranch(repo: string): string {
  const r = githubRepo(repo) ?? repo.trim();
  return r.toLowerCase() === DEFAULT_RELEASE_REPO ? DEFAULT_RELEASE_BRANCH : 'main';
}

export function releasesApi(repo = DEFAULT_RELEASE_REPO): string {
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

export interface ReleaseTarget {
  /** Rust target triple, as in the asset name `rtex-<triple>.<ext>`. */
  triple: string;
  ext: 'tar.gz' | 'zip';
}

/** The release archive for `platform`/`arch` (Node's names); undefined where no prebuilt exists. */
export function releaseTarget(platform: string, arch: string): ReleaseTarget | undefined {
  const triple: Record<string, string> = {
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'win32-x64': 'x86_64-pc-windows-msvc',
  };
  const t = triple[`${platform}-${arch}`];
  return t ? { triple: t, ext: platform === 'win32' ? 'zip' : 'tar.gz' } : undefined;
}

export function assetName(t: ReleaseTarget): string {
  return `rtex-${t.triple}.${t.ext}`;
}

export function assetUrl(tag: string, t: ReleaseTarget, repo = DEFAULT_RELEASE_REPO): string {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${assetName(t)}`;
}

/** `v0.0.2` → [0, 0, 2]; undefined when the tag is not a version. */
export function parseVersion(tag: string): number[] | undefined {
  const m = /^v?(\d+(?:\.\d+)*)/.exec(tag.trim());
  return m ? m[1].split('.').map(Number) : undefined;
}

/** Whether release `tag` is newer than `installed` (unknown versions are never newer). */
export function isNewer(tag: string, installed: string | undefined): boolean {
  const a = parseVersion(tag);
  if (!a) return false;
  const b = installed ? parseVersion(installed) : undefined;
  if (!b) return true;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/** The hex digest in a `<sha256>  <file>` (or `<sha256> *<file>`) line for `file`, or the only
 * digest of a one-line `.sha256` file. */
export function sha256For(text: string, file: string): string | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    const m = /^([0-9a-fA-F]{64})(?:\s+\*?(.+))?$/.exec(l);
    if (m && (m[2] === undefined ? lines.length === 1 : m[2].trim() === file)) return m[1].toLowerCase();
  }
  return undefined;
}

/** Semver order of two versions, prerelease identifiers included (`0.0.2-main.5` sorts after
 * `0.0.1` and before `0.0.2`; numeric identifiers compare as numbers): <0, 0 or >0. A leading
 * `v` is ignored. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/, '').split('+')[0].split(/-(.*)/s, 2);
    return { core: core.split('.').map((n) => Number(n) || 0), pre: pre ? pre.split('.') : [] };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d) return d;
  }
  // a release is newer than its prereleases
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      const d = Number(p) - Number(q);
      if (d) return d;
    } else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** The extension's package in a release's assets (`realtime-tex-<version>.vsix`), its version,
 * and its `.sha256` file when the release has one. */
export function vsixAsset(assets: readonly ReleaseAsset[]): { name: string; version: string; url: string; sha256Url?: string } | undefined {
  for (const a of assets) {
    const m = /^realtime-tex-(\d[\w.+-]*)\.vsix$/.exec(a.name);
    if (!m) continue;
    const sum = assets.find((s) => s.name === `${a.name}.sha256`);
    return { name: a.name, version: m[1], url: a.browser_download_url, sha256Url: sum?.browser_download_url };
  }
  return undefined;
}
