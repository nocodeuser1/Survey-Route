import { createContext, useContext, useEffect, useState, ReactNode, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

interface Account {
  id: string;
  accountName: string;
  agencyId: string;
  status: string;
  createdAt: string;
  // Raw DB columns. The accounts table is hydrated via `select('*')` so
  // these snake_case fields exist at runtime; declaring them lets us
  // pick `company_name` over the (often-legacy) `account_name` when
  // rendering the brand label.
  account_name?: string | null;
  company_name?: string | null;
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
  loading: boolean;
  selectAccount: (accountId: string) => void;
  refreshAccounts: () => Promise<void>;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountRole, setAccountRole] = useState<'account_admin' | 'user' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadAccounts();
    } else {
      setCurrentAccount(null);
      setAccounts([]);
      setAccountRole(null);
      setLoading(false);
    }
  }, [user]);

  async function loadAccounts() {
    if (!user) return;

    try {
      console.log('[AccountContext] Loading accounts for user:', user.id);
      setLoading(true);

      let accountsData: Account[] = [];
      let isAgencyOwner = false;

      // Check if user is an agency owner
      if (user.isAgencyOwner) {
        console.log('[AccountContext] User is agency owner');
        isAgencyOwner = true;
        // Agency owners can access all accounts under their agency
        const { data: agency } = await supabase
          .from('agencies')
          .select('id')
          .eq('owner_email', user.email)
          .maybeSingle();

        if (agency) {
          const { data, error } = await supabase
            .from('accounts')
            .select('*')
            .eq('agency_id', agency.id);

          if (error) throw error;
          accountsData = data || [];
          console.log('[AccountContext] Loaded accounts for agency owner:', accountsData.length);
        }
      } else {
        // Regular users - get accounts they belong to
        console.log('[AccountContext] Loading memberships for regular user');
        const { data: memberships, error: membershipsError } = await supabase
          .from('account_users')
          .select('account_id, role, joined_at')
          .eq('user_id', user.id);

        console.log('[AccountContext] Memberships query result:', { memberships, error: membershipsError });

        if (membershipsError) throw membershipsError;

        if (memberships && memberships.length > 0) {
          const accountIds = memberships.map((m: AccountMembership) => m.account_id);
          console.log('[AccountContext] Loading accounts for IDs:', accountIds);
          const { data, error: accountsError } = await supabase
            .from('accounts')
            .select('*')
            .in('id', accountIds);

          if (accountsError) throw accountsError;
          accountsData = data || [];
          console.log('[AccountContext] Loaded accounts:', accountsData.length);
        } else {
          console.log('[AccountContext] No memberships found for user');
        }
      }

      if (accountsData.length === 0) {
        console.log('[AccountContext] No accounts found for user');
        setAccounts([]);
        setCurrentAccount(null);
        setAccountRole(null);
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
        // Agency owners get full admin access
        if (isAgencyOwner) {
          setAccountRole('account_admin');
        } else {
          // Look up membership role for regular users
          const { data: membership } = await supabase
            .from('account_users')
            .select('role')
            .eq('account_id', selectedAccount.id)
            .eq('user_id', user.id)
            .maybeSingle();
          console.log('[AccountContext] Membership role:', membership?.role);
          setAccountRole(membership?.role || null);
        }
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
    const account = accounts.find(a => a.id === accountId);
    if (!account || !user) return;

    setCurrentAccount(account);

    // Agency owners get full admin access
    if (user.isAgencyOwner) {
      setAccountRole('account_admin');
    } else {
      // Look up membership role for regular users
      const { data: membership } = await supabase
        .from('account_users')
        .select('role')
        .eq('account_id', accountId)
        .eq('user_id', user.id)
        .maybeSingle();
      setAccountRole(membership?.role || null);
    }

    localStorage.setItem('currentAccountId', accountId);
  }

  async function refreshAccounts() {
    await loadAccounts();
  }

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    currentAccount,
    accounts,
    accountRole,
    loading,
    selectAccount,
    refreshAccounts,
  }), [currentAccount, accounts, accountRole, loading]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (context === undefined) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
}
