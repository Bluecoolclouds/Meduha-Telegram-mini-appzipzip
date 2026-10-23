import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';

export type Theme = 'light' | 'dark';
const THEME_KEY = 'meduha.theme.v1';
const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
  persistenceError: boolean;
} | null>(null);

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // The theme still works for this session if browser storage is unavailable.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [persistenceError, setPersistenceError] = useState(false);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#151416' : '#fffbf7');
  }, [theme]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_KEY && (event.newValue === 'light' || event.newValue === 'dark')) {
        setTheme(event.newValue);
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
      setPersistenceError(false);
    } catch {
      setPersistenceError(true);
    }
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme, persistenceError }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemeProvider is required');
  return context;
}

export function ThemeToggle() {
  const { theme, toggleTheme, persistenceError } = useTheme();
  const label = theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему';
  return <div className="m-theme-control">
    <button type="button" className="m-theme-toggle" onClick={toggleTheme}
      aria-label={label} title={label} aria-pressed={theme === 'dark'}>
      <span className="m-theme-thumb" aria-hidden="true" />
      <Sun size={16} aria-hidden="true" />
      <Moon size={16} aria-hidden="true" />
    </button>
    {persistenceError && <span className="m-theme-warning" role="status">Тема изменена, но браузер не позволил сохранить выбор.</span>}
  </div>;
}
