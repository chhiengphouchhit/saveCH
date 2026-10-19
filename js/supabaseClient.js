/**
 * Supabase Client & Offline-First Storage Engine
 * Manages Supabase Auth, PostgreSQL RLS transactions, and IndexedDB local sync queue
 */

const DB_NAME = 'saveCH_EngineDB';
const DB_VERSION = 1;
const STORE_TRANSACTIONS = 'transactions';
const STORE_CONFIG = 'config';

// Storage key helper with fallback for backwards compatibility
const getStorageVal = (key, fallback = '') => {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(`savech_${key}`) ?? localStorage.getItem(`pocketai_${key}`) ?? fallback;
};

class StorageSyncEngine {
  constructor() {
    this.db = null;
    this.supabase = null;
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.syncInProgress = false;
    this.listeners = new Set();

    // Default configuration (supports both savech_ and legacy pocketai_ keys)
    this.config = {
      supabaseUrl: getStorageVal('sb_url', 'https://bhenhujwovbnmsajoxmn.supabase.co'),
      supabaseKey: getStorageVal('sb_key', 'sb_publishable_e1R9ThI8oTt_OovzRA885w_P0B6NnDx'),
      geminiKey: getStorageVal('gemini_key', ''),
      exchangeRate: parseFloat(getStorageVal('exchange_rate', '4100')),
      monthlyBudget: parseFloat(getStorageVal('budget', '500')),
      initialBalance: parseFloat(getStorageVal('initial_balance', '0')),
      fixedSalary: parseFloat(getStorageVal('fixed_salary', '739.34')),
      fixedSecondJob: parseFloat(getStorageVal('fixed_second_job', '220.00')),
      fixedCarPayment: parseFloat(getStorageVal('fixed_car', '232.54')),
      fixedHousePayment: parseFloat(getStorageVal('fixed_house', '185.00')),
      preferredCurrency: getStorageVal('currency', 'USD')
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.notifyListeners('network_status', { isOnline: true });
        this.syncPendingTransactions();
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
        this.notifyListeners('network_status', { isOnline: false });
      });
    }
  }

  // Initialize IndexedDB with timeout protection and cached instance
  async initDB() {
    if (this.db) return this.db;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve) => {
      let isSettled = false;
      const settle = (val) => {
        if (!isSettled) {
          isSettled = true;
          this._initPromise = null;
          resolve(val);
        }
      };

      // Safety timeout: never freeze app for more than 1000ms
      const timer = setTimeout(() => {
        console.warn('IndexedDB initialization timed out. Using fallback.');
        settle(null);
      }, 1000);

      try {
        if (!window.indexedDB) {
          clearTimeout(timer);
          return settle(null);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onblocked = () => {
          console.warn('IndexedDB blocked by another tab or lock.');
          clearTimeout(timer);
          settle(this.db || null);
        };

        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_TRANSACTIONS)) {
            const transStore = db.createObjectStore(STORE_TRANSACTIONS, { keyPath: 'id' });
            transStore.createIndex('sync_status', 'sync_status', { unique: false });
            transStore.createIndex('transaction_date', 'transaction_date', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_CONFIG)) {
            db.createObjectStore(STORE_CONFIG, { keyPath: 'key' });
          }
        };

        request.onsuccess = (e) => {
          clearTimeout(timer);
          this.db = e.target.result;
          settle(this.db);
        };

        request.onerror = (e) => {
          clearTimeout(timer);
          console.warn('IndexedDB open error:', e);
          settle(null);
        };
      } catch (err) {
        clearTimeout(timer);
        console.warn('IndexedDB exception:', err);
        settle(null);
      }
    });

    return this._initPromise;
  }

  cleanSupabaseUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const cleaned = url.trim();
    const match = cleaned.match(/https?:\/\/[^\/]+\.supabase\.co/i);
    if (match) return match[0];
    return cleaned.replace(/\/+$/, '');
  }

  // Initialize Supabase client if credentials exist
  initSupabase() {
    const rawUrl = this.config.supabaseUrl;
    const cleanUrl = this.cleanSupabaseUrl(rawUrl);
    if (cleanUrl) this.config.supabaseUrl = cleanUrl;

    if (this.config.supabaseUrl && this.config.supabaseKey && typeof window !== 'undefined' && window.supabase) {
      try {
        this.supabase = window.supabase.createClient(
          this.config.supabaseUrl,
          this.config.supabaseKey.trim(),
          {
            auth: {
              persistSession: true,
              autoRefreshToken: true
            }
          }
        );
        return true;
      } catch (err) {
        console.error('Failed to init Supabase:', err);
        this.supabase = null;
        return false;
      }
    }
    this.supabase = null;
    return false;
  }

  // Update Settings
  async saveConfig(newConfig) {
    if (newConfig.supabaseUrl) {
      newConfig.supabaseUrl = this.cleanSupabaseUrl(newConfig.supabaseUrl);
    }
    this.config = { ...this.config, ...newConfig };
    const setKey = (k, v) => {
      localStorage.setItem(`savech_${k}`, v);
      localStorage.setItem(`pocketai_${k}`, v);
    };
    if (newConfig.supabaseUrl !== undefined) setKey('sb_url', this.config.supabaseUrl);
    if (newConfig.supabaseKey !== undefined) setKey('sb_key', this.config.supabaseKey);
    if (newConfig.geminiKey !== undefined) setKey('gemini_key', this.config.geminiKey);
    if (newConfig.exchangeRate !== undefined) setKey('exchange_rate', this.config.exchangeRate);
    if (newConfig.monthlyBudget !== undefined) setKey('budget', this.config.monthlyBudget);
    if (newConfig.initialBalance !== undefined) setKey('initial_balance', this.config.initialBalance);
    if (newConfig.fixedSalary !== undefined) setKey('fixed_salary', this.config.fixedSalary);
    if (newConfig.fixedSecondJob !== undefined) setKey('fixed_second_job', this.config.fixedSecondJob);
    if (newConfig.fixedCarPayment !== undefined) setKey('fixed_car', this.config.fixedCarPayment);
    if (newConfig.fixedHousePayment !== undefined) setKey('fixed_house', this.config.fixedHousePayment);
    if (newConfig.preferredCurrency !== undefined) setKey('currency', this.config.preferredCurrency);

    this.initSupabase();
    this.notifyListeners('config_changed', this.config);
  }

  // Listen for sync & state events
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyListeners(event, payload) {
    for (const listener of this.listeners) {
      try {
        listener(event, payload);
      } catch (e) {
        console.error('Listener callback error:', e);
      }
    }
  }

  // =========================================================================
  // LOCAL STORAGE / INDEXEDDB CRUD
  // =========================================================================
  async getLocalTransactions() {
    await this.initDB();
    if (!this.db) {
      try {
        const raw = localStorage.getItem('savech_tx_fallback') || localStorage.getItem('pocketai_tx_fallback');
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    }
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([STORE_TRANSACTIONS], 'readonly');
        const store = tx.objectStore(STORE_TRANSACTIONS);
        const req = store.getAll();
        req.onsuccess = () => {
          const sorted = (req.result || []).sort(
            (a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime()
          );
          // Mirror to localStorage fallback for backup
          try {
            localStorage.setItem('savech_tx_fallback', JSON.stringify(sorted));
          } catch (e) {}
          resolve(sorted);
        };
        req.onerror = () => {
          try {
            const raw = localStorage.getItem('savech_tx_fallback') || localStorage.getItem('pocketai_tx_fallback');
            resolve(raw ? JSON.parse(raw) : []);
          } catch (e) {
            resolve([]);
          }
        };
      } catch (err) {
        try {
          const raw = localStorage.getItem('savech_tx_fallback') || localStorage.getItem('pocketai_tx_fallback');
          resolve(raw ? JSON.parse(raw) : []);
        } catch (e) {
          resolve([]);
        }
      }
    });
  }

  async saveLocalTransaction(transaction) {
    await this.initDB();
    // Always mirror to localStorage fallback
    try {
      const raw = localStorage.getItem('savech_tx_fallback');
      const list = raw ? JSON.parse(raw) : [];
      const idx = list.findIndex((x) => x.id === transaction.id);
      if (idx >= 0) list[idx] = transaction;
      else list.unshift(transaction);
      localStorage.setItem('savech_tx_fallback', JSON.stringify(list));
    } catch (e) {}

    if (!this.db) return transaction;

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction([STORE_TRANSACTIONS], 'readwrite');
        const store = tx.objectStore(STORE_TRANSACTIONS);
        const req = store.put(transaction);
        req.onsuccess = () => resolve(transaction);
        req.onerror = (e) => resolve(transaction); // Don't crash caller
      } catch (err) {
        resolve(transaction);
      }
    });
  }

  async deleteLocalTransaction(id) {
    await this.initDB();
    try {
      const raw = localStorage.getItem('savech_tx_fallback');
      if (raw) {
        const list = JSON.parse(raw).filter((x) => x.id !== id);
        localStorage.setItem('savech_tx_fallback', JSON.stringify(list));
      }
    } catch (e) {}

    if (!this.db) return true;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([STORE_TRANSACTIONS], 'readwrite');
        const store = tx.objectStore(STORE_TRANSACTIONS);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(true);
      } catch (err) {
        resolve(true);
      }
    });
  }

  async clearAllLocalData() {
    await this.initDB();
    try {
      localStorage.removeItem('savech_tx_fallback');
      localStorage.removeItem('pocketai_tx_fallback');
    } catch (e) {}

    if (!this.db) return true;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction([STORE_TRANSACTIONS], 'readwrite');
        const store = tx.objectStore(STORE_TRANSACTIONS);
        store.clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(true);
      } catch (err) {
        resolve(true);
      }
    });
  }

  getOrCreateDeviceId() {
    let devId = '';
    try {
      devId = localStorage.getItem('savech_device_user_id') || localStorage.getItem('pocketai_device_user_id') || '';
    } catch (e) {}

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!devId || !uuidRegex.test(devId)) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        devId = crypto.randomUUID();
      } else {
        devId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }
      try {
        localStorage.setItem('savech_device_user_id', devId);
      } catch (e) {}
    }
    return devId;
  }

  // Schema compliance helper for Supabase PostgreSQL transactions table
  sanitizeForSupabase(item, userId) {
    return {
      id: item.id,
      user_id: userId,
      type: item.type === 'income' ? 'income' : 'expense',
      amount: Number(item.amount),
      currency: item.currency === 'KHR' ? 'KHR' : 'USD',
      base_amount_usd: Number(item.base_amount_usd),
      exchange_rate_used: Number(item.exchange_rate_used || 4100),
      category: item.category || 'other',
      payment_method: item.payment_method || 'ABA_KHQR',
      note: item.note || '',
      sync_status: 'synced',
      transaction_date: item.transaction_date || new Date().toISOString(),
      created_at: item.created_at || new Date().toISOString()
    };
  }

  // =========================================================================
  // HIGH-LEVEL DATA OPERATIONS (OPTIMISTIC UI + SYNC)
  // =========================================================================
  async addTransaction(item) {
    // 1. Mark as pending_sync if we want to sync to Supabase
    const toSave = {
      ...item,
      sync_status: this.supabase && this.isOnline ? 'synced' : 'pending_sync'
    };

    // 2. Commit immediately to local storage (Optimistic UI)
    await this.saveLocalTransaction(toSave);
    this.notifyListeners('transaction_added', toSave);

    // 3. Background sync to Supabase (using auth user ID or device persistent UUID)
    if (this.supabase && this.isOnline) {
      try {
        const user = await this.getCurrentUser();
        const effectiveUserId = (user && user.id) ? user.id : this.getOrCreateDeviceId();
        const payload = this.sanitizeForSupabase(toSave, effectiveUserId);
        const { error } = await this.supabase.from('transactions').upsert(payload);
        if (!error) {
          toSave.sync_status = 'synced';
          await this.saveLocalTransaction(toSave);
          this.notifyListeners('sync_status_updated', { status: 'synced' });
        } else {
          console.warn('Supabase sync insert failed, queued for later:', error.message || error);
          toSave.sync_status = 'pending_sync';
          await this.saveLocalTransaction(toSave);
          this.notifyListeners('sync_status_updated', { status: 'pending' });
        }
      } catch (err) {
        console.warn('Network error while saving to Supabase:', err);
        toSave.sync_status = 'pending_sync';
        await this.saveLocalTransaction(toSave);
        this.notifyListeners('sync_status_updated', { status: 'pending' });
      }
    }

    return toSave;
  }

  async deleteTransaction(id) {
    await this.deleteLocalTransaction(id);
    this.notifyListeners('transaction_deleted', id);

    if (this.supabase && this.isOnline) {
      try {
        await this.supabase.from('transactions').delete().eq('id', id);
      } catch (e) {
        console.warn('Supabase delete remote error:', e);
      }
    }
  }

  // Background Sync Queue Worker
  async syncPendingTransactions() {
    if (this.syncInProgress || !this.supabase || !this.isOnline) return;
    this.syncInProgress = true;
    this.notifyListeners('sync_started', {});

    try {
      const all = await this.getLocalTransactions();
      const pending = all.filter((t) => t.sync_status === 'pending_sync');

      if (pending.length === 0) {
        this.notifyListeners('sync_completed', { syncedCount: 0 });
        this.notifyListeners('sync_status_updated', { status: 'synced' });
        this.syncInProgress = false;
        return;
      }

      const user = await this.getCurrentUser();
      const effectiveUserId = (user && user.id) ? user.id : this.getOrCreateDeviceId();
      const payload = pending.map((t) => this.sanitizeForSupabase(t, effectiveUserId));

      const { error } = await this.supabase.from('transactions').upsert(payload);

      if (!error) {
        for (const item of payload) {
          await this.saveLocalTransaction(item);
        }
        this.notifyListeners('sync_completed', { syncedCount: pending.length });
        this.notifyListeners('sync_status_updated', { status: 'synced' });
      } else {
        console.warn('Supabase batch sync error:', error.message || error);
        this.notifyListeners('sync_failed', { error });
        this.notifyListeners('sync_status_updated', { status: 'pending' });
      }
    } catch (err) {
      console.error('Sync pending exception:', err);
      this.notifyListeners('sync_failed', { error: err });
      this.notifyListeners('sync_status_updated', { status: 'offline' });
    } finally {
      this.syncInProgress = false;
    }
  }

  // =========================================================================
  // SUPABASE AUTH HELPERS
  // =========================================================================
  async getCurrentUser() {
    if (!this.supabase) return null;
    try {
      const { data: { user } } = await this.supabase.auth.getUser();
      return user;
    } catch (e) {
      return null;
    }
  }

  async signInWithEmail(email) {
    if (!this.supabase) throw new Error('Supabase not configured');
    return await this.supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
  }

  async signInWithOAuth(provider = 'google') {
    if (!this.supabase) throw new Error('Supabase not configured');
    return await this.supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin }
    });
  }

  async signOut() {
    if (this.supabase) {
      await this.supabase.auth.signOut();
    }
  }
}

export const syncEngine = new StorageSyncEngine();
export { StorageSyncEngine };
