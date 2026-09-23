import { useEffect, useId, useRef, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';

interface AccountOption {
  id: string;
  name: string;
}

interface AccountSwitcherProps {
  accounts: AccountOption[];
  currentAccountId: string;
  onSelect: (accountId: string) => void;
}

export default function AccountSwitcher({ accounts, currentAccountId, onSelect }: AccountSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const currentAccount = accounts.find((account) => account.id === currentAccountId);
  const accountName = currentAccount?.name || 'Account';
  const currentIndex = accounts.findIndex((account) => account.id === currentAccountId);

  useEffect(() => {
    if (!open) return;

    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    items?.[Math.max(0, currentIndex)]?.focus();

    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open, currentIndex]);

  return (
    <div
      className="relative min-w-0"
      ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Switch account, current account: ${accountName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Switch between your company accounts"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex min-h-9 max-w-[11rem] items-center gap-1.5 rounded-md bg-transparent px-2 py-1.5 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:text-white dark:hover:bg-gray-700 dark:hover:text-white dark:focus-visible:ring-offset-gray-800 sm:max-w-[20rem]"
      >
        <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{accountName}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="Switch account"
          className="absolute left-0 top-full z-[90] mt-2 w-72 max-w-[calc(100vw-4.5rem)] overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 text-gray-900 shadow-xl dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          onKeyDown={(event) => {
            if (event.key === 'Tab') {
              setOpen(false);
              triggerRef.current?.focus();
              return;
            }
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            let nextIndex: number;
            if (event.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
            else if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = items.length - 1;
            else return;
            event.preventDefault();
            items[nextIndex]?.focus();
          }}
        >
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Switch account</p>
          <div className="max-h-[min(20rem,60dvh)] overflow-y-auto">
            {accounts.map((account) => {
              const active = account.id === currentAccountId;
              return (
                <button
                  key={account.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  tabIndex={-1}
                  title={active ? undefined : `Switch to ${account.name}`}
                  onClick={() => {
                    setOpen(false);
                    triggerRef.current?.focus();
                    if (!active) onSelect(account.id);
                  }}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 ${active ? 'bg-blue-600 font-bold text-white' : 'font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'}`}
                >
                  <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 break-words">{account.name}</span>
                  {active && <Check className="h-4 w-4 shrink-0 text-white" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          {accounts.length === 1 && (
            <p className="px-3 py-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              Accept another company invitation to add it here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
