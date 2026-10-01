import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface ScrollableTabStripProps {
  /** Changing this scrolls the active tab back into view. */
  activeKey: string;
  /** Classes for the scrolling element itself (layout, padding, overflow-x). */
  className?: string;
  /**
   * Tailwind `from-*` colours for the edge fades — these must match the
   * surface behind the strip or the gradient reads as a grey smear.
   */
  fadeClassName?: string;
  /** Render the scroller as a landmark when it is a page-level tab bar. */
  as?: 'div' | 'nav';
  ariaLabel?: string;
  children: ReactNode;
}

/**
 * A horizontal tab strip that stays usable when it is wider than the screen.
 *
 * Two things a plain `overflow-x-auto` row gets wrong on a phone:
 *
 *   1. The active tab can sit entirely off-screen — switch tabs from a
 *      keyboard, a deep link or a state change and the panel content updates
 *      while the strip still shows a completely different part of itself.
 *   2. Touch devices have no resting scrollbar, so nothing suggests there are
 *      more tabs. Settings has ten tabs across 1675px of strip in a 263px
 *      viewport; without a hint, six of them may as well not exist.
 *
 * Mark the active child with `data-tab-active="true"` and this keeps it in
 * view and fades whichever edge has more to scroll.
 */
export default function ScrollableTabStrip({
  activeKey,
  className = '',
  fadeClassName = 'from-white dark:from-gray-900',
  as: Scroller = 'div',
  ariaLabel,
  children,
}: ScrollableTabStripProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // Ignore the last few pixels at each end: there is nothing worth hinting
    // at, and the fade would just wash out the tab sitting under it.
    const EDGE = 12;
    setEdges({ left: el.scrollLeft > EDGE, right: el.scrollLeft < max - EDGE });
  }, []);

  useEffect(() => {
    // 'nearest' on both axes so only the strip moves, never the page.
    // 'auto' rather than 'smooth' because this also runs on first paint.
    scrollerRef.current
      ?.querySelector<HTMLElement>('[data-tab-active="true"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    sync();
  }, [activeKey, sync]);

  useEffect(() => {
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [sync]);

  return (
    <div className="relative">
      <Scroller ref={scrollerRef} onScroll={sync} className={className} aria-label={ariaLabel}>
        {children}
      </Scroller>

      {edges.left && (
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r to-transparent ${fadeClassName}`}
          aria-hidden="true"
        />
      )}
      {edges.right && (
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l to-transparent ${fadeClassName}`}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
