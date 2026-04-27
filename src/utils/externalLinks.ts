export function initExternalLinks() {
  const onClick = (e: MouseEvent) => {
    const path = e.composedPath();
    const anchor = path.find((n): n is HTMLAnchorElement =>
      n instanceof HTMLAnchorElement && !!n.href);
    if (!anchor) return;
    const url = anchor.href;
    if (!/^https?:\/\//i.test(url)) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      window.tai?.shell?.openExternal(url);
    }
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}
