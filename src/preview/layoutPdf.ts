// Use the same native-page decision as the renderer. A degraded-but-native page does not
// need the full document PDF; missing fonts or images still require it.
import type { PageUpdate } from '../protocol';
import { nativeOf } from '../../webview/native';

export function layoutNeedsPdf(pages: readonly PageUpdate[], missing: (page: PageUpdate) => boolean): boolean {
  return pages.some((page) => (!page.exact && !nativeOf(page)) || missing(page));
}
