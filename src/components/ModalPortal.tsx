import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Renders children into document.body.
 *
 * Why this exists: a `fixed inset-0` overlay is only "above everything" if no
 * ancestor has created a stacking context. Several overlays in the route
 * planning UI live inside `#main-stats-cards`, which is `relative z-50`, so
 * their own z-index — even z-[9999] — only ranked *within* that box and the
 * sticky nav (z-[70]) painted over them. Raising their z-index can never fix
 * that; the element has to leave the subtree. Portaling does exactly that and
 * changes nothing else about layout or styling.
 */
export default function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
