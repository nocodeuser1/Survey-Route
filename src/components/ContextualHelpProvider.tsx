import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const LONG_PRESS_MS = 650;
const MOVE_TOLERANCE_PX = 10;
const TOOLTIP_ID = 'contextual-button-help';

type ActiveHelp = {
  button: HTMLButtonElement;
  text: string;
  left: number;
  top: number;
};

type TouchTracking = {
  button: HTMLButtonElement;
  pointerId: number;
  startX: number;
  startY: number;
  timer: number;
  shown: boolean;
};

const ICON_HELP: Record<string, string> = {
  'arrow-down': 'Move down',
  'arrow-left': 'Go back',
  'arrow-right': 'Continue',
  'arrow-up': 'Move up',
  'activity': 'View activity',
  'building-2': 'Manage facility',
  'calendar': 'Choose date',
  'camera': 'Take photo',
  'check': 'Confirm',
  'check-circle': 'Mark complete',
  'chevron-down': 'Show options',
  'chevron-left': 'Previous',
  'chevron-right': 'Next',
  'chevron-up': 'Hide options',
  'circle-x': 'Close',
  'columns': 'Choose visible columns',
  'copy': 'Copy',
  'download': 'Download',
  'edit': 'Edit',
  'edit-2': 'Edit',
  'edit-3': 'Edit',
  'eye': 'Show',
  'eye-off': 'Hide',
  'filter': 'Filter',
  'file-text': 'View document',
  'folder-open': 'Choose file',
  'globe': 'Open website',
  'history': 'View history',
  'image': 'View photos',
  'list': 'View list',
  'log-out': 'Sign out',
  'map-pin': 'View on map',
  'menu': 'Open menu',
  'minus': 'Remove',
  'more-horizontal': 'More options',
  'more-vertical': 'More options',
  'pencil': 'Edit',
  'plus': 'Add',
  'qr-code': 'Generate QR code',
  'refresh-cw': 'Refresh',
  'rotate-ccw': 'Undo',
  'save': 'Save changes',
  'search': 'Search',
  'settings': 'Settings',
  'smartphone': 'Open mobile view',
  'star': 'Set rating',
  'trash': 'Delete',
  'trash-2': 'Delete',
  'undo-2': 'Undo',
  'upload': 'Upload',
  'user-cog': 'Manage account',
  'user-plus': 'Add user',
  'x': 'Close',
  'x-circle': 'Close',
};

function getButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest('button');
}

function getIconHelp(button: HTMLButtonElement): string | null {
  const icon = button.querySelector('svg[class*="lucide-"]');
  const iconClass = Array.from(icon?.classList ?? []).find((name) => name.startsWith('lucide-'));
  if (!iconClass) return null;

  const iconName = iconClass.slice('lucide-'.length);
  return ICON_HELP[iconName] ?? `Use ${iconName.replace(/-/g, ' ')}`;
}

function getHelpText(button: HTMLButtonElement): string | null {
  const explicit = button.getAttribute('data-contextual-help') || button.getAttribute('title');
  if (explicit) return explicit.trim();

  // An icon-only button may already have a good accessible name. Surface that
  // same name visually without adding redundant help to visible text buttons.
  if (!button.innerText.trim()) {
    return button.getAttribute('aria-label')?.trim() || getIconHelp(button);
  }

  return null;
}

function hasAccessibleName(button: HTMLButtonElement): boolean {
  return Boolean(
    button.getAttribute('aria-label') ||
    button.getAttribute('aria-labelledby') ||
    button.innerText.trim()
  );
}

function ensureAccessibleName(button: HTMLButtonElement) {
  const text = getHelpText(button);
  if (text && !hasAccessibleName(button)) button.setAttribute('aria-label', text);
}

/**
 * Adds one consistent help surface for compact and icon-only buttons.
 *
 * Existing `title` attributes become accessible hover/focus tooltips. On
 * touch screens the same text appears only after a deliberate press-and-hold;
 * a regular tap remains an immediate activation. Pointer movement and scroll
 * cancel the hold, and no pointer defaults are cancelled, so scrolling,
 * dragging, and native selection remain untouched.
 */
