import { createContext, useContext, useEffect, useState, ReactNode, useMemo, useRef } from 'react';
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

type AccountRole = 'account_admin' | 'user';

interface AccountMembership {
  account_id: string;
  role: AccountRole;
  joined_at: string;
}

interface AccountContextType {
  currentAccount: Account | null;
  accounts: Account[];
  accountRole: AccountRole | null;
  isAgencyAdmin: boolean;
  loading: boolean;
  selectAccount: (accountId: string) => Promise<boolean>;
  refreshAccounts: () => Promise<void>;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

const ACCOUNT_CACHE_VERSION = 1;
const ACCOUNT_CACHE_PREFIX = 'survey-route:account-state:v1:';

interface CachedAccountState {
  version: typeof ACCOUNT_CACHE_VERSION;
  userId: string;
  accounts: Account[];
  selectedAccountId: string | null;
  rolesByAccountId: Record<string, AccountRole | null>;
  agencyAdminByAccountId: Record<string, boolean>;
  cachedAt: number;
}

interface AccountUserIdentity {
  id: string;
  email: string;
  isAgencyOwner: boolean;
}

function accountCacheKey(userId: string) {
  return `${ACCOUNT_CACHE_PREFIX}${encodeURIComponent(userId)}`;
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCachedAccount(value: unknown): value is Account {
  return isRecord(value) && typeof value.id === 'string';
}

function readCachedAccountState(userId: string): CachedAccountState | null {
  try {
    const raw = localStorage.getItem(accountCacheKey(userId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || parsed.version !== ACCOUNT_CACHE_VERSION
      || parsed.userId !== userId
      || !Array.isArray(parsed.accounts)
      || !parsed.accounts.every(isCachedAccount)
    ) {
      return null;
    }

    const accounts = parsed.accounts;
    const accountIds = new Set(accounts.map((account) => account.id));
    const rolesByAccountId: Record<string, AccountRole | null> = {};
    const agencyAdminByAccountId: Record<string, boolean> = {};

    if (isRecord(parsed.rolesByAccountId)) {
      for (const [accountId, role] of Object.entries(parsed.rolesByAccountId)) {
        if (accountIds.has(accountId) && (role === 'account_admin' || role === 'user' || role === null)) {
          rolesByAccountId[accountId] = role;
        }
      }
    }

    if (isRecord(parsed.agencyAdminByAccountId)) {
      for (const [accountId, isAdmin] of Object.entries(parsed.agencyAdminByAccountId)) {
        if (accountIds.has(accountId) && typeof isAdmin === 'boolean') {
          agencyAdminByAccountId[accountId] = isAdmin;
        }
      }
    }

    const selectedAccountId = typeof parsed.selectedAccountId === 'string'
      && accountIds.has(parsed.selectedAccountId)
      ? parsed.selectedAccountId
      : accounts[0]?.id || null;

    return {
      version: ACCOUNT_CACHE_VERSION,
      userId,
      accounts,
      selectedAccountId,
      rolesByAccountId,
      agencyAdminByAccountId,
      cachedAt: typeof parsed.cachedAt === 'number' ? parsed.cachedAt : 0,
    };
  } catch (error) {
    console.warn('[AccountContext] Could not read cached account state:', error);
    return null;
  }
}

function writeCachedAccountState(cached: CachedAccountState) {
  try {
    localStorage.setItem(accountCacheKey(cached.userId), JSON.stringify(cached));
  } catch (error) {
    console.warn('[AccountContext] Could not cache account state:', error);
  }
}

function readCurrentAccountId() {
  try {
    return localStorage.getItem('currentAccountId');
  } catch {
    return null;
  }
}

function writeCurrentAccountId(accountId: string | null) {
  try {
    if (accountId) {
      localStorage.setItem('currentAccountId', accountId);
    } else {
      localStorage.removeItem('currentAccountId');
    }
  } catch (error) {
    console.warn('[AccountContext] Could not save selected account:', error);
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountRole, setAccountRole] = useState<AccountRole | null>(null);
  const [isAgencyAdmin, setIsAgencyAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accountStateUserId, setAccountStateUserId] = useState<string | null>(null);

  const activeUserIdRef = useRef<string | null>(null);
  const accountsRef = useRef<Account[]>([]);
  const selectedAccountIdRef = useRef<string | null>(null);
  const rolesByAccountIdRef = useRef<Record<string, AccountRole | null>>({});
  const agencyAdminByAccountIdRef = useRef<Record<string, boolean>>({});
  const accountCacheRef = useRef<CachedAccountState | null>(null);
  const selectionRevisionRef = useRef(0);

  const userId = user?.id || null;
  const userEmail = user?.email || '';
  const userIsAgencyOwner = user?.isAgencyOwner === true;

  // Publish only the active user's account timezone to the date helpers. The
  // user-ID check also prevents a previous user's account context from being
  // observable during the render before the account hydration effect runs.
  useEffect(() => {
    setAccountTimeZone(
      userId && accountStateUserId === userId
        ? currentAccount?.timezone
        : undefined,
    );
  }, [accountStateUserId, currentAccount?.id, currentAccount?.timezone, userId]);

  useEffect(() => {
    if (!userId) {
      activeUserIdRef.current = null;
      accountsRef.current = [];
      selectedAccountIdRef.current = null;
      rolesByAccountIdRef.current = {};
      agencyAdminByAccountIdRef.current = {};
      accountCacheRef.current = null;
      selectionRevisionRef.current += 1;
      setAccountStateUserId(null);
      setCurrentAccount(null);
      setAccounts([]);
      setAccountRole(null);
      setIsAgencyAdmin(false);
      setLoading(false);
      return;
    }

    const targetUser: AccountUserIdentity = {
      id: userId,
      email: userEmail,
      isAgencyOwner: userIsAgencyOwner,
    };
    activeUserIdRef.current = userId;
    setAccountStateUserId(userId);
    selectionRevisionRef.current += 1;

    const hydratedFromCache = hydrateCachedAccounts(userId);
    if (!hydratedFromCache) {
      accountsRef.current = [];
      selectedAccountIdRef.current = null;
      rolesByAccountIdRef.current = {};
      agencyAdminByAccountIdRef.current = {};
      accountCacheRef.current = null;
      setCurrentAccount(null);
      setAccounts([]);
      setAccountRole(null);
      setIsAgencyAdmin(false);
      setLoading(!isOffline());
    }

    if (!isOffline()) void loadAccounts(targetUser, !hydratedFromCache);

    const handleOnline = () => {
      if (activeUserIdRef.current === userId) {
        void loadAccounts(targetUser, false);
      }
    };
    window.addEventListener('online', handleOnline);

    return () => window.removeEventListener('online', handleOnline);
  }, [userEmail, userId, userIsAgencyOwner]);

  function hydrateCachedAccounts(targetUserId: string) {
    const cached = readCachedAccountState(targetUserId);
    if (!cached) return false;

    const selectedAccount = cached.selectedAccountId
      ? cached.accounts.find((account) => account.id === cached.selectedAccountId) || null
      : null;

    accountCacheRef.current = cached;
    accountsRef.current = cached.accounts;
    selectedAccountIdRef.current = selectedAccount?.id || null;
    rolesByAccountIdRef.current = { ...cached.rolesByAccountId };
    agencyAdminByAccountIdRef.current = { ...cached.agencyAdminByAccountId };

    setAccounts(cached.accounts);
    setCurrentAccount(selectedAccount);
    setAccountRole(
      selectedAccount
        ? cached.rolesByAccountId[selectedAccount.id] ?? null
        : null,
    );
    setIsAgencyAdmin(
      selectedAccount
        ? cached.agencyAdminByAccountId[selectedAccount.id] ?? false
        : false,
    );
    setLoading(false);
    writeCurrentAccountId(selectedAccount?.id || null);
    return true;
  }

  function persistCurrentAccountCache(targetUserId: string) {
    if (activeUserIdRef.current !== targetUserId) return;

    const validAccountIds = new Set(accountsRef.current.map((account) => account.id));
    const rolesByAccountId: Record<string, AccountRole | null> = {};
    const agencyAdminByAccountId: Record<string, boolean> = {};

    for (const [accountId, role] of Object.entries(rolesByAccountIdRef.current)) {
      if (validAccountIds.has(accountId)) rolesByAccountId[accountId] = role;
    }
    for (const [accountId, admin] of Object.entries(agencyAdminByAccountIdRef.current)) {
      if (validAccountIds.has(accountId)) agencyAdminByAccountId[accountId] = admin;
    }

    const selectedAccountId = selectedAccountIdRef.current
      && validAccountIds.has(selectedAccountIdRef.current)
      ? selectedAccountIdRef.current
      : accountsRef.current[0]?.id || null;

    const cached: CachedAccountState = {
      version: ACCOUNT_CACHE_VERSION,
      userId: targetUserId,
      accounts: accountsRef.current,
      selectedAccountId,
      rolesByAccountId,
      agencyAdminByAccountId,
      cachedAt: Date.now(),
    };
    accountCacheRef.current = cached;
    writeCachedAccountState(cached);
  }

  async function loadAccounts(targetUser: AccountUserIdentity, showLoading = true) {
    if (activeUserIdRef.current !== targetUser.id) return;
    if (isOffline()) {
      setLoading(false);
      return;
    }

    try {
      console.log('[AccountContext] Loading accounts for user:', targetUser.id);
      if (showLoading) setLoading(true);
      const selectionRevisionAtStart = selectionRevisionRef.current;

      let accountsData: Account[] = [];
      const primaryOwnerAccountIds = new Set<string>();

      // Memberships are the source of truth for regular users and co-owners.
      // A co-owner may have isAgencyOwner=true, but still receives explicit
      // account_users rows and must not fall into the primary-owner shortcut.
      const { data: memberships, error: membershipsError } = await supabase
        .from('account_users')
        .select('account_id, role, joined_at')
        .eq('user_id', targetUser.id);

      if (membershipsError) throw membershipsError;
      if (activeUserIdRef.current !== targetUser.id) return;

      const membershipRows = (memberships || []) as AccountMembership[];

      if (membershipRows.length) {
        const accountIds = membershipRows.map((membership) => membership.account_id);
        const { data, error: accountsError } = await supabase
          .from('accounts')
          .select('*')
          .in('id', accountIds);

        if (accountsError) throw accountsError;
        accountsData = (data || []) as Account[];
      }

      // The primary owner legitimately has agency-wide access even if legacy
      // accounts do not contain a matching account_users row.
      if (targetUser.isAgencyOwner) {
        const { data: agency, error: agencyError } = await supabase
          .from('agencies')
          .select('id')
          .eq('owner_email', targetUser.email)
          .maybeSingle();

        if (agencyError) throw agencyError;

        if (agency) {
          const { data: ownerAccounts, error: ownerAccountsError } = await supabase
            .from('accounts')
            .select('*')
            .eq('agency_id', agency.id);

          if (ownerAccountsError) throw ownerAccountsError;
          for (const account of ownerAccounts || []) {
            primaryOwnerAccountIds.add(account.id);
          }

          accountsData = Array.from<Account>(
            new Map([...accountsData, ...(ownerAccounts || [])].map((account) => [account.id, account])).values(),
          );
        }
      }

      if (activeUserIdRef.current !== targetUser.id) return;

      if (accountsData.length === 0) {
        console.log('[AccountContext] No accounts found for user');
        accountsRef.current = [];
        selectedAccountIdRef.current = null;
        rolesByAccountIdRef.current = {};
        agencyAdminByAccountIdRef.current = {};
        setAccountStateUserId(targetUser.id);
        setAccounts([]);
        setCurrentAccount(null);
        setAccountRole(null);
        setIsAgencyAdmin(false);
        writeCurrentAccountId(null);
        persistCurrentAccountCache(targetUser.id);
        return;
      }

      const validAccountIds = new Set(accountsData.map((account) => account.id));
      const rolesByAccountId: Record<string, AccountRole | null> = {};
      for (const membership of membershipRows) {
        if (
          validAccountIds.has(membership.account_id)
          && (membership.role === 'account_admin' || membership.role === 'user')
        ) {
          rolesByAccountId[membership.account_id] = membership.role;
        }
      }
      for (const accountId of primaryOwnerAccountIds) {
        if (!(accountId in rolesByAccountId)) rolesByAccountId[accountId] = 'account_admin';
      }

      const agencyAdminByAccountId: Record<string, boolean> = {};
      const previousAgencyAdminValues = accountCacheRef.current?.userId === targetUser.id
        ? accountCacheRef.current.agencyAdminByAccountId
        : agencyAdminByAccountIdRef.current;
      for (const account of accountsData) {
        const previousValue = previousAgencyAdminValues[account.id];
        if (typeof previousValue === 'boolean') {
          agencyAdminByAccountId[account.id] = previousValue;
        }
      }

      let selectedAccount = accountsData[0] || null;
      const savedAccountId = readCurrentAccountId();
      const cachedSelectedAccountId = accountCacheRef.current?.userId === targetUser.id
        ? accountCacheRef.current.selectedAccountId
        : null;
      for (const candidateId of [savedAccountId, cachedSelectedAccountId]) {
        if (!candidateId) continue;
        const found = accountsData.find((account) => account.id === candidateId);
        if (found) {
          selectedAccount = found;
          break;
        }
      }

      console.log('[AccountContext] Setting current account:', selectedAccount?.id);

      if (selectedAccount) {
        const { data: agencyAdmin, error: agencyAdminError } = await supabase.rpc('is_agency_admin_for_account', {
          target_account_id: selectedAccount.id,
        });

        if (agencyAdminError) {
          console.error('[AccountContext] Error checking agency admin access:', agencyAdminError);
        } else {
          agencyAdminByAccountId[selectedAccount.id] = agencyAdmin === true;
        }
      }

      if (activeUserIdRef.current !== targetUser.id) return;

      // If the user selected a different account while this refresh was in
      // flight, keep that selection and merge any cached authorization result
      // for it rather than snapping back to the earlier account.
      if (selectionRevisionRef.current !== selectionRevisionAtStart) {
        const activelySelectedAccount = accountsData.find(
          (account) => account.id === selectedAccountIdRef.current,
        );
        if (activelySelectedAccount) selectedAccount = activelySelectedAccount;
        for (const account of accountsData) {
          const currentValue = agencyAdminByAccountIdRef.current[account.id];
          if (typeof currentValue === 'boolean') {
            agencyAdminByAccountId[account.id] = currentValue;
          }
        }
      }

      accountsRef.current = accountsData;
      selectedAccountIdRef.current = selectedAccount?.id || null;
      rolesByAccountIdRef.current = rolesByAccountId;
      agencyAdminByAccountIdRef.current = agencyAdminByAccountId;
      setAccountStateUserId(targetUser.id);
      setAccounts(accountsData);
      setCurrentAccount(selectedAccount);
      setAccountRole(
        selectedAccount
          ? rolesByAccountId[selectedAccount.id] ?? null
          : null,
      );
      setIsAgencyAdmin(
        selectedAccount
          ? agencyAdminByAccountId[selectedAccount.id] ?? false
          : false,
      );
      writeCurrentAccountId(selectedAccount?.id || null);
      persistCurrentAccountCache(targetUser.id);
      console.log('[AccountContext] Finished loading accounts');
    } catch (error) {
      console.error('[AccountContext] Error loading accounts:', error);
      // Preserve the last user-matched cache when a refresh fails. A later
      // online event or explicit refresh will revalidate it.
    } finally {
      if (activeUserIdRef.current === targetUser.id) {
        console.log('[AccountContext] Setting loading to false');
        setLoading(false);
      }
    }
  }

  async function selectAccount(accountId: string) {
    if (!userId || accountStateUserId !== userId) return false;

    const account = accountsRef.current.find((candidate) => candidate.id === accountId);

    if (!account) return false;

    // Apply only authorization metadata cached for the destination account.
    // This avoids flashing authority inherited from the previous account and
    // also makes account switching functional with no connection.
    selectionRevisionRef.current += 1;
    selectedAccountIdRef.current = accountId;
    const cachedRole = rolesByAccountIdRef.current[accountId] ?? null;
    const cachedAgencyAdmin = agencyAdminByAccountIdRef.current[accountId] ?? false;
    setCurrentAccount(account);
    setAccountRole(cachedRole);
    setIsAgencyAdmin(cachedAgencyAdmin);
    writeCurrentAccountId(accountId);
    persistCurrentAccountCache(userId);

    if (isOffline()) return true;

    const { data: membership, error: membershipError } = await supabase
      .from('account_users')
      .select('role')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .maybeSingle();

    let roleWasRevalidated = false;
    let revalidatedRole = cachedRole;
    if (membershipError) {
      console.error('[AccountContext] Error checking account role:', membershipError);
    } else if (membership?.role === 'account_admin' || membership?.role === 'user') {
      revalidatedRole = membership.role;
      roleWasRevalidated = true;
    } else if (userIsAgencyOwner && (account.agency_id || account.agencyId)) {
      const { data: primaryAgency, error: primaryAgencyError } = await supabase
        .from('agencies')
        .select('id')
        .eq('id', account.agency_id || account.agencyId)
        .eq('owner_email', userEmail)
        .maybeSingle();

      if (primaryAgencyError) {
        console.error('[AccountContext] Error checking primary owner access:', primaryAgencyError);
      } else {
        revalidatedRole = primaryAgency ? 'account_admin' : null;
        roleWasRevalidated = true;
      }
    } else {
      revalidatedRole = null;
      roleWasRevalidated = true;
    }

    if (roleWasRevalidated && activeUserIdRef.current === userId) {
      rolesByAccountIdRef.current[accountId] = revalidatedRole;
      if (selectedAccountIdRef.current === accountId) setAccountRole(revalidatedRole);
    }

    const { data: agencyAdmin, error: agencyAdminError } = await supabase.rpc('is_agency_admin_for_account', {
      target_account_id: accountId,
    });

    if (agencyAdminError) {
      console.error('[AccountContext] Error checking agency admin access:', agencyAdminError);
    } else if (activeUserIdRef.current === userId) {
      const revalidatedAgencyAdmin = agencyAdmin === true;
      agencyAdminByAccountIdRef.current[accountId] = revalidatedAgencyAdmin;
      if (selectedAccountIdRef.current === accountId) setIsAgencyAdmin(revalidatedAgencyAdmin);
    }

    persistCurrentAccountCache(userId);
    return true;
  }

  async function refreshAccounts() {
    if (!userId) return;
    await loadAccounts({
      id: userId,
      email: userEmail,
      isAgencyOwner: userIsAgencyOwner,
    }, accountCacheRef.current?.userId !== userId);
  }

  const accountStateMatchesUser = Boolean(userId && accountStateUserId === userId);

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    currentAccount: accountStateMatchesUser ? currentAccount : null,
    accounts: accountStateMatchesUser ? accounts : [],
    accountRole: accountStateMatchesUser ? accountRole : null,
    isAgencyAdmin: accountStateMatchesUser ? isAgencyAdmin : false,
    loading: userId ? (accountStateMatchesUser ? loading : true) : false,
    selectAccount,
    refreshAccounts,
  }), [accountRole, accountStateMatchesUser, accounts, currentAccount, isAgencyAdmin, loading, userId]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (context === undefined) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
}
