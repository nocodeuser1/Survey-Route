import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAccount } from './AccountContext';
import { supabase } from '../lib/supabase';

interface DarkModeContextType {
  darkMode: boolean;
  toggleDarkMode: () => void;
}

const DarkModeContext = createContext<DarkModeContextType | undefined>(undefined);

export function DarkModeProvider({ children }: { children: ReactNode }) {
  // user unused
  const { currentAccount } = useAccount();
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved === 'true';
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    if (currentAccount?.id) {
      loadDarkModePreference();
    }
  }, [currentAccount]);

  const loadDarkModePreference = async () => {
    if (!currentAccount?.id) return;

    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('dark_mode')
        .eq('account_id', currentAccount.id)
        .maybeSingle();

      if (error) throw error;

      if (data && data.dark_mode !== null) {
        setDarkMode(data.dark_mode);
        localStorage.setItem('darkMode', String(data.dark_mode));
      }
    } catch (err) {
      console.error('Error loading dark mode preference:', err);
    }
  };

  const toggleDarkMode = async () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem('darkMode', String(newMode));

    if (currentAccount?.id) {
      try {
        await supabase
          .from('user_settings')
          .update({ dark_mode: newMode })
          .eq('account_id', currentAccount.id);
      } catch (err) {
        console.error('Error saving dark mode preference:', err);
      }
    }
  };

  return (
    <DarkModeContext.Provider value={{ darkMode, toggleDarkMode }}>
      {children}
    </DarkModeContext.Provider>
  );
}

export function useDarkMode() {
  const context = useContext(DarkModeContext);
  if (context === undefined) {
    throw new Error('useDarkMode must be used within a DarkModeProvider');
  }
  return context;
}
