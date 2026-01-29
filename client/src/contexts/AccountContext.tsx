import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { CfCredential } from '@/types';
import { getCredentials } from '@/services/credentials';

interface AccountContextType {
  accounts: CfCredential[];
  currentAccountId: number | 'all' | null;
  isLoading: boolean;
  error: string | null;
  switchAccount: (id: number | 'all') => void;
  refreshAccounts: () => Promise<void>;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

const STORAGE_KEY = 'cf_current_account_id';

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<CfCredential[]>([]);
  const [currentAccountId, setCurrentAccountId] = useState<number | 'all' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载账户列表
  const loadAccounts = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getCredentials();

      if (response.success && response.data) {
        const accountList = response.data.credentials;
        setAccounts(accountList);

        // 初始化当前账户
        if (accountList.length > 0) {
          // 尝试从 localStorage 恢复上次选中的账户
          const savedAccountId = localStorage.getItem(STORAGE_KEY);

          if (savedAccountId === 'all') {
            setCurrentAccountId('all');
          } else if (savedAccountId) {
            const savedId = parseInt(savedAccountId);
            const accountExists = accountList.some(acc => acc.id === savedId);
            if (accountExists) {
              setCurrentAccountId(savedId);
            } else {
              // 如果保存的账户不存在，使用默认账户
              const defaultAccount = accountList.find(acc => acc.isDefault);
              setCurrentAccountId(defaultAccount?.id || accountList[0].id);
            }
          } else {
            // 首次使用，选择默认账户
            const defaultAccount = accountList.find(acc => acc.isDefault);
            setCurrentAccountId(defaultAccount?.id || accountList[0].id);
          }
        }
      }
    } catch (err: any) {
      if (typeof err === 'string') {
        setError(err);
      } else {
        setError(err?.message || '加载账户列表失败');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 切换账户
  const switchAccount = (id: number | 'all') => {
    setCurrentAccountId(id);
    localStorage.setItem(STORAGE_KEY, String(id));
  };

  // 刷新账户列表
  const refreshAccounts = async () => {
    await loadAccounts();
  };

  // 初始化加载
  useEffect(() => {
    loadAccounts();
  }, []);

  return (
    <AccountContext.Provider
      value={{
        accounts,
        currentAccountId,
        isLoading,
        error,
        switchAccount,
        refreshAccounts,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (context === undefined) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
}
