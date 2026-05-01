function isScrollable(el: Element): boolean {
  const style = window.getComputedStyle(el);
  const ox = style.overflowX;
  const oy = style.overflowY;
  const scrollable = (v: string) => v === 'auto' || v === 'scroll' || v === 'overlay';
  return (
    (scrollable(ox) && el.scrollWidth > el.clientWidth) ||
    (scrollable(oy) && el.scrollHeight > el.clientHeight)
  );
}

function onEnter(e: Event) {
  const el = e.target;
  if (el instanceof Element && isScrollable(el)) el.setAttribute('data-scrollhover', '');
}

function onLeave(e: Event) {
  const el = e.target;
  if (el instanceof Element) el.removeAttribute('data-scrollhover');
}

export function initScrollbarHover() {
  document.addEventListener('mouseenter', onEnter, true);
  document.addEventListener('mouseleave', onLeave, true);
  return () => {
    document.removeEventListener('mouseenter', onEnter, true);
    document.removeEventListener('mouseleave', onLeave, true);
  };
}