export default function ContextualHelpProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveHelp | null>(null);
  const touchRef = useRef<TouchTracking | null>(null);
  const suppressClickRef = useRef<HTMLButtonElement | null>(null);
  const lastTouchAtRef = useRef(0);

  const hide = () => setActive(null);

  const show = (button: HTMLButtonElement) => {
    const text = getHelpText(button);
    if (!text || button.disabled) return;

    ensureAccessibleName(button);

    const rect = button.getBoundingClientRect();
    setActive({
      button,
      text,
      left: Math.min(Math.max(rect.left + rect.width / 2, 12), window.innerWidth - 12),
      top: Math.min(rect.bottom + 8, window.innerHeight - 12),
    });
  };

  useEffect(() => {
    if (!active) return;

    const previousDescription = active.button.getAttribute('aria-describedby');
    const descriptions = new Set((previousDescription || '').split(/\s+/).filter(Boolean));
    descriptions.add(TOOLTIP_ID);
    active.button.setAttribute('aria-describedby', Array.from(descriptions).join(' '));

    return () => {
      if (previousDescription) active.button.setAttribute('aria-describedby', previousDescription);
      else active.button.removeAttribute('aria-describedby');
    };
  }, [active]);

  useEffect(() => {
    const sync = (root: ParentNode) => {
      root.querySelectorAll<HTMLButtonElement>('button').forEach(ensureAccessibleName);
    };
    sync(document);

    // New rows, dialogs, and dynamic toolbar actions receive the same explicit
    // screen-reader label as soon as they are rendered.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof HTMLButtonElement) {
          ensureAccessibleName(record.target);
        }
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLButtonElement) ensureAccessibleName(node);
          if (node instanceof Element) sync(node);
        });
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title', 'data-contextual-help'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const clearTouch = () => {
      const tracking = touchRef.current;
      if (!tracking) return;
      window.clearTimeout(tracking.timer);
      touchRef.current = null;
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const button = getButton(event.target);
      if (button) show(button);
    };

    const onPointerOut = (event: PointerEvent) => {
      const button = getButton(event.target);
      if (button && (!event.relatedTarget || !button.contains(event.relatedTarget as Node))) hide();
    };

    const onFocusIn = (event: FocusEvent) => {
      // Tapping a button also focuses it on many mobile browsers. That focus
      // must not bypass the intentional press-and-hold requirement.
      if (Date.now() - lastTouchAtRef.current < 900) return;
      const button = getButton(event.target);
      if (button) show(button);
    };

    const onFocusOut = (event: FocusEvent) => {
      const button = getButton(event.target);
      if (button && (!event.relatedTarget || !button.contains(event.relatedTarget as Node))) hide();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      lastTouchAtRef.current = Date.now();
      hide();
      clearTouch();

      const button = getButton(event.target);
      if (!button || button.disabled || !getHelpText(button)) return;

      const tracking: TouchTracking = {
        button,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        timer: window.setTimeout(() => {
          if (!touchRef.current || touchRef.current.pointerId !== event.pointerId) return;
          touchRef.current.shown = true;
          suppressClickRef.current = button;
          show(button);
        }, LONG_PRESS_MS),
        shown: false,
      };
      touchRef.current = tracking;
    };

    const onPointerMove = (event: PointerEvent) => {
      const tracking = touchRef.current;
      if (!tracking || event.pointerId !== tracking.pointerId) return;
      if (Math.hypot(event.clientX - tracking.startX, event.clientY - tracking.startY) > MOVE_TOLERANCE_PX) {
        clearTouch();
      }
    };

    const onPointerUpOrCancel = (event: PointerEvent) => {
      if (touchRef.current?.pointerId === event.pointerId) clearTouch();
    };

    const onClick = (event: MouseEvent) => {
      const button = getButton(event.target);
      if (button && suppressClickRef.current === button) {
        // A completed hold is help-only. This happens after the hold has
        // already been shown; ordinary taps never reach this branch.
        event.preventDefault();
        event.stopPropagation();
        suppressClickRef.current = null;
      }
    };

    const onScroll = () => {
      clearTouch();
      hide();
    };

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUpOrCancel, true);
    document.addEventListener('pointercancel', onPointerUpOrCancel, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    return () => {
      clearTouch();
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUpOrCancel, true);
      document.removeEventListener('pointercancel', onPointerUpOrCancel, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <>
      {children}
      {active && createPortal(
        <div
          id={TOOLTIP_ID}
          role="tooltip"
          className="fixed z-[10000] max-w-[min(20rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-md bg-gray-900 px-2.5 py-1.5 text-center text-xs font-medium text-white shadow-lg dark:bg-gray-700"
          style={{ left: active.left, top: active.top, pointerEvents: 'none' }}
        >
          {active.text}
        </div>,
        document.body
      )}
    </>
  );
}
