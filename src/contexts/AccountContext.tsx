import { createContext, useContext, useEffect, useState, ReactNode, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { setAccountTimeZone } from '../utils/dateUtils';

interface Account {
  id: string;
  accountName: string;
  agencyId: string;
  agency_id?: string;
  status: string;
  createdAt: string;
  // Raw DB columns. The accounts table is hydrated via `select('*')` so
  // these snake_case fields exist at runtime; declaring them lets us
  // pick `company_name` over the (often-legacy) `account_name` when
  // rendering the brand label.
  account_name?: string | null;
  company_name?: string | null;
  /** IANA zone from Account Branding settings. Drives how visit dates and
   *  times are stamped and displayed — see setAccountTimeZone. */
  timezone?: string | null;
}

/**
 * Pick the best human-readable label for an account. Prefer the brand-
 * facing `company_name` (e.g. "Camino", "Validus") and fall back to the
 * raw `account_name` (which for some legacy rows is literally
 * "Default Account") and finally a generic "Account" so we never render
 * an empty string. Exported so the header + account switcher in App.tsx
 * stay in sync with anywhere else that needs a display label.
 */
export function getAccountDisplayName(
  acc: Partial<Account> | null | undefined,
): string {
  if (!acc) return 'Account';
  const company = acc.company_name?.trim();
  if (company) return company;
  const name = acc.account_name?.trim() || acc.accountName?.trim();
  if (name) return name;
  return 'Account';
}

interface AccountMembership {
  account_id: string;
  role: 'account_admin' | 'user';
  joined_at: string;
}

interface AccountContextType {
  currentAccount: Account | null;
  accounts: Account[];
  accountRole: 'account_admin' | 'user' | null;
  isAgencyAdmin: boolean;
  loading: boolean;
  selectAccount: (accountId: string) => Promise<boolean>;
  refreshAccounts: () => Promise<void>;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);

  // Publish the account's timezone to the date helpers. The Account Branding
  // screen has always promised "all dates and times across the account will be
  // displayed in this timezone", but nothing read the column — so visit stamps
  // came out in the browser's zone, or UTC from Postgres. One place to set it,
  // so every consumer of getAccountTimeZone() agrees.
  useEffect(() => {
    setAccountTimeZone(currentAccount?.timezone);
  }, [currentAccount?.id, currentAccount?.timezone]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountRole, setAccountRole] = useState<'account_admin' | 'user' | null>(null);
  const [isAgencyAdmin, setIsAgencyAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadAccounts();
    } else {
      setCurrentAccount(null);
      setAccounts([]);
      setAccountRole(null);
      setIsAgencyAdmin(false);
      setLoading(false);
    }
  }, [user]);

  async function loadAccounts() {
    if (!user) return;

    try {
      console.log('[AccountContext] Loading accounts for user:', user.id);
      setLoading(true);
      setIsAgencyAdmin(false);

      let accountsData: Account[] = [];
      const primaryOwnerAccountIds = new Set<string>();

      // Memberships are the source of truth for regular users and co-owners.
      // A co-owner may have isAgencyOwner=true, but still receives explicit
      // account_users rows and must not fall into the primary-owner shortcut.
      const { data: memberships, error: membershipsError } = await supabase
        .from('account_users')
        .select('account_id, role, joined_at')
        .eq('user_id', user.id);

      if (membershipsError) throw membershipsError;

      if (memberships?.length) {
        const accountIds = memberships.map((membership: AccountMembership) => membership.account_id);
        const { data, error: accountsError } = await supabase
          .from('accounts')
          .select('*')
          .in('id', accountIds);

        if (accountsError) throw accountsError;
        accountsData = data || [];
      }

      // The primary owner legitimately has agency-wide access even if legacy
      // accounts do not contain a matching account_users row.
      if (user.isAgencyOwner) {
        const { data: agency } = await supabase
          .from('agencies')
          .select('id')
          .eq('owner_email', user.email)
          .maybeSingle();

        if (agency) {
          const { data: ownerAccounts, error: ownerAccountsError } = await supabase
            .from('accounts')
            .select('*')
            .eq('agency_id', agency.id);

          if (ownerAccountsError) throw ownerAccountsError;
          for (const account of ownerAccounts || []) {
            primaryOwnerAccountIds.add(account.id);
          }

          accountsData = Array.from(
            new Map([...accountsData, ...(ownerAccounts || [])].map((account) => [account.id, account])).values(),
          );
        }
      }

      if (accountsData.length === 0) {
        console.log('[AccountContext] No accounts found for user');
        setAccounts([]);
        setCurrentAccount(null);
        setAccountRole(null);
        setIsAgencyAdmin(false);
        setLoading(false);
        return;
      }

      setAccounts(accountsData);

      // Set current account (first one or from localStorage)
      const savedAccountId = localStorage.getItem('currentAccountId');
      let selectedAccount = accountsData[0] || null;

      if (savedAccountId) {
        const found = accountsData.find((a: Account) => a.id === savedAccountId);
        if (found) selectedAccount = found;
      }

      console.log('[AccountContext] Setting current account:', selectedAccount?.id);

      if (selectedAccount) {
        setCurrentAccount(selectedAccount);
        const selectedMembership = memberships?.find(
          (membership: AccountMembership) => membership.account_id === selectedAccount.id,
        );
        setAccountRole(
          selectedMembership?.role
          || (primaryOwnerAccountIds.has(selectedAccount.id) ? 'account_admin' : null),
        );
        const { data: agencyAdmin } = await supabase.rpc('is_agency_admin_for_account', {
          target_account_id: selectedAccount.id,
        });
        setIsAgencyAdmin(agencyAdmin === true);
        localStorage.setItem('currentAccountId', selectedAccount.id);
      }
      console.log('[AccountContext] Finished loading accounts');
    } catch (error) {
      console.error('[AccountContext] Error loading accounts:', error);
    } finally {
      console.log('[AccountContext] Setting loading to false');
      setLoading(false);
    }
  }

  async function selectAccount(accountId: string) {
    if (!user) return false;

    const account = accounts.find(a => a.id === accountId);

    if (!account) return false;

    // Clear agency-wide authority before changing account context so controls
    // from the previous account cannot flash while the scoped check runs.
    setIsAgencyAdmin(false);
    setAccountRole(null);
    setCurrentAccount(account);

    const { data: membership } = await supabase
      .from('account_users')
      .select('role')
      .eq('account_id', accountId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membership?.role) {
      setAccountRole(membership.role);
    } else if (user.isAgencyOwner && account.agency_id) {
      const { data: primaryAgency } = await supabase
        .from('agencies')
        .select('id')
        .eq('id', account.agency_id)
        .eq('owner_email', user.email)
        .maybeSingle();
      setAccountRole(primaryAgency ? 'account_admin' : null);
    } else {
      setAccountRole(null);
    }

    const { data: agencyAdmin } = await supabase.rpc('is_agency_admin_for_account', {
      target_account_id: accountId,
    });
    setIsAgencyAdmin(agencyAdmin === true);

    localStorage.setItem('currentAccountId', accountId);
    return true;
  }

  async function refreshAccounts() {
    await loadAccounts();
  }

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    currentAccount,
    accounts,
    accountRole,
    isAgencyAdmin,
    loading,
    selectAccount,
    refreshAccounts,
  }), [currentAccount, accounts, accountRole, isAgencyAdmin, loading]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (context === undefined) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
}
