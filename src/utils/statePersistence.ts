const STORAGE_PREFIX = 'surveyHub_';

interface StorageOptions {
  debounceMs?: number;
}

class StatePersistenceManager {
  private debounceTimers: Map<string, number> = new Map();

  set(key: string, value: any, options: StorageOptions = {}): void {
    const storageKey = `${STORAGE_PREFIX}${key}`;

    if (options.debounceMs) {
      const existingTimer = this.debounceTimers.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = window.setTimeout(() => {
        this.performSet(storageKey, value);
        this.debounceTimers.delete(key);
      }, options.debounceMs);

      this.debounceTimers.set(key, timer);
    } else {
      this.performSet(storageKey, value);
    }
  }

  private performSet(storageKey: string, value: any): void {
    try {
      const serialized = JSON.stringify(value);
      localStorage.setItem(storageKey, serialized);
    } catch (error) {
      console.warn(`Failed to persist state for ${storageKey}:`, error);
    }
  }

  get<T>(key: string, defaultValue?: T): T | null {
    const storageKey = `${STORAGE_PREFIX}${key}`;

    try {
      const item = localStorage.getItem(storageKey);
      if (item === null) {
        return defaultValue ?? null;
      }
      return JSON.parse(item) as T;
    } catch (error) {
      console.warn(`Failed to retrieve state for ${storageKey}:`, error);
      return defaultValue ?? null;
    }
  }

  remove(key: string): void {
    const storageKey = `${STORAGE_PREFIX}${key}`;
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.warn(`Failed to remove state for ${storageKey}:`, error);
    }
  }

  clear(keyPrefix?: string): void {
    try {
      if (keyPrefix) {
        const fullPrefix = `${STORAGE_PREFIX}${keyPrefix}`;
        const keysToRemove: string[] = [];

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(fullPrefix)) {
            keysToRemove.push(key);
          }
        }

        keysToRemove.forEach(key => localStorage.removeItem(key));
      } else {
        const keysToRemove: string[] = [];

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(STORAGE_PREFIX)) {
            keysToRemove.push(key);
          }
        }

        keysToRemove.forEach(key => localStorage.removeItem(key));
      }
    } catch (error) {
      console.warn('Failed to clear state:', error);
    }
  }

  cleanup(): void {
    this.debounceTimers.forEach(timer => clearTimeout(timer));
    this.debounceTimers.clear();
  }
}

export const statePersistence = new StatePersistenceManager();

export function saveScrollPosition(containerId: string, scrollTop: number): void {
  statePersistence.set(`scroll_${containerId}`, scrollTop, { debounceMs: 100 });
}

export function getScrollPosition(containerId: string): number {
  return statePersistence.get<number>(`scroll_${containerId}`, 0) ?? 0;
}

export function restoreScrollPosition(containerId: string, callback?: () => void): void {
  const scrollTop = getScrollPosition(containerId);

  if (scrollTop > 0) {
    requestAnimationFrame(() => {
      const container = document.getElementById(containerId);
      if (container) {
        container.scrollTop = scrollTop;
        callback?.();
      }
    });
  } else if (callback) {
    callback();
  }
}

export function setupScrollPersistence(containerId: string): () => void {
  const container = document.getElementById(containerId);
  if (!container) {
    return () => {};
  }

  const handleScroll = () => {
    saveScrollPosition(containerId, container.scrollTop);
  };

  container.addEventListener('scroll', handleScroll, { passive: true });

  return () => {
    container.removeEventListener('scroll', handleScroll);
  };
}
