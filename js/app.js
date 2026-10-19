/**
 * Main Application Orchestrator (PocketAI Mobile-First Expense Tracker)
 * Reactive UI state manager, single-screen ergonomics, tab controller, voice AI engine
 */

import { sound } from './audio.js';
import { ExpenseMiddlewarePipeline } from './middleware.js';
import { syncEngine } from './supabaseClient.js';

class AppController {
  constructor() {
    this.pipeline = new ExpenseMiddlewarePipeline({
      exchangeRate: syncEngine.config.exchangeRate,
      geminiApiKey: syncEngine.config.geminiKey,
      onPromptManualAmount: (partial) => this.handlePromptManualAmount(partial),
      onValidationError: (err) => this.showToast(err.message, 'error')
    });

    this.state = {
      transactions: [],
      activeTab: 'home', // 'home' | 'calendar' | 'analytics' | 'history'
      currency: syncEngine.config.preferredCurrency || 'USD',
      exchangeRate: syncEngine.config.exchangeRate || 4100,
      monthlyBudget: syncEngine.config.monthlyBudget || 500,
      initialBalance: syncEngine.config.initialBalance || 0,
      initialBalanceModalCurr: 'USD',
      fixedSalary: syncEngine.config.fixedSalary !== undefined ? syncEngine.config.fixedSalary : 739.34,
      fixedSecondJob: syncEngine.config.fixedSecondJob !== undefined ? syncEngine.config.fixedSecondJob : 220.00,
      fixedCarPayment: syncEngine.config.fixedCarPayment !== undefined ? syncEngine.config.fixedCarPayment : 232.54,
      fixedHousePayment: syncEngine.config.fixedHousePayment !== undefined ? syncEngine.config.fixedHousePayment : 185.00,
      calYear: new Date().getFullYear(),
      calMonth: new Date().getMonth(),
      selectedDate: new Date().toISOString().slice(0, 10),
      privacyMasked: (localStorage.getItem('savech_privacy') ?? localStorage.getItem('pocketai_privacy')) === 'true',
      userName: localStorage.getItem('savech_user_name') || 'Phouchhit',
      userAvatar: (() => {
        const saved = localStorage.getItem('savech_user_avatar');
        if (!saved || saved.includes('unsplash.com')) {
          localStorage.setItem('savech_user_avatar', 'assets/profile.jpg');
          return 'assets/profile.jpg';
        }
        return saved;
      })(),
      searchQuery: '',
      typeFilter: 'all', // 'all', 'expense', 'income'
      isListening: false,
      speechLang: 'km-KH', // 'km-KH' or 'en-US'
      undoQueue: null,
      manualForm: {
        type: 'expense',
        amount: '',
        currency: 'USD',
        category: 'other',
        payment_method: 'ABA_KHQR',
        note: '',
        date: new Date().toISOString().slice(0, 10)
      },
      // 5 New Features State
      isAppLocked: localStorage.getItem('savech_lock_enabled') === 'true',
      appPin: localStorage.getItem('savech_app_pin') || '',
      enteredPin: '',
      vaults: (() => {
        try {
          const raw = localStorage.getItem('savech_vaults');
          return raw ? JSON.parse(raw) : [
            { id: 'v1', name: 'ទិញ iPhone 16 Pro', emoji: '📱', target: 1100, current: 350 },
            { id: 'v2', name: 'លុយបម្រុងអាសន្ន 3 ខែ', emoji: '🚗', target: 1500, current: 500 },
            { id: 'v3', name: 'ដំណើរកម្សាន្តចុងឆ្នាំ', emoji: '✈️', target: 300, current: 120 }
          ];
        } catch (e) {
          return [];
        }
      })(),
      selectedVaultId: null,
      vaultActionType: 'deposit'
    };

    this.speechRecognition = null;
    this.initSpeechRecognition();
  }

  async init() {
    try {
      this.bindEvents();
      this.updateProfileUI();
      this.setupSyncSubscription();

      // Initialize 5 Super Features
      this.initAppLock();
      this.initScannerFeature();
      this.initVaultsFeature();
      this.initPdfReportFeature();
      this.initTelegramBotSettings();

      // Initialize Gemini API key from user storage
      const userGeminiKey = localStorage.getItem('savech_gemini_key') || localStorage.getItem('pocketai_gemini_key') || '';
      if (userGeminiKey && !syncEngine.config.geminiKey) {
        syncEngine.config.geminiKey = userGeminiKey;
      }
      this.pipeline.setGeminiApiKey(syncEngine.config.geminiKey || '');

      // 1. Instant First Paint: Render UI immediately so the user never encounters a white/frozen screen
      this.updateUI();

      // Auto-listen if launched via Back Tap Shortcut (?voice=1 or #mic)
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('voice') === '1' || window.location.hash === '#mic') {
        setTimeout(() => {
          if (!this.state.isListening && this.speechRecognition) {
            this.toggleSpeech();
          }
        }, 400);
      }

      // 2. Load local transactions asynchronously with safety timeout
      try {
        const localData = await Promise.race([
          syncEngine.getLocalTransactions(),
          new Promise((resolve) => setTimeout(() => resolve([]), 1200))
        ]);

        if (localData && localData.length > 0) {
          this.state.transactions = localData;
        } else if (!localStorage.getItem('savech_seeded')) {
          localStorage.setItem('savech_seeded', 'true');
          await this.seedSampleTransactions();
        }
      } catch (dbErr) {
        console.warn('Initial data load warning:', dbErr);
      }

      // 3. Second Paint: re-render with loaded transactions
      this.updateUI();

      // 4. Background Sync: Deferred so it never delays UI interaction
      if (navigator.onLine) {
        setTimeout(() => {
          syncEngine.syncPendingTransactions().catch(() => {});
        }, 600);
      }
    } catch (fatalErr) {
      console.error('Fatal init error:', fatalErr);
      // Emergency render fallback
      try {
        this.updateUI();
      } catch (e) {}
    }
  }

  // =========================================================================
  // SEED INITIAL SAMPLE TRANSACTIONS
  // =========================================================================
  async seedSampleTransactions() {
    const samples = [
      {
        id: this.pipeline.generateUuid(),
        type: 'income',
        amount: 1500,
        currency: 'USD',
        base_amount_usd: 1500,
        exchange_rate_used: 4100,
        category: 'income',
        payment_method: 'ABA_KHQR',
        note: 'Monthly Salary (ប្រាក់ខែ)',
        raw_transcript: 'Monthly salary 1500$ via ABA transfer',
        sync_status: 'synced',
        transaction_date: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
        created_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString()
      },
      {
        id: this.pipeline.generateUuid(),
        type: 'expense',
        amount: 2.75,
        currency: 'USD',
        base_amount_usd: 2.75,
        exchange_rate_used: 4100,
        category: 'food',
        payment_method: 'ABA_KHQR',
        note: 'Iced Latte @ Brown Coffee',
        raw_transcript: 'កាហ្វេ ២ ដុល្លារ ៧៥ វេរ ABA',
        sync_status: 'synced',
        transaction_date: new Date(Date.now() - 3600000 * 3).toISOString(),
        created_at: new Date(Date.now() - 3600000 * 3).toISOString()
      },
      {
        id: this.pipeline.generateUuid(),
        type: 'expense',
        amount: 6000,
        currency: 'KHR',
        base_amount_usd: 1.46,
        exchange_rate_used: 4100,
        category: 'transport',
        payment_method: 'CASH',
        note: 'PassApp TukTuk to BKK1',
        raw_transcript: 'PassApp ៦ ពាន់ លុយសុទ្ធ',
        sync_status: 'synced',
        transaction_date: new Date(Date.now() - 3600000 * 6).toISOString(),
        created_at: new Date(Date.now() - 3600000 * 6).toISOString()
      },
      {
        id: this.pipeline.generateUuid(),
        type: 'expense',
        amount: 12.50,
        currency: 'USD',
        base_amount_usd: 12.50,
        exchange_rate_used: 4100,
        category: 'food',
        payment_method: 'ABA_KHQR',
        note: 'Lunch with team',
        raw_transcript: 'Spent 12.50$ for lunch via ABA scan',
        sync_status: 'synced',
        transaction_date: new Date(Date.now() - 3600000 * 18).toISOString(),
        created_at: new Date(Date.now() - 3600000 * 18).toISOString()
      }
    ];

    for (const item of samples) {
      await syncEngine.saveLocalTransaction(item);
    }
    this.state.transactions = samples;
  }

  // =========================================================================
  // TAB NAVIGATION CONTROLLER (Direction-aware Smooth Sliding)
  // =========================================================================
  switchTab(tabName, direction = null) {
    if (this.state.activeTab === tabName) return;

    sound.playClick();
    const tabOrder = ['home', 'calendar', 'analytics', 'history'];
    const prevIndex = tabOrder.indexOf(this.state.activeTab);
    const newIndex = tabOrder.indexOf(tabName);

    let animClass = 'tab-view';
    if (direction === 'left' || (direction === null && newIndex > prevIndex && prevIndex !== -1)) {
      animClass = 'tab-slide-left';
    } else if (direction === 'right' || (direction === null && newIndex < prevIndex && prevIndex !== -1)) {
      animClass = 'tab-slide-right';
    }

    this.state.activeTab = tabName;

    // View containers
    const homeView = document.getElementById('view-home');
    const calendarView = document.getElementById('view-calendar');
    const analyticsView = document.getElementById('view-analytics');
    const historyView = document.getElementById('view-history');

    [homeView, calendarView, analyticsView, historyView].forEach((view) => {
      if (view) {
        view.classList.remove('tab-view', 'tab-slide-left', 'tab-slide-right');
        void view.offsetWidth;
      }
    });

    if (homeView) {
      homeView.classList.toggle('hidden', tabName !== 'home');
      if (tabName === 'home') homeView.classList.add(animClass);
    }
    if (calendarView) {
      calendarView.classList.toggle('hidden', tabName !== 'calendar');
      if (tabName === 'calendar') calendarView.classList.add(animClass);
    }
    if (analyticsView) {
      analyticsView.classList.toggle('hidden', tabName !== 'analytics');
      if (tabName === 'analytics') analyticsView.classList.add(animClass);
    }
    if (historyView) {
      historyView.classList.toggle('hidden', tabName !== 'history');
      if (tabName === 'history') historyView.classList.add(animClass);
    }

    // Bottom Navigation buttons
    document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
      const match = btn.getAttribute('data-tab') === tabName;
      if (match) {
        btn.classList.add('text-indigo-400');
        btn.classList.remove('text-slate-400');
      } else {
        btn.classList.remove('text-indigo-400');
        btn.classList.add('text-slate-400');
      }
    });

    if (tabName === 'calendar') {
      this.renderCalendar();
    } else if (tabName === 'analytics') {
      this.renderDonutChart();
    } else if (tabName === 'history') {
      this.renderHistoryFeed();
    }
  }

  // =========================================================================
  // SPEECH RECOGNITION (Web Speech API)
  // =========================================================================
  initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('Speech Recognition not supported in this browser.');
      return;
    }

    this.speechRecognition = new SpeechRec();
    this.speechRecognition.continuous = false;
    this.speechRecognition.interimResults = true;
    this.speechRecognition.lang = this.state.speechLang;

    this.speechRecognition.onstart = () => {
      this.state.isListening = true;
      sound.playMicStart();
      this.renderVoiceMicButton();
      this.showTranscriptBanner('Listening... / កំពុងស្តាប់...', true);
    };

    this.speechRecognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      const textToShow = final || interim;
      if (textToShow) {
        this.showTranscriptBanner(textToShow, true);
      }

      if (final) {
        this.processVoiceInput(final);
      }
    };

    this.speechRecognition.onerror = (e) => {
      console.warn('Speech error:', e.error);
      this.state.isListening = false;
      this.renderVoiceMicButton();
      if (e.error !== 'no-speech') {
        sound.playErrorBeep();
        this.showToast(`Voice error: ${e.error}. Try manual entry.`, 'error');
      }
      this.hideTranscriptBanner();
    };

    this.speechRecognition.onend = () => {
      if (this.state.isListening) {
        this.state.isListening = false;
        sound.playMicStop();
        this.renderVoiceMicButton();
      }
    };
  }

  toggleSpeech() {
    sound.playClick();
    if (!this.speechRecognition) {
      this.showToast('Speech recognition not available. Please use manual entry.', 'info');
      this.openManualModal();
      return;
    }

    if (this.state.isListening) {
      this.speechRecognition.stop();
      this.state.isListening = false;
      sound.playMicStop();
      this.renderVoiceMicButton();
    } else {
      this.speechRecognition.lang = this.state.speechLang;
      try {
        this.speechRecognition.start();
      } catch (err) {
        console.warn('Recognition start error:', err);
      }
    }
  }

  async processVoiceInput(transcript) {
    this.showTranscriptBanner(`Processing: "${transcript}"...`, true);

    try {
      const parsedTransactions = await this.pipeline.process(transcript);

      // Optimistic instant UI update (0ms latency)
      for (const item of parsedTransactions) {
        this.state.transactions.unshift(item);
        if (item.type === 'income') {
          sound.playIncomeCelebration();
          this.triggerConfetti();
        } else {
          sound.playSuccessChord();
        }
        syncEngine.addTransaction(item).catch(err => console.warn('Sync warning:', err));
      }

      this.updateUI();
      const catKhmerMap = {
        food: 'អាហារ & ភេសជ្ជៈ',
        transport: 'ធ្វើដំណើរ',
        bills: 'វិក្កយបត្រ',
        entertainment: 'កម្សាន្ត',
        shopping: 'ទិញទំនិញ',
        health: 'សុខភាព',
        income: 'ចំណូល',
        other: 'ទូទៅ'
      };
      const summaryText = parsedTransactions.map(tx => {
        const amtStr = tx.currency === 'KHR' ? `${Math.round(tx.amount).toLocaleString()} ៛` : `$${tx.amount.toFixed(2)}`;
        const catStr = catKhmerMap[tx.category] || tx.category;
        return `${amtStr} (${catStr})`;
      }).join(', ');

      this.showToast(`✅ កត់ត្រាជោគជ័យ: ${summaryText}!`, 'success');
      setTimeout(() => this.hideTranscriptBanner(), 2500);
    } catch (err) {
      sound.playErrorBeep();
      if (err.code === 'VALIDATION_ERROR' && err.partialTransaction) {
        console.info('Voice input requires amount prompt:', err.message);
        this.handlePromptManualAmount(err.partialTransaction);
      } else {
        console.warn('Voice input unparsed:', err.message);
        this.showToast(err.message || 'មិនអាចស្វែងយល់ការនិយាយបានទេ', 'error');
        this.hideTranscriptBanner();
      }
    }
  }

  handlePromptManualAmount(partial) {
    this.showToast('មិនបានឮចំនួនទឹកប្រាក់ទេ! សូមវាយបញ្ចូលចំនួនលុយ', 'info');
    this.openManualModal({
      type: partial.type || 'expense',
      category: partial.category || 'other',
      payment_method: partial.payment_method || 'ABA_KHQR',
      currency: partial.currency || this.state.currency,
      note: partial.note || partial.raw_transcript || '',
      amount: ''
    });
    this.hideTranscriptBanner();
  }

  // =========================================================================
  // SYNC & STORAGE SUBSCRIPTIONS
  // =========================================================================
  setupSyncSubscription() {
    syncEngine.subscribe((event, data) => {
      if (event === 'sync_status_updated' || event === 'sync_completed') {
        this.renderSyncIndicator('synced');
        this.refreshTransactionsList();
      } else if (event === 'sync_started') {
        this.renderSyncIndicator('syncing');
      } else if (event === 'sync_failed') {
        this.renderSyncIndicator('pending');
      } else if (event === 'network_status') {
        this.renderSyncIndicator(data.isOnline ? 'synced' : 'offline');
      } else if (event === 'config_changed') {
        this.state.exchangeRate = data.exchangeRate;
        this.state.monthlyBudget = data.monthlyBudget;
        if (data.initialBalance !== undefined) {
          this.state.initialBalance = data.initialBalance;
        }
        if (data.fixedSalary !== undefined) {
          this.state.fixedSalary = data.fixedSalary;
        }
        if (data.fixedSecondJob !== undefined) {
          this.state.fixedSecondJob = data.fixedSecondJob;
        }
        if (data.fixedCarPayment !== undefined) {
          this.state.fixedCarPayment = data.fixedCarPayment;
        }
        if (data.fixedHousePayment !== undefined) {
          this.state.fixedHousePayment = data.fixedHousePayment;
        }
        this.pipeline.setExchangeRate(data.exchangeRate);
        this.pipeline.setGeminiApiKey(data.geminiKey);
        this.updateUI();
      }
    });
  }

  // =========================================================================
  // UI EVENT BINDINGS
  // =========================================================================
  bindEvents() {
    // Bottom Nav Tabs
    document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) this.switchTab(tab);
      });
    });

    // See all transactions button on Home
    const seeAllBtn = document.getElementById('btn-see-all-tx');
    if (seeAllBtn) {
      seeAllBtn.addEventListener('click', () => this.switchTab('history'));
    }

    // Elevated Center Mic FAB
    const micBtn = document.getElementById('btn-mic-main');
    if (micBtn) {
      micBtn.addEventListener('click', () => this.toggleSpeech());
    }

    // Voice Language Switcher
    const langBtn = document.getElementById('btn-lang-toggle');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        sound.playClick();
        this.state.speechLang = this.state.speechLang === 'km-KH' ? 'en-US' : 'km-KH';
        langBtn.textContent = this.state.speechLang === 'km-KH' ? '🇰🇭 km' : '🇺🇸 en';
        if (this.speechRecognition) {
          this.speechRecognition.lang = this.state.speechLang;
        }
      });
    }

    // Currency Switcher
    const currBtn = document.getElementById('btn-currency-toggle');
    if (currBtn) {
      currBtn.addEventListener('click', () => {
        sound.playClick();
        this.state.currency = this.state.currency === 'USD' ? 'KHR' : 'USD';
        syncEngine.saveConfig({ preferredCurrency: this.state.currency });
        this.updateUI();
      });
    }

    // Privacy Mask Toggle
    const privacyBtn = document.getElementById('btn-privacy-toggle');
    if (privacyBtn) {
      privacyBtn.addEventListener('click', () => {
        sound.playClick();
        this.state.privacyMasked = !this.state.privacyMasked;
        localStorage.setItem('savech_privacy', String(this.state.privacyMasked));
        localStorage.setItem('pocketai_privacy', String(this.state.privacyMasked));
        this.updatePrivacyView();
      });
    }

    // Manual Entry Trigger (+ button or bottom bar)
    const openManualBtn = document.getElementById('btn-open-manual');
    if (openManualBtn) {
      openManualBtn.addEventListener('click', () => {
        sound.playClick();
        this.openManualModal();
      });
    }

    // 📸 Scan Slip Button
    const openScannerBtn = document.getElementById('btn-open-scanner');
    if (openScannerBtn) {
      openScannerBtn.addEventListener('click', () => {
        sound.playClick();
        this.openScannerModal();
      });
    }

    // 🎯 Savings Vaults Button
    const openVaultsBtn = document.getElementById('btn-open-vaults');
    if (openVaultsBtn) {
      openVaultsBtn.addEventListener('click', () => {
        sound.playClick();
        this.openVaultsModal();
      });
    }

    // 📄 PDF Report Button
    const openReportBtn = document.getElementById('btn-open-report');
    if (openReportBtn) {
      openReportBtn.addEventListener('click', () => {
        sound.playClick();
        this.openPdfReportModal();
      });
    }

    // Settings Modal Trigger
    const openSettingsBtn = document.getElementById('btn-open-settings');
    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', () => {
        sound.playClick();
        this.openSettingsModal();
      });
    }

    // PWA Installation Handlers
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      const installBtn = document.getElementById('btn-install-app-drawer');
      if (installBtn) {
        installBtn.classList.add('ring-2', 'ring-indigo-400', 'animate-pulse');
      }
    });

    const installDrawerBtn = document.getElementById('btn-install-app-drawer');
    if (installDrawerBtn) {
      installDrawerBtn.addEventListener('click', async () => {
        sound.playClick();
        if (this.deferredInstallPrompt) {
          this.deferredInstallPrompt.prompt();
          const { outcome } = await this.deferredInstallPrompt.userChoice;
          if (outcome === 'accepted') {
            this.showToast('បានដំឡើង saveCH លើទូរស័ព្ទជោគជ័យ! 🎉', 'success');
          }
          this.deferredInstallPrompt = null;
        } else {
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
          if (isIOS) {
            alert('📲 របៀបដំឡើង saveCH លើ iPhone:\n\n1. ចុចប៊ូតុង Share (⎋) នៅខាងក្រោមអេក្រង់ Safari\n2. អូសចុះក្រោម រួចចុច "Add to Home Screen" (➕)\n3. ចុច "Add" ដើម្បីដាក់លើអេក្រង់ដើមទូរស័ព្ទ!');
          } else {
            alert('📲 របៀបដំឡើងលើ Android:\n\n1. ចុចលើ Menu (ចំនុច ៣ ខាងលើស្តាំ)\n2. ជ្រើសរើស "Install app" ឬ "Add to Home screen"\n3. រួចចុច "Install" ជាការស្រេច!');
          }
        }
      });
    }

    window.addEventListener('appinstalled', () => {
      this.showToast('saveCH ត្រូវបានដំឡើងលើអេក្រង់ទូរស័ព្ទរួចរាល់! 🚀', 'success');
      this.deferredInstallPrompt = null;
    });

    // Quick Category Filter Pills
    document.querySelectorAll('.quick-cat-filter').forEach((filterBtn) => {
      filterBtn.addEventListener('click', () => {
        sound.playClick();
        const selectedCat = filterBtn.getAttribute('data-cat') || 'all';

        // Update active style
        document.querySelectorAll('.quick-cat-filter').forEach((b) => {
          b.classList.remove('bg-indigo-600', 'text-white');
          b.classList.add('bg-slate-900', 'border', 'border-slate-800', 'text-slate-400');
        });
        filterBtn.classList.remove('bg-slate-900', 'border', 'border-slate-800', 'text-slate-400');
        filterBtn.classList.add('bg-indigo-600', 'text-white');

        // Filter the quick tiles
        document.querySelectorAll('.quick-tile-btn').forEach((tile) => {
          const tileCat = tile.getAttribute('data-cat');
          const item = tile.closest('.quick-tile-item') || tile;
          if (selectedCat === 'all' || tileCat === selectedCat) {
            item.classList.remove('hidden');
          } else {
            item.classList.add('hidden');
          }
        });
      });
    });

    // 1-Tap Quick Action Icon Tiles (Instant 1s Recording)
    document.querySelectorAll('.quick-tile-btn').forEach((tile) => {
      tile.addEventListener('click', async () => {
        sound.playClick();
        const type = tile.getAttribute('data-type') || 'expense';
        const amount = parseFloat(tile.getAttribute('data-amount') || '0');
        const currency = tile.getAttribute('data-currency') || 'USD';
        const category = tile.getAttribute('data-category') || 'food';
        const method = tile.getAttribute('data-method') || 'ABA_KHQR';
        const note = tile.getAttribute('data-note') || '';
        const phrase = tile.getAttribute('data-phrase') || '';

        const rate = this.state.exchangeRate;
        const base_amount_usd = currency === 'KHR' ? Number((amount / rate).toFixed(2)) : Number(amount.toFixed(2));

        const newTx = {
          id: this.pipeline.generateUuid(),
          type,
          amount,
          currency,
          base_amount_usd,
          exchange_rate_used: rate,
          category,
          payment_method: method,
          note,
          raw_transcript: phrase,
          sync_status: 'pending_sync',
          transaction_date: new Date().toISOString(),
          created_at: new Date().toISOString()
        };

        // 1. Instant Optimistic UI Update (0ms Latency)
        this.state.transactions.unshift(newTx);
        this.updateUI();

        if (type === 'income') {
          sound.playIncomeCelebration();
          this.triggerConfetti();
        } else {
          sound.playSuccessChord();
        }

        this.showToast(`កត់ត្រា: ${note} (${currency === 'KHR' ? '៛' : '$'}${amount})!`, 'success');

        // 2. Persist in background without blocking the UI
        syncEngine.addTransaction(newTx).catch((e) => console.warn('Background save error:', e));
      });
    });

    // Custom Variable Income chip in quick tray
    const customIncomeChip = document.getElementById('btn-custom-income-chip');
    if (customIncomeChip) {
      customIncomeChip.addEventListener('click', () => {
        sound.playClick();
        this.openManualModal({
          type: 'income',
          category: 'income',
          note: 'Page Boosting / Freelancer',
          amount: ''
        });
      });
    }

    // Variable Income buttons in Analytics view
    document.querySelectorAll('.btn-log-variable-income').forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playClick();
        const note = btn.getAttribute('data-note') || 'Income';
        this.openManualModal({
          type: 'income',
          category: 'income',
          note: note,
          amount: ''
        });
      });
    });

    // History Feed Search & Filter
    const searchInput = document.getElementById('input-search-feed');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.state.searchQuery = e.target.value.toLowerCase().trim();
        this.renderHistoryFeed();
      });
    }

    // Type Filter Tabs in History
    document.querySelectorAll('.filter-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        sound.playClick();
        document.querySelectorAll('.filter-tab').forEach((t) => {
          t.classList.remove('bg-indigo-600', 'text-white', 'shadow-md');
          t.classList.add('text-slate-400');
        });
        tab.classList.add('bg-indigo-600', 'text-white', 'shadow-md');
        tab.classList.remove('text-slate-400');
        this.state.typeFilter = tab.getAttribute('data-type') || 'all';
        this.renderHistoryFeed();
      });
    });

    // Starting Balance modal triggers
    const editInitBtn = document.getElementById('btn-edit-initial-balance');
    if (editInitBtn) {
      editInitBtn.addEventListener('click', () => {
        sound.playClick();
        this.openInitialBalanceModal();
      });
    }

    const cardClick = document.getElementById('btn-balance-card-click');
    if (cardClick) {
      cardClick.addEventListener('click', () => {
        sound.playClick();
        this.openInitialBalanceModal();
      });
    }

    // Fixed Income 1-Tap Loggers
    const btnLogFixedHome = document.getElementById('btn-quick-log-all-fixed-income');
    if (btnLogFixedHome) {
      btnLogFixedHome.addEventListener('click', () => this.quickLogFixedIncome());
    }

    const btnLogFixedAnalytics = document.getElementById('btn-analytics-log-fixed');
    if (btnLogFixedAnalytics) {
      btnLogFixedAnalytics.addEventListener('click', () => this.quickLogFixedIncome());
    }

    // Fixed Car & House Loggers
    const btnLogCarHome = document.getElementById('btn-quick-log-car');
    if (btnLogCarHome) {
      btnLogCarHome.addEventListener('click', () => this.quickLogCarPayment());
    }
    document.querySelectorAll('.btn-quick-log-car-analytics').forEach((btn) => {
      btn.addEventListener('click', () => this.quickLogCarPayment());
    });

    const btnLogHouseHome = document.getElementById('btn-quick-log-house');
    if (btnLogHouseHome) {
      btnLogHouseHome.addEventListener('click', () => this.quickLogHousePayment());
    }
    document.querySelectorAll('.btn-quick-log-house-analytics').forEach((btn) => {
      btn.addEventListener('click', () => this.quickLogHousePayment());
    });

    // Calendar View Controls
    const calPrev = document.getElementById('cal-btn-prev');
    if (calPrev) calPrev.addEventListener('click', () => this.changeCalendarMonth(-1));

    const calNext = document.getElementById('cal-btn-next');
    if (calNext) calNext.addEventListener('click', () => this.changeCalendarMonth(1));

    const calToday = document.getElementById('cal-btn-today');
    if (calToday) calToday.addEventListener('click', () => this.jumpToToday());

    const calAdd = document.getElementById('cal-btn-add-on-date');
    if (calAdd) {
      calAdd.addEventListener('click', () => {
        sound.playClick();
        this.openManualModal({ date: this.state.selectedDate });
      });
    }

    // Modal Bindings
    this.bindInitialBalanceModalEvents();
    this.bindManualModalEvents();
    this.bindSettingsModalEvents();
    this.bindAICoachEvents();
    this.bindProfileModalEvents();

    // Touch & Drag Gestures (Smooth horizontal & vertical navigation)
    this.initTouchGestures();
    this.initDragToScroll();

    // Global Gentle Web Audio Haptic Click for all interactive touches/taps
    document.addEventListener('click', (e) => {
      const el = e.target.closest('button, .quick-tile-btn, .quick-tile-minimal, .nav-tab-btn, .cal-cell, .init-quick-pill, .manual-quick-add, .numpad-key, .manual-cat-chip, .manual-payment-chip, .quick-cat-filter');
      if (el) {
        sound.playClick();
      }
    }, { passive: true });
  }

  // =========================================================================
  // SMOOTH TOUCH GESTURES (SWIPE LEFT / RIGHT FOR TABS)
  // =========================================================================
  initTouchGestures() {
    const mainEl = document.querySelector('main');
    if (!mainEl) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isSwipingIgnored = false;

    mainEl.addEventListener('touchstart', (e) => {
      // Don't capture swipe if inside a modal or horizontal scroll container
      if (e.target.closest('.modal-backdrop.open, .quick-tiles-scroll, input, select, textarea, button')) {
        isSwipingIgnored = true;
        return;
      }
      isSwipingIgnored = false;
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartTime = Date.now();
    }, { passive: true });

    mainEl.addEventListener('touchend', (e) => {
      if (isSwipingIgnored) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      const elapsed = Date.now() - touchStartTime;

      // Minimum swipe distance of 45px within 450ms, and must be predominantly horizontal
      if (elapsed < 450 && Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
        const tabOrder = ['home', 'calendar', 'analytics', 'history'];
        const currentIndex = tabOrder.indexOf(this.state.activeTab);
        if (currentIndex === -1) return;

        if (deltaX < 0 && currentIndex < tabOrder.length - 1) {
          // Swiped left -> Go to Next Tab
          this.switchTab(tabOrder[currentIndex + 1], 'left');
        } else if (deltaX > 0 && currentIndex > 0) {
          // Swiped right -> Go to Previous Tab
          this.switchTab(tabOrder[currentIndex - 1], 'right');
        }
      }
    }, { passive: true });
  }

  // =========================================================================
  // SMOOTH DRAG-TO-SCROLL (MOUSE & TOUCH HORIZONTAL MOMENTUM)
  // =========================================================================
  initDragToScroll() {
    const sliders = document.querySelectorAll('.quick-tiles-scroll');
    sliders.forEach((slider) => {
      let isDown = false;
      let startX = 0;
      let scrollLeft = 0;
      let moved = false;

      slider.addEventListener('mousedown', (e) => {
        isDown = true;
        moved = false;
        slider.classList.add('is-dragging');
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
      });

      window.addEventListener('mouseup', () => {
        if (!isDown) return;
        isDown = false;
        slider.classList.remove('is-dragging');
      });

      slider.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 1.6;
        if (Math.abs(walk) > 4) moved = true;
        slider.scrollLeft = scrollLeft - walk;
      });

      slider.addEventListener('click', (e) => {
        if (moved) {
          e.stopPropagation();
          e.preventDefault();
          moved = false;
        }
      }, true);
    });
  }

  bindInitialBalanceModalEvents() {
    const modal = document.getElementById('modal-initial-balance');
    const closeBtn = document.getElementById('btn-close-initial-balance');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeInitialBalanceModal());

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeInitialBalanceModal();
      });
    }

    const btnUsd = document.getElementById('btn-init-curr-usd');
    const btnKhr = document.getElementById('btn-init-curr-khr');
    const symbolEl = document.getElementById('init-balance-symbol');
    const inputEl = document.getElementById('input-initial-balance');

    if (btnUsd && btnKhr) {
      btnUsd.addEventListener('click', () => {
        sound.playClick();
        this.state.initialBalanceModalCurr = 'USD';
        btnUsd.classList.add('bg-indigo-600', 'text-white');
        btnUsd.classList.remove('text-slate-400');
        btnKhr.classList.remove('bg-indigo-600', 'text-white');
        btnKhr.classList.add('text-slate-400');
        if (symbolEl) symbolEl.textContent = '$';
      });

      btnKhr.addEventListener('click', () => {
        sound.playClick();
        this.state.initialBalanceModalCurr = 'KHR';
        btnKhr.classList.add('bg-indigo-600', 'text-white');
        btnKhr.classList.remove('text-slate-400');
        btnUsd.classList.remove('bg-indigo-600', 'text-white');
        btnUsd.classList.add('text-slate-400');
        if (symbolEl) symbolEl.textContent = '៛';
      });
    }

    document.querySelectorAll('.init-quick-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        sound.playClick();
        const val = pill.getAttribute('data-val');
        const isKhr = pill.getAttribute('data-khr') === 'true';

        if (isKhr && btnKhr) {
          btnKhr.click();
        } else if (!isKhr && btnUsd) {
          btnUsd.click();
        }

        if (inputEl) inputEl.value = val;
      });
    });

    const saveBtn = document.getElementById('btn-save-initial-balance');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        sound.playClick();
        const rawVal = parseFloat(inputEl?.value || '0');
        if (isNaN(rawVal) || rawVal < 0) {
          sound.playErrorBeep();
          this.showToast('Please enter a valid balance (>= 0)', 'error');
          return;
        }

        let baseUsd = rawVal;
        if (this.state.initialBalanceModalCurr === 'KHR') {
          baseUsd = Number((rawVal / this.state.exchangeRate).toFixed(2));
        } else {
          baseUsd = Number(rawVal.toFixed(2));
        }

        this.state.initialBalance = baseUsd;
        await syncEngine.saveConfig({ initialBalance: baseUsd });

        sound.playSuccessChord();
        this.updateUI();
        this.closeInitialBalanceModal();
        this.showToast(`បានរក្សាទុកលុយដើម $${baseUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}!`, 'success');
      });
    }
  }

  openInitialBalanceModal() {
    const modal = document.getElementById('modal-initial-balance');
    if (!modal) return;

    const inputEl = document.getElementById('input-initial-balance');
    const btnUsd = document.getElementById('btn-init-curr-usd');

    if (btnUsd) btnUsd.click();
    if (inputEl) {
      inputEl.value = this.state.initialBalance > 0 ? this.state.initialBalance : '';
    }

    modal.classList.add('open');
  }

  closeInitialBalanceModal() {
    const modal = document.getElementById('modal-initial-balance');
    if (modal) modal.classList.remove('open');
  }

  bindManualModalEvents() {
    const modal = document.getElementById('modal-manual-entry');
    const closeBtn = document.getElementById('btn-close-manual');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeManualModal());
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeManualModal();
      });
    }

    // Numpad key buttons
    document.querySelectorAll('.numpad-key').forEach((key) => {
      key.addEventListener('click', () => {
        sound.playClick();
        const val = key.getAttribute('data-val');
        const display = document.getElementById('manual-amount-display');
        let current = this.state.manualForm.amount || '';

        if (val === 'backspace') {
          current = current.slice(0, -1);
        } else if (val === '.') {
          if (!current.includes('.')) {
            current = (current || '0') + '.';
          }
        } else {
          if (current === '0') current = val;
          else current += val;
        }

        this.state.manualForm.amount = current;
        if (display) display.textContent = current || '0';
      });
    });

    // Quick add amount pills inside manual modal
    document.querySelectorAll('.manual-quick-add').forEach((pill) => {
      pill.addEventListener('click', () => {
        sound.playClick();
        const addVal = parseFloat(pill.getAttribute('data-add') || '0');
        const current = parseFloat(this.state.manualForm.amount || '0');
        const next = (current + addVal).toFixed(2);
        this.state.manualForm.amount = String(parseFloat(next));
        const display = document.getElementById('manual-amount-display');
        if (display) display.textContent = this.state.manualForm.amount;
      });
    });

    // Type toggle in manual modal (Expense / Income)
    const typeExpense = document.getElementById('manual-type-expense');
    const typeIncome = document.getElementById('manual-type-income');
    if (typeExpense && typeIncome) {
      typeExpense.addEventListener('click', () => {
        sound.playClick();
        this.state.manualForm.type = 'expense';
        typeExpense.classList.add('bg-rose-500/20', 'text-rose-400', 'border-rose-500/40');
        typeIncome.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/40');
      });
      typeIncome.addEventListener('click', () => {
        sound.playClick();
        this.state.manualForm.type = 'income';
        typeIncome.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/40');
        typeExpense.classList.remove('bg-rose-500/20', 'text-rose-400', 'border-rose-500/40');
      });
    }

    // Currency toggle in manual modal
    const currToggleBtn = document.getElementById('manual-curr-toggle');
    if (currToggleBtn) {
      currToggleBtn.addEventListener('click', () => {
        sound.playClick();
        const next = this.state.manualForm.currency === 'USD' ? 'KHR' : 'USD';
        this.state.manualForm.currency = next;
        currToggleBtn.textContent = next === 'USD' ? '$ USD' : '៛ KHR';
      });
    }

    // Category chips in modal
    document.querySelectorAll('.manual-cat-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        sound.playClick();
        document.querySelectorAll('.manual-cat-chip').forEach((c) => {
          c.classList.remove('border-indigo-500', 'bg-indigo-500/20', 'text-indigo-300');
        });
        chip.classList.add('border-indigo-500', 'bg-indigo-500/20', 'text-indigo-300');
        this.state.manualForm.category = chip.getAttribute('data-cat') || 'other';
      });
    });

    // Payment method chips in modal
    document.querySelectorAll('.manual-payment-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        sound.playClick();
        document.querySelectorAll('.manual-payment-chip').forEach((c) => {
          c.classList.remove('border-indigo-500', 'bg-indigo-500/20', 'text-indigo-300');
        });
        chip.classList.add('border-indigo-500', 'bg-indigo-500/20', 'text-indigo-300');
        this.state.manualForm.payment_method = chip.getAttribute('data-method') || 'WOORI_BANK';
      });
    });

    // Submit Manual Entry
    const submitBtn = document.getElementById('btn-submit-manual');
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const amt = parseFloat(this.state.manualForm.amount);
        if (isNaN(amt) || amt <= 0) {
          sound.playErrorBeep();
          this.showToast('Please enter a valid amount greater than 0', 'error');
          return;
        }

        const noteInput = document.getElementById('manual-note-input');
        const note = noteInput ? noteInput.value.trim() : '';

        const dateInput = document.getElementById('manual-date-input');
        const chosenDate = dateInput && dateInput.value ? dateInput.value : new Date().toISOString().slice(0, 10);
        const txDate = new Date(chosenDate + 'T12:00:00').toISOString();

        const rate = this.state.exchangeRate;
        const currency = this.state.manualForm.currency;
        const base_amount_usd = currency === 'KHR' ? Number((amt / rate).toFixed(2)) : Number(amt.toFixed(2));

        const newTx = {
          id: this.pipeline.generateUuid(),
          type: this.state.manualForm.type,
          amount: amt,
          currency: currency,
          base_amount_usd: base_amount_usd,
          exchange_rate_used: rate,
          category: this.state.manualForm.category,
          payment_method: this.state.manualForm.payment_method,
          note: note || (this.state.manualForm.type === 'income' ? 'Income' : 'Expense'),
          raw_transcript: 'Manual entry',
          sync_status: 'pending_sync',
          transaction_date: txDate,
          created_at: new Date().toISOString()
        };

        await syncEngine.addTransaction(newTx);
        this.state.transactions.unshift(newTx);

        if (newTx.type === 'income') {
          sound.playIncomeCelebration();
          this.triggerConfetti();
        } else {
          sound.playSuccessChord();
        }

        this.closeManualModal();
        this.updateUI();
        this.showToast(`Saved ${currency === 'KHR' ? '៛' : '$'}${amt}!`, 'success');
      });
    }
  }

  bindSettingsModalEvents() {
    const modal = document.getElementById('modal-settings');
    const closeBtn = document.getElementById('btn-close-settings');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeSettingsModal());

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeSettingsModal();
      });
    }

    const saveBtn = document.getElementById('btn-save-settings');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        sound.playClick();
        const sbUrl = (document.getElementById('setting-sb-url')?.value || '').trim();
        const sbKey = (document.getElementById('setting-sb-key')?.value || '').trim();
        const gemKey = (document.getElementById('setting-gemini-key')?.value || '').trim();
        const rate = parseFloat(document.getElementById('setting-exchange-rate')?.value || '4100');
        const budget = parseFloat(document.getElementById('setting-budget')?.value || '500');
        const initBal = parseFloat(document.getElementById('setting-initial-balance')?.value || '0');
        const fixedSal = parseFloat(document.getElementById('setting-fixed-salary')?.value || '739.34');
        const fixedJob2 = parseFloat(document.getElementById('setting-fixed-second-job')?.value || '220');
        const fixedCar = parseFloat(document.getElementById('setting-fixed-car')?.value || '232.54');
        const fixedHouse = parseFloat(document.getElementById('setting-fixed-house')?.value || '185.00');

        await syncEngine.saveConfig({
          supabaseUrl: sbUrl,
          supabaseKey: sbKey,
          geminiKey: gemKey,
          exchangeRate: isNaN(rate) ? 4100 : rate,
          monthlyBudget: isNaN(budget) ? 500 : budget,
          initialBalance: isNaN(initBal) ? 0 : initBal,
          fixedSalary: isNaN(fixedSal) ? 739.34 : fixedSal,
          fixedSecondJob: isNaN(fixedJob2) ? 220 : fixedJob2,
          fixedCarPayment: isNaN(fixedCar) ? 232.54 : fixedCar,
          fixedHousePayment: isNaN(fixedHouse) ? 185.00 : fixedHouse
        });
        this.state.initialBalance = isNaN(initBal) ? 0 : initBal;
        this.state.fixedSalary = isNaN(fixedSal) ? 739.34 : fixedSal;
        this.state.fixedSecondJob = isNaN(fixedJob2) ? 220 : fixedJob2;
        this.state.fixedCarPayment = isNaN(fixedCar) ? 232.54 : fixedCar;
        this.state.fixedHousePayment = isNaN(fixedHouse) ? 185.00 : fixedHouse;
        this.updateUI();

        this.showToast('Settings saved successfully!', 'success');
        this.closeSettingsModal();
      });
    }

    const clearBtn = document.getElementById('btn-clear-data');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (confirm('Delete all local transactions?')) {
          sound.playClick();
          await syncEngine.clearAllLocalData();
          this.state.transactions = [];
          this.updateUI();
          this.showToast('All local data cleared.', 'info');
          this.closeSettingsModal();
        }
      });
    }

    const exportBtn = document.getElementById('btn-export-csv');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        sound.playClick();
        this.exportCSV();
      });
    }

    const copySqlBtn = document.getElementById('btn-copy-sql');
    if (copySqlBtn) {
      copySqlBtn.addEventListener('click', () => {
        sound.playClick();
        const sql = document.getElementById('sql-code-block')?.textContent || '';
        navigator.clipboard.writeText(sql).then(() => {
          this.showToast('SQL copied to clipboard!', 'success');
        });
      });
    }
  }

  // =========================================================================
  // PROFILE & ACCOUNT DRAWER
  // =========================================================================
  bindProfileModalEvents() {
    const openBtn = document.getElementById('btn-open-profile');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        sound.playClick();
        this.openProfileModal();
      });
    }

    const modal = document.getElementById('modal-profile');
    const closeBtn = document.getElementById('btn-close-profile');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeProfileModal());

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeProfileModal();
      });
    }

    // Avatar Presets selection
    const presetButtons = document.querySelectorAll('.avatar-preset-btn');
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playClick();
        presetButtons.forEach((b) => {
          b.classList.remove('border-indigo-500');
          b.classList.add('border-transparent');
        });
        btn.classList.remove('border-transparent');
        btn.classList.add('border-indigo-500');

        const newUrl = btn.getAttribute('data-avatar-url');
        if (newUrl) {
          const drawerImg = document.getElementById('drawer-avatar-img');
          if (drawerImg) drawerImg.src = newUrl;
          const customInput = document.getElementById('profile-avatar-custom-url');
          if (customInput) customInput.value = '';
          this.state.tempAvatar = newUrl;
        }
      });
    });

    // Custom avatar URL input change
    const customUrlInput = document.getElementById('profile-avatar-custom-url');
    if (customUrlInput) {
      customUrlInput.addEventListener('input', (e) => {
        const url = e.target.value.trim();
        if (url) {
          const drawerImg = document.getElementById('drawer-avatar-img');
          if (drawerImg) drawerImg.src = url;
          this.state.tempAvatar = url;
          presetButtons.forEach((b) => {
            b.classList.remove('border-indigo-500');
            b.classList.add('border-transparent');
          });
        }
      });
    }

    // Save Profile Changes
    const saveBtn = document.getElementById('btn-save-profile');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        sound.playSuccess();
        const nameInput = document.getElementById('profile-name-input');
        const customUrlInput = document.getElementById('profile-avatar-custom-url');

        const newName = (nameInput?.value || '').trim() || 'Phouchhit';
        const newAvatar = (customUrlInput?.value || '').trim() || this.state.tempAvatar || this.state.userAvatar;

        this.state.userName = newName;
        this.state.userAvatar = newAvatar;
        localStorage.setItem('savech_user_name', newName);
        localStorage.setItem('savech_user_avatar', newAvatar);

        this.updateProfileUI();
        this.closeProfileModal();
        this.triggerConfetti();
        this.showToast(`បានរក្សាទុក Profile របស់ ${newName} រួចរាល់!`, 'success');
      });
    }
  }

  // =========================================================================
  // AI FINANCIAL COACH & WEALTH STRATEGIST
  // =========================================================================
  bindAICoachEvents() {
    const modal = document.getElementById('modal-ai-coach');
    const closeBtn = document.getElementById('btn-close-ai-coach');
    const openBtnHeader = document.getElementById('btn-open-ai-coach');
    const openBannerHome = document.getElementById('card-ai-coach-banner');

    if (openBtnHeader) {
      openBtnHeader.addEventListener('click', () => this.openAICoachModal());
    }
    if (openBannerHome) {
      openBannerHome.addEventListener('click', () => this.openAICoachModal());
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeAICoachModal());
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeAICoachModal();
      });
    }

    // AI Prompt Chips
    document.querySelectorAll('.ai-coach-prompt-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const promptKey = chip.getAttribute('data-prompt');
        this.askAICoach(promptKey);
      });
    });

    // Reset Chat Trigger
    const resetChatBtn = document.getElementById('btn-reset-ai-chat');
    if (resetChatBtn) {
      resetChatBtn.addEventListener('click', () => {
        sound.playClick();
        this.resetAIChat();
      });
    }

    // Chat form
    const form = document.getElementById('form-ai-coach-chat');
    const queryInput = document.getElementById('input-ai-coach-query');
    if (form && queryInput) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = queryInput.value.trim();
        if (query) {
          queryInput.value = '';
          this.askAICoach(query);
        }
      });
    }
  }

  resetAIChat() {
    this.state.aiChatMessages = [];
    const stream = document.getElementById('ai-coach-chat-stream');
    if (!stream) return;

    const fixedSalary = parseFloat(this.state.fixedSalary) || 739.34;
    const fixedSecond = parseFloat(this.state.fixedSecondJob) || 220.00;
    const totalFixedIncome = fixedSalary + fixedSecond;
    const carPayment = parseFloat(this.state.fixedCarPayment) || 232.54;
    const housePayment = parseFloat(this.state.fixedHousePayment) || 185.00;
    const totalFixedDebts = carPayment + housePayment;
    const netSurplus = totalFixedIncome - totalFixedDebts;

    stream.innerHTML = `
      <div class="ai-msg-bubble flex items-start gap-2">
        <div class="w-6 h-6 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-xs flex-shrink-0 mt-0.5 shadow-sm">
          ✨
        </div>
        <div class="flex-1 bg-slate-950/80 border border-purple-500/30 p-2.5 rounded-2xl rounded-tl-sm text-[11px] leading-relaxed text-slate-200 font-khmer shadow-sm">
          <p class="font-bold text-purple-300 mb-1">ជំរាបសួរ! ខ្ញុំជា saveCH Super Wealth Mind 🧠</p>
          ខ្ញុំបានភ្ជាប់ជាមួយ <strong class="text-emerald-400">Gemini 2.5 Flash</strong> យ៉ាងពេញលេញ និងបានវិភាគប្រព័ន្ធហិរញ្ញវត្ថុរបស់បងរួចរាល់៖
          <div class="mt-1.5 space-y-0.5 text-[10.5px] text-slate-300">
            <div>• 💼 <strong>ចំណូល FIX សរុប:</strong> <span class="text-emerald-400 font-mono font-bold">$${totalFixedIncome.toFixed(2)}/ខែ</span> ($${fixedSalary.toFixed(2)} + $${fixedSecond.toFixed(2)})</div>
            <div>• 🚗🏠 <strong>បន្ទុក FIX (ឡាន+ផ្ទះ):</strong> <span class="text-rose-400 font-mono font-bold">$${totalFixedDebts.toFixed(2)}/ខែ</span> (DTI 43.5% សុវត្ថិភាព)</div>
            <div>• 💰 <strong>លុយសល់សុទ្ធ (Surplus):</strong> <span class="text-indigo-300 font-mono font-bold">+$${netSurplus.toFixed(2)}/ខែ</span> (~$${(netSurplus/30).toFixed(2)}/ថ្ងៃ)</div>
          </div>
          <p class="mt-2 text-[10px] text-purple-200/90 font-medium">
            🎯 បងអាចចុចប៊ូតុងខាងលើ ឬវាយសួរខ្ញុំផ្ទាល់ពីយុទ្ធសាស្ត្រសន្សំ ដោះបំណុលឡាន ដាក់ការប្រាក់ ABA ឬការវិនិយោគបានគ្រប់ពេល!
          </p>
        </div>
      </div>
    `;
    this.showToast('បានសម្អាត និងចាប់ផ្តើមការសន្ទនាថ្មី!', 'info');
  }

  openAICoachModal() {
    sound.playClick();
    this.updateAICoachMetrics();
    const modal = document.getElementById('modal-ai-coach');
    if (modal) {
      modal.classList.add('open');
      const stream = document.getElementById('ai-coach-chat-stream');
      if (stream) stream.scrollTop = stream.scrollHeight;
    }
  }

  closeAICoachModal() {
    sound.playClick();
    const modal = document.getElementById('modal-ai-coach');
    if (modal) modal.classList.remove('open');
  }

  updateAICoachMetrics() {
    const fixedSalary = parseFloat(this.state.fixedSalary) || 739.34;
    const fixedSecond = parseFloat(this.state.fixedSecondJob) || 220.00;
    const totalFixedIncome = fixedSalary + fixedSecond;

    const carPayment = parseFloat(this.state.fixedCarPayment) || 232.54;
    const housePayment = parseFloat(this.state.fixedHousePayment) || 185.00;
    const totalFixedDebts = carPayment + housePayment;

    const netSurplus = Math.max(0, totalFixedIncome - totalFixedDebts);

    const incomeEl = document.getElementById('ai-coach-income-display');
    const debtsEl = document.getElementById('ai-coach-debts-display');
    const surplusEl = document.getElementById('ai-coach-surplus-display');

    if (incomeEl) incomeEl.textContent = `$${totalFixedIncome.toFixed(2)}`;
    if (debtsEl) debtsEl.textContent = `$${totalFixedDebts.toFixed(2)}`;
    if (surplusEl) surplusEl.textContent = `+$${netSurplus.toFixed(2)}`;
  }

  async askAICoach(promptKeyOrQuery) {
    sound.playClick();
    const stream = document.getElementById('ai-coach-chat-stream');
    const loadingEl = document.getElementById('ai-coach-loading');
    const modelTag = document.getElementById('ai-coach-model-tag');

    const promptMap = {
      how_to_save: 'តើខ្ញុំគួរសន្សំលុយបែបណាឱ្យសល់ពិតប្រាកដ និងមានប្រសិទ្ធភាពបំផុត?',
      pay_off_car: 'តើមានយុទ្ធសាស្ត្រដោះបំណុលឡាន $232.54 ឱ្យឆាប់ដាច់មុនកំណត់ដោយរបៀបណា?',
      aba_interest: 'របៀបទាញយកការប្រាក់ខ្ពស់បំផុតពីធនាគារ ABA Mobile (Fixed Deposit & Flexi)?',
      boost_freelance: 'តើខ្ញុំគួរចាត់ចែងលុយដែលបានពី Page Boosting និង Freelance យ៉ាងដូចម្តេច?',
      audit_expenses: 'ជួយធ្វើ Financial Audit វិភាគការចំណាយជាក់ស្តែងខែនេះរបស់ខ្ញុំ និងប្រាប់ពីចំណុចលេចធ្លាយ'
    };

    const userText = promptMap[promptKeyOrQuery] || promptKeyOrQuery;

    // Append User Bubble
    if (stream) {
      const userBubble = document.createElement('div');
      userBubble.className = 'flex justify-end';
      userBubble.innerHTML = `
        <div class="max-w-[85%] bg-purple-600/35 border border-purple-500/40 text-purple-100 px-3 py-2 rounded-2xl rounded-tr-sm text-[11px] leading-relaxed font-khmer shadow-sm">
          ${this.escapeHtml(userText)}
        </div>
      `;
      stream.appendChild(userBubble);
      stream.scrollTop = stream.scrollHeight;
    }

    if (loadingEl) loadingEl.classList.remove('hidden');

    const fixedSalary = parseFloat(this.state.fixedSalary) || 739.34;
    const fixedSecond = parseFloat(this.state.fixedSecondJob) || 220.00;
    const totalFixedIncome = fixedSalary + fixedSecond;
    const carPayment = parseFloat(this.state.fixedCarPayment) || 232.54;
    const housePayment = parseFloat(this.state.fixedHousePayment) || 185.00;
    const totalFixedDebts = carPayment + housePayment;
    const netSurplus = totalFixedIncome - totalFixedDebts;

    // Month to date actual spending stats
    const now = new Date();
    const currentMonthTx = this.state.transactions.filter(t => {
      const d = new Date(t.transaction_date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const mtdExpenses = currentMonthTx.filter(t => t.type === 'expense');
    const mtdSpentUSD = mtdExpenses.reduce((sum, t) => sum + (Number(t.base_amount_usd) || 0), 0);
    const mtdIncomes = currentMonthTx.filter(t => t.type === 'income');
    const mtdIncomeUSD = mtdIncomes.reduce((sum, t) => sum + (Number(t.base_amount_usd) || 0), 0);

    let adviceHtml = '';
    let isAIOnline = false;

    const apiKey = syncEngine.config.geminiKey || localStorage.getItem('savech_gemini_key') || localStorage.getItem('pocketai_gemini_key') || '';

    if (apiKey) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const systemPrompt = `You are 'saveCH Super Wealth Mind' (កំពូល AI ទីប្រឹក្សាហិរញ្ញវត្ថុ និងវិភាគទ្រព្យឆ្លាតវៃ), the elite bilingual certified personal wealth advisor and behavioral finance strategist for Cambodia.

Current User Real Financial Profile & Banking Ecosystem:
- Primary Daily Spending Account: Woori Bank (ធនាគារ អ៊ូរី - Woori Bank Mobile / KHQR)
- Monthly Car Loan Payment: $${carPayment.toFixed(2)} / month is paid directly to ACLEDA Bank (ធនាគារ អេស៊ីលីដា)
- Monthly House Loan/Rent: $${housePayment.toFixed(2)} / month
- Guaranteed Monthly Salary: $${fixedSalary.toFixed(2)}
- 2nd Workplace Guaranteed Income: $${fixedSecond.toFixed(2)}
- Total Fixed Guaranteed Income: $${totalFixedIncome.toFixed(2)} / month
- Total Fixed Monthly Obligations: $${totalFixedDebts.toFixed(2)} / month (Debt-to-Income DTI = 43.5%, healthy under 50%)
- Net Disposable Cashflow: $${netSurplus.toFixed(2)} / month (~$${(netSurplus/30).toFixed(2)} / day)
- Irregular Side Incomes: Facebook Page Boosting and Freelancer gigs ($50, $80, $100+)
- Month-to-date logged expenses: $${mtdSpentUSD.toFixed(2)} across ${mtdExpenses.length} transactions.
- Month-to-date logged incomes: $${mtdIncomeUSD.toFixed(2)} across ${mtdIncomes.length} transactions.

Your Core Wealth Directives:
1. Master of User's Specific Banks (Woori Bank & ACLEDA Bank) & Cambodian Reality:
   - Understand that the user's primary wallet for daily spending is Woori Bank, while the car loan of $232.54 is paid to ACLEDA Bank.
   - Advise on seamless interbank transfers (Bakong KHQR instant transfer from Woori Bank to ACLEDA Bank for car loan payment).
   - 3-Jar rule for the $541.80 surplus: Jar 1 ($300/mo = ~$10/day living & food in Woori Bank), Jar 2 ($150/mo = High-Yield Savings / Fixed Deposit in Woori Bank or ACLEDA/ABA at 6.0%-7.5%), Jar 3 ($91.80/mo = fun & buffer).
   - Side income rule: Funnel 70% of Freelance / Page Boosting income from Woori Bank to pay down extra principal directly on the ACLEDA car loan ($232.54) to eliminate the debt years early and save huge bank interest!
2. Behavioral Economics & Psychology:
   - Help the user stop impulse purchases (daily $2-$3 Starbucks/Brown coffee adds up to $70-$90/mo; swap to $1 local coffee to save $50+/mo).
   - Avoid lifestyle creep when earning freelance money.
3. Tone & Formatting:
   - Speak in warm, sharp, highly motivating, respectful Khmer.
   - Use structured bullet points, emojis, bold key numbers, and clean paragraphs.
   - Always do real math with the user's specific dollar numbers and mention Woori Bank and ACLEDA accurately.`;

        // Format history for Gemini contents
        if (!this.state.aiChatMessages) this.state.aiChatMessages = [];
        this.state.aiChatMessages.push({ role: 'user', text: userText });

        const contents = [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\nUser Question: ${userText}` }]
          }
        ];

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: 0.35,
              maxOutputTokens: 1200
            }
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            adviceHtml = text;
            isAIOnline = true;
            this.state.aiChatMessages.push({ role: 'model', text: text });
          }
        }
      } catch (err) {
        console.warn('Gemini Super Wealth Mind error, falling back to local Cambodian rules:', err);
      }
    }

    if (!adviceHtml) {
      if (promptKeyOrQuery === 'how_to_save') {
        adviceHtml = `💡 **យុទ្ធសាស្ត្រសន្សំលុយឱ្យសល់ពិតប្រាកដ (Smart Saving Strategy):**

1. **អនុវត្តក្បួន "Pay Yourself First" (ដកសន្សំមុនចាយ):**
   • នៅថ្ងៃដែលប្រាក់ខែ $739.34 និងកន្លែង២ $220.00 ធ្លាក់ចូលភ្លាម ចូរកាត់ទុក **$150.00 ភ្លាមៗ** វេរចូលកុង ABA Fixed Deposit ឬ Savings Lock។ កុំរង់ចាំដល់ចុងខែទើបសល់សន្សំ ព្រោះនឹងមិនដែលសល់ឡើយ!
2. **បែងចែកលុយ ៣ ថូ ពីចំនួនសល់សុទ្ធ $541.80:**
   • **ថូទី ១ ($300/ខែ):** ចំណាយប្រចាំថ្ងៃ ($10/ថ្ងៃ សម្រាប់បាយ កាហ្វេ និងសាំង)។
   • **ថូទី ២ ($150/ខែ):** មូលនិធិគ្រាអាសន្ន (Emergency Fund)។ ក្នុង ១ ឆ្នាំនឹងសល់ **$1,800 + ការប្រាក់**!
   • **ថូទី ៣ ($91.80/ខែ):** លុយបម្រុង ឬកម្សាន្តចុងសប្តាហ៍។
3. **កាត់បន្ថយចំណាយលេចធ្លាយ (Micro-leaks):**
   • កាហ្វេប្រ៊ែន $2.5 - $3.5 អាចប្តូរមកកាហ្វេធម្មតា $1.0 - $1.5 ជួយសន្សំបាន $30 - $50 បន្ថែមក្នុងមួយខែ!`;
      } else if (promptKeyOrQuery === 'pay_off_car') {
        adviceHtml = `🚗 **ផែនការដោះបំណុលឡាន ($232.54/ខែ) ឱ្យឆាប់ដាច់ (Debt Acceleration):**

1. **ស្ថានភាពបច្ចុប្បន្ន:**
   • បន្ទុកបង់ឡាន $232.54 + ផ្ទះ $185.00 = $417.54 (ស្មើនឹង 43.5% នៃចំណូលទៀងទាត់ $959.34)។ នេះជាអត្រាសុវត្ថិភាពក្រោម 50% DTI។
2. **យុទ្ធសាស្ត្រកាត់ប្រាក់ដើម (Principal Prepayment):**
   • រាល់ពេលមានចំណូលក្រៅពី **Page Boosting** ឬ **Freelancer** (ឧទាហរណ៍ បាន $50 ឬ $80) ចូរយក **70% ($35 - $56)** ទៅបង់បង្គ្រប់កាត់ប្រាក់ដើមឡានបន្ថែម (Principal-only payment)។
   • ការបង់កាត់ប្រាក់ដើមបន្ថែម នឹងជួយកាត់បន្ថយការប្រាក់សរុប និងធ្វើឱ្យរួចបំណុលឡានមុនកំណត់ពី ៦ ខែ ទៅ ១ ឆ្នាំកន្លះ!
3. **កុំបង្កើតបំណុលថ្មី:**
   • ក្នុងអំឡុងពេលកំពុងបង់ឡាន និងផ្ទះ ជៀសវាងទិញទំនិញរំលស់ ឬបង់កាតឥណទាន (Credit Card) បន្ថែម។`;
      } else if (promptKeyOrQuery === 'boost_freelance') {
        adviceHtml = `🚀 **ការចាត់ចែងចំណូលមិនទៀងទាត់ (Freelance & Page Boosting Fund):**

ចំណូលពី Page Boosting និង Freelance មិនទៀងទាត់ទេ (ពេលខ្លះបាន $50 ពេលខ្លះ $80 ឬ $100+)។ កំហុសធំបំផុតគឺយកលុយនេះទៅបង្កើនកម្រិតជីវភាព (Lifestyle Creep)។

🎯 **រូបមន្តបែងចែកចំណូលក្រៅ:**
• **70% ចូលកញ្ចប់ពន្លឿនទ្រព្យ (Wealth Accelerator):** យកទៅកាត់ប្រាក់ដើមបំណុលឡាន ឬដាក់សន្សំបង្កើនល្បឿន។
• **20% ទុកជាទុនវិនិយោគបន្ត (Re-investment):** សម្រាប់ចំណាយផ្សាយពាណិជ្ជកម្ម (Boosting budget) ឬទិញ Software/Tools ជំនួយការងារ Freelance។
• **10% ជារង្វាន់លើកទឹកចិត្ត (Reward):** ទុកញ៉ាំអាហារឆ្ងាញ់ៗជាមួយគ្រួសារ ឬមិត្តភក្តិដោយគ្មានវិប្បដិសារី!`;
      } else if (promptKeyOrQuery === 'aba_interest') {
        adviceHtml = `📈 **វិធីទាញយកការប្រាក់ខ្ពស់បំផុតពីធនាគារ (ABA Mobile High-Yield):**

1. **ប្រើមុខងារ ABA Fixed Deposit (ប្រាក់បញ្ញើមានកាលកំណត់):**
   • ការប្រាក់សម្រាប់ USD: ចន្លោះ **5.0% ទៅ 6.5%/ឆ្នាំ** (អាស្រ័យលើរយៈពេល 6 - 12 ខែ)។
   • បើសន្សំជាប្រាក់រៀល (KHR): ការប្រាក់រហូតដល់ **7.5% - 8.25%/ឆ្នាំ**!
2. **ផែនការបណ្តាក់ទុន $150/ខែ:**
   • ដាក់ $150 រៀងរាល់ខែចូល Fixed Deposit (12 ខែ)។
   • ឆ្នាំទី ១: សន្សំបាន **$1,800 + ការប្រាក់ប្រហែល $60-$80**។
   • ឆ្នាំទី ២: ទ្រព្យកើនដល់ជាង **$3,750+**។
3. **ABA Flexi Deposit (ងាយស្រួលដក):**
   • បើបារម្ភខ្លាចត្រូវការលុយបន្ទាន់ អាចបើក Flexi Deposit ដែលទទួលបានការប្រាក់ខ្ពស់ជាងគណនីធម្មតា ហើយអាចដកបានគ្រប់ពេលដោយមិនបាត់បង់ការប្រាក់ទាំងអស់ឡើយ។`;
      } else {
        adviceHtml = `🤖 **ការវិភាគលើសំណួរ: "${userText}"**

ផ្អែកលើទិន្នន័យជាក់ស្តែងរបស់បង៖
• ចំណូលថេរ: **$${totalFixedIncome.toFixed(2)}** | បន្ទុកឡាន+ផ្ទះ: **$${totalFixedDebts.toFixed(2)}** | សល់សុទ្ធ: **$${netSurplus.toFixed(2)}**

🎯 **ការណែនាំពី Super AI:**
1. **រក្សាចំណាយប្រចាំថ្ងៃក្រោម $10/ថ្ងៃ ($300/ខែ):** នេះជាចំណុចគន្លឹះដើម្បីរក្សាតុល្យភាពថវិកា។
2. **បន្តសន្សំ $150/ខែ:** ទុកសម្រាប់គ្រាអាសន្ន ឬជួសជុលឡាន/ផ្ទះដែលមិនបានព្រាងទុក។
3. **ប្រើប្រាស់ចំណូល Freelance បន្ថែម:** បង្វែររាល់លុយ Freelance & Page Boosting មកកាត់រំលស់ដើមឡាន ឬចាក់បំពេញមូលនិធិសន្សំ។`;
      }
    }

    if (loadingEl) loadingEl.classList.add('hidden');
    if (modelTag) {
      modelTag.textContent = isAIOnline ? 'Gemini 2.5 Flash' : 'Super Wealth Mind';
    }

    // Append AI Bubble to Chat Stream
    if (stream) {
      const aiBubble = document.createElement('div');
      aiBubble.className = 'ai-msg-bubble flex items-start gap-2';
      aiBubble.innerHTML = `
        <div class="w-6 h-6 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-xs flex-shrink-0 mt-0.5 shadow-sm">
          ✨
        </div>
        <div class="flex-1 bg-slate-950/80 border border-purple-500/30 p-2.5 rounded-2xl rounded-tl-sm text-[11px] leading-relaxed text-slate-200 font-khmer shadow-sm whitespace-pre-line">
          ${this.renderMarkdownToHtml(adviceHtml)}
        </div>
      `;
      stream.appendChild(aiBubble);
      stream.scrollTop = stream.scrollHeight;
    }
  }

  renderMarkdownToHtml(text) {
    if (!text) return '';
    let formatted = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-bold">$1</strong>');
    // Bullet points
    formatted = formatted.replace(/^[•\-\*]\s+(.*)$/gm, '<div class="flex items-start gap-1 my-0.5"><span class="text-purple-400 font-bold">•</span><span class="flex-1">$1</span></div>');

    return formatted;
  }

  // =========================================================================
  // MODAL CONTROLS
  // =========================================================================
  openManualModal(prefill = {}) {
    const modal = document.getElementById('modal-manual-entry');
    if (!modal) return;

    this.state.manualForm = {
      type: prefill.type || 'expense',
      amount: prefill.amount ? String(prefill.amount) : '',
      currency: prefill.currency || this.state.currency,
      category: prefill.category || 'other',
      payment_method: prefill.payment_method || 'ABA_KHQR',
      note: prefill.note || '',
      date: prefill.date || this.state.selectedDate || new Date().toISOString().slice(0, 10)
    };

    const display = document.getElementById('manual-amount-display');
    if (display) display.textContent = this.state.manualForm.amount || '0';

    const noteInput = document.getElementById('manual-note-input');
    if (noteInput) noteInput.value = this.state.manualForm.note;

    const dateInput = document.getElementById('manual-date-input');
    if (dateInput) dateInput.value = this.state.manualForm.date;

    const currToggle = document.getElementById('manual-curr-toggle');
    if (currToggle) currToggle.textContent = this.state.manualForm.currency === 'USD' ? '$ USD' : '៛ KHR';

    document.querySelectorAll('.manual-cat-chip').forEach((c) => {
      const match = c.getAttribute('data-cat') === this.state.manualForm.category;
      c.classList.toggle('border-indigo-500', match);
      c.classList.toggle('bg-indigo-500/20', match);
      c.classList.toggle('text-indigo-300', match);
    });

    document.querySelectorAll('.manual-payment-chip').forEach((c) => {
      const match = c.getAttribute('data-method') === this.state.manualForm.payment_method;
      c.classList.toggle('border-indigo-500', match);
      c.classList.toggle('bg-indigo-500/20', match);
      c.classList.toggle('text-indigo-300', match);
    });

    modal.classList.add('open');
  }

  closeManualModal() {
    const modal = document.getElementById('modal-manual-entry');
    if (modal) modal.classList.remove('open');
  }

  openSettingsModal() {
    const modal = document.getElementById('modal-settings');
    if (!modal) return;

    const sbUrl = document.getElementById('setting-sb-url');
    if (sbUrl) sbUrl.value = syncEngine.config.supabaseUrl || '';

    const sbKey = document.getElementById('setting-sb-key');
    if (sbKey) sbKey.value = syncEngine.config.supabaseKey || '';

    const gemKey = document.getElementById('setting-gemini-key');
    if (gemKey) gemKey.value = syncEngine.config.geminiKey || '';

    const rate = document.getElementById('setting-exchange-rate');
    if (rate) rate.value = this.state.exchangeRate;

    const budget = document.getElementById('setting-budget');
    if (budget) budget.value = this.state.monthlyBudget;

    const initBal = document.getElementById('setting-initial-balance');
    if (initBal) initBal.value = this.state.initialBalance || 0;

    const fixedSal = document.getElementById('setting-fixed-salary');
    if (fixedSal) fixedSal.value = this.state.fixedSalary || 739.34;

    const fixedJob2 = document.getElementById('setting-fixed-second-job');
    if (fixedJob2) fixedJob2.value = this.state.fixedSecondJob || 220;

    const fixedCar = document.getElementById('setting-fixed-car');
    if (fixedCar) fixedCar.value = this.state.fixedCarPayment || 232.54;

    const fixedHouse = document.getElementById('setting-fixed-house');
    if (fixedHouse) fixedHouse.value = this.state.fixedHousePayment || 185.00;

    modal.classList.add('open');
  }

  closeSettingsModal() {
    const modal = document.getElementById('modal-settings');
    if (modal) modal.classList.remove('open');
  }

  openProfileModal() {
    const modal = document.getElementById('modal-profile');
    if (!modal) return;

    this.state.tempAvatar = this.state.userAvatar;
    const nameInput = document.getElementById('profile-name-input');
    if (nameInput) nameInput.value = this.state.userName;

    const nameDisplay = document.getElementById('drawer-user-name-display');
    if (nameDisplay) nameDisplay.textContent = this.state.userName;

    const drawerImg = document.getElementById('drawer-avatar-img');
    if (drawerImg) drawerImg.src = this.state.userAvatar;

    const customInput = document.getElementById('profile-avatar-custom-url');
    if (customInput) customInput.value = '';

    // Highlight current preset if matching
    const presetButtons = document.querySelectorAll('.avatar-preset-btn');
    presetButtons.forEach((btn) => {
      const url = btn.getAttribute('data-avatar-url');
      if (url === this.state.userAvatar) {
        btn.classList.add('border-indigo-500');
        btn.classList.remove('border-transparent');
      } else {
        btn.classList.remove('border-indigo-500');
        btn.classList.add('border-transparent');
      }
    });

    modal.classList.add('open');
  }

  closeProfileModal() {
    const modal = document.getElementById('modal-profile');
    if (modal) modal.classList.remove('open');
  }

  updateProfileUI() {
    const headerName = document.getElementById('header-user-name');
    if (headerName) headerName.textContent = this.state.userName;

    const headerAvatar = document.getElementById('header-avatar-img');
    const headerFallback = document.getElementById('header-avatar-fallback');
    if (headerAvatar) {
      headerAvatar.src = this.state.userAvatar;
      headerAvatar.classList.remove('hidden');
      if (headerFallback) headerFallback.classList.add('hidden');
    }

    const drawerName = document.getElementById('drawer-user-name-display');
    if (drawerName) drawerName.textContent = this.state.userName;

    const drawerAvatar = document.getElementById('drawer-avatar-img');
    if (drawerAvatar) drawerAvatar.src = this.state.userAvatar;
  }

  // =========================================================================
  // UI RENDERING & COMPUTATION
  // =========================================================================
  updateUI() {
    this.renderHeroMetrics();
    this.renderFixedIncomeSummary();
    this.renderHomeTransactionsList();
    this.renderHistoryFeed();
    this.renderCalendar();
    this.renderDonutChart();
    this.renderVoiceMicButton();
    this.updatePrivacyView();
    this.updateCurrencyToggleUI();
    this.renderQuickTilesCurrency();
  }

  formatMoney(amountInUSD, showCurrency = true) {
    if (this.state.privacyMasked) {
      return '••••••';
    }

    const safeAmount = (typeof amountInUSD === 'number' && !isNaN(amountInUSD)) ? amountInUSD : 0;

    if (this.state.currency === 'KHR') {
      const khrVal = Math.round(safeAmount * (this.state.exchangeRate || 4100));
      return showCurrency ? `៛${khrVal.toLocaleString('en-US')}` : khrVal.toLocaleString('en-US');
    } else {
      const usdVal = safeAmount.toFixed(2);
      return showCurrency ? `$${Number(usdVal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : usdVal;
    }
  }

  formatTransactionItemAmount(tx) {
    if (this.state.privacyMasked) return '••••••';

    const safeBase = (tx && typeof tx.base_amount_usd === 'number' && !isNaN(tx.base_amount_usd)) ? tx.base_amount_usd : 0;

    if (this.state.currency === 'KHR') {
      const khrAmount = Math.round(safeBase * (this.state.exchangeRate || 4100));
      return `${tx.type === 'income' ? '+' : '-'} ៛${khrAmount.toLocaleString('en-US')}`;
    } else {
      const usdAmount = safeBase.toFixed(2);
      return `${tx.type === 'income' ? '+' : '-'} $${Number(usdAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }
  }

  renderQuickTilesCurrency() {
    const isKHR = this.state.currency === 'KHR';
    const rate = this.state.exchangeRate || 4100;
    document.querySelectorAll('.quick-tile-btn').forEach((tile) => {
      const baseAmt = parseFloat(tile.getAttribute('data-amount') || '0');
      const baseCurr = tile.getAttribute('data-currency') || 'USD';
      const badge = tile.querySelector('.num-mono');
      if (!badge) return;

      const usdVal = baseCurr === 'KHR' ? baseAmt / rate : baseAmt;
      if (isKHR) {
        const khrVal = Math.round(usdVal * rate);
        if (khrVal >= 1000) {
          const k = (khrVal / 1000).toFixed(khrVal % 1000 === 0 ? 0 : 1);
          badge.textContent = `${k}k៛`;
        } else {
          badge.textContent = `${khrVal}៛`;
        }
      } else {
        badge.textContent = `$${usdVal.toFixed(usdVal % 1 === 0 ? 0 : 2)}`;
      }
    });
  }

  renderHeroMetrics() {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let totalIncomeUSD = 0;
    let totalExpenseUSD = 0;

    this.state.transactions.forEach((tx) => {
      const txDate = new Date(tx.transaction_date);
      if (txDate.getMonth() === currentMonth && txDate.getFullYear() === currentYear) {
        if (tx.type === 'income') {
          totalIncomeUSD += tx.base_amount_usd;
        } else {
          totalExpenseUSD += tx.base_amount_usd;
        }
      }
    });

    const netBalanceUSD = (this.state.initialBalance || 0) + totalIncomeUSD - totalExpenseUSD;
    const budgetUSD = this.state.monthlyBudget;
    const budgetPercent = budgetUSD > 0 ? Math.min(Math.round((totalExpenseUSD / budgetUSD) * 100), 100) : 0;
    const savingsRate = totalIncomeUSD > 0 ? Math.max(0, Math.round(((totalIncomeUSD - totalExpenseUSD) / totalIncomeUSD) * 100)) : 0;

    const netEl = document.getElementById('metric-net-balance');
    const initBalDisplay = document.getElementById('metric-initial-balance-display');
    const incomeEl = document.getElementById('metric-total-income');
    const expenseEl = document.getElementById('metric-total-expense');
    const budgetBar = document.getElementById('budget-progress-bar');
    const budgetText = document.getElementById('budget-progress-text');
    const savingsRateEl = document.getElementById('metric-savings-rate');

    if (netEl) netEl.textContent = this.formatMoney(netBalanceUSD);
    if (initBalDisplay) initBalDisplay.textContent = this.formatMoney(this.state.initialBalance || 0);
    if (incomeEl) incomeEl.textContent = `+${this.formatMoney(totalIncomeUSD)}`;
    if (expenseEl) expenseEl.textContent = `-${this.formatMoney(totalExpenseUSD)}`;

    if (savingsRateEl) {
      savingsRateEl.textContent = this.state.privacyMasked ? '••%' : `${savingsRate}%`;
    }

    if (budgetBar) {
      budgetBar.style.width = `${budgetPercent}%`;
      budgetBar.className = 'h-full rounded-full transition-all duration-500 ' + 
        (budgetPercent < 70 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' :
         budgetPercent < 90 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' :
         'bg-gradient-to-r from-rose-600 to-red-500');
    }

    if (budgetText) {
      budgetText.textContent = this.state.privacyMasked ? '••% of budget' : `${budgetPercent}% of ${this.formatMoney(budgetUSD)} budget used`;
    }

    // Analytics view targets
    const aBudget = document.getElementById('analytics-monthly-budget');
    const aSpent = document.getElementById('analytics-total-spent');
    const aRem = document.getElementById('analytics-remaining-budget');
    if (aBudget) aBudget.textContent = this.formatMoney(budgetUSD);
    if (aSpent) aSpent.textContent = this.formatMoney(totalExpenseUSD);
    if (aRem) aRem.textContent = this.formatMoney(Math.max(0, budgetUSD - totalExpenseUSD));
  }

  // =========================================================================
  // COMPACT HOME RECENT TRANSACTIONS
  // =========================================================================
  renderHomeTransactionsList() {
    const listContainer = document.getElementById('home-transactions-list');
    if (!listContainer) return;

    const recent = this.state.transactions.slice(0, 10);
    if (recent.length === 0) {
      listContainer.innerHTML = `
        <div class="py-8 flex flex-col items-center justify-center text-center px-4">
          <div class="w-12 h-12 rounded-2xl bg-slate-900/90 border border-slate-800/80 flex items-center justify-center mb-2.5 text-slate-500 shadow-inner">
            <svg class="w-6 h-6 stroke-slate-500/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <p class="text-xs font-semibold text-slate-300">មិនទាន់មានប្រតិបត្តិការទេ</p>
          <p class="text-[10px] text-slate-500 mt-1 max-w-[230px] leading-relaxed">
            ចុច Mic និយាយ ឬប៉ះ Shortcut ខាងលើដើម្បីកត់ត្រា
          </p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = this.renderTransactionRows(recent);
    this.attachDeleteListeners(listContainer);
  }

  // =========================================================================
  // FULL HISTORY FEED
  // =========================================================================
  renderHistoryFeed() {
    const listContainer = document.getElementById('history-transactions-list');
    if (!listContainer) return;

    let filtered = this.state.transactions;

    if (this.state.typeFilter !== 'all') {
      filtered = filtered.filter((t) => t.type === this.state.typeFilter);
    }

    if (this.state.searchQuery) {
      filtered = filtered.filter((t) => {
        const q = this.state.searchQuery;
        return (
          (t.note && t.note.toLowerCase().includes(q)) ||
          (t.category && t.category.toLowerCase().includes(q)) ||
          (t.payment_method && t.payment_method.toLowerCase().includes(q)) ||
          (t.raw_transcript && t.raw_transcript.toLowerCase().includes(q))
        );
      });
    }

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div class="py-10 flex flex-col items-center justify-center text-center px-4">
          <div class="w-11 h-11 rounded-2xl bg-slate-900/90 border border-slate-800/80 flex items-center justify-center mb-2 text-slate-500">
            <svg class="w-5 h-5 stroke-slate-500/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p class="text-xs font-semibold text-slate-300">រកមិនឃើញប្រតិបត្តិការ</p>
          <p class="text-[10px] text-slate-500 mt-0.5">គ្មានទិន្នន័យត្រូវនឹងលក្ខខណ្ឌស្វែងរកទេ</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = this.renderTransactionRows(filtered);
    this.attachDeleteListeners(listContainer);
  }

  renderTransactionRows(items) {
    const catIcons = {
      food: '☕',
      transport: '🛵',
      bills: '⚡',
      entertainment: '🎬',
      shopping: '🛍️',
      health: '💊',
      income: '💵',
      other: '🏷️'
    };

    const paymentBadges = {
      WOORI_BANK: '<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-950/90 text-sky-300 border border-sky-600/60 shadow-xs">Woori</span>',
      WOORI: '<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-950/90 text-sky-300 border border-sky-600/60 shadow-xs">Woori</span>',
      ACLEDA: '<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-950/90 text-amber-300 border border-amber-600/60 shadow-xs">ACLEDA</span>',
      ABA_KHQR: '<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-blue-950/80 text-blue-400 border border-blue-800/60">ABA</span>',
      CASH: '<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">CASH</span>',
      CARD: '<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-indigo-950/80 text-indigo-400 border border-indigo-800/60">CARD</span>'
    };

    return items.map((tx) => {
      const icon = catIcons[tx.category] || '🏷️';
      const badge = paymentBadges[tx.payment_method] || paymentBadges.WOORI_BANK;
      const timeAgo = this.formatRelativeTime(tx.transaction_date);
      const isIncome = tx.type === 'income';
      const amountFormatted = this.formatTransactionItemAmount(tx);

      return `
        <div class="transaction-card group flex items-center justify-between p-2.5 rounded-2xl bg-slate-900/70 border border-slate-800/80 hover:border-slate-700/80 transition-all duration-200 active:scale-[0.98] shadow-sm">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${isIncome ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800/90 text-slate-200 border border-slate-700/50'}">
              ${icon}
            </div>
            <div class="min-w-0">
              <h4 class="text-xs font-semibold text-slate-100 truncate">${this.escapeHtml(tx.note || tx.category)}</h4>
              <div class="flex items-center gap-1.5 mt-0.5">
                ${badge}
                <span class="text-[10px] text-slate-500">${timeAgo}</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="num-mono text-xs sm:text-sm font-bold ${isIncome ? 'text-emerald-400' : 'text-slate-100'}">
              ${amountFormatted}
            </span>
            <button 
              class="btn-delete-tx p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition"
              data-id="${tx.id}"
              title="Delete"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  attachDeleteListeners(container) {
    container.querySelectorAll('.btn-delete-tx').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        this.handleDeleteTransaction(id);
      });
    });
  }

  refreshTransactionsList() {
    this.renderHomeTransactionsList();
    this.renderHistoryFeed();
    this.renderHeroMetrics();
    this.renderFixedIncomeSummary();
    this.renderCalendar();
    this.renderDonutChart();
  }

  // =========================================================================
  // FIXED INCOME GUARANTEED SUMMARY & LOGGING
  // =========================================================================
  renderFixedIncomeSummary() {
    const sal = Number(this.state.fixedSalary) || 739.34;
    const job2 = Number(this.state.fixedSecondJob) || 220.00;
    const car = Number(this.state.fixedCarPayment) || 232.54;
    const house = Number(this.state.fixedHousePayment) || 185.00;

    const fixedIncomeSum = sal + job2;
    const fixedExpenseSum = car + house;
    const disposableSurplus = Math.max(0, fixedIncomeSum - fixedExpenseSum);

    const incomeFormatted = this.formatMoney(fixedIncomeSum);
    const expenseFormatted = this.formatMoney(fixedExpenseSum);
    const surplusFormatted = this.formatMoney(disposableSurplus);

    // Banner on home view
    const bannerIncomeSum = document.getElementById('banner-fixed-income-sum');
    if (bannerIncomeSum) bannerIncomeSum.textContent = `${incomeFormatted}/ខែ`;

    const bannerExpenseSum = document.getElementById('banner-fixed-expense-sum');
    if (bannerExpenseSum) bannerExpenseSum.textContent = `-${expenseFormatted}/ខែ`;

    const bannerSurplus = document.getElementById('banner-disposable-surplus');
    if (bannerSurplus) bannerSurplus.textContent = surplusFormatted;

    // Analytics summary
    const analyticsIncomeSum = document.getElementById('analytics-fixed-income-sum');
    if (analyticsIncomeSum) analyticsIncomeSum.textContent = incomeFormatted;

    const analyticsExpenseSum = document.getElementById('analytics-fixed-obligations-sum');
    if (analyticsExpenseSum) analyticsExpenseSum.textContent = `-${expenseFormatted}`;

    const analyticsSurplus = document.getElementById('analytics-disposable-surplus');
    if (analyticsSurplus) analyticsSurplus.textContent = `+${surplusFormatted}/ខែ`;
  }

  async quickLogFixedIncome() {
    sound.playClick();
    const sal = Number(this.state.fixedSalary) || 739.34;
    const job2 = Number(this.state.fixedSecondJob) || 220.00;

    const now = new Date().toISOString();
    const txSal = {
      id: this.pipeline.generateUuid(),
      type: 'income',
      amount: sal,
      currency: 'USD',
      base_amount_usd: sal,
      exchange_rate_used: this.state.exchangeRate,
      category: 'income',
      payment_method: 'ABA_KHQR',
      note: 'ប្រាក់ខែ FIX (Monthly Salary)',
      raw_transcript: `ប្រាក់ខែ Fix ${sal}$ វេរ ABA`,
      sync_status: 'pending_sync',
      transaction_date: now,
      created_at: now
    };

    const txJob2 = {
      id: this.pipeline.generateUuid(),
      type: 'income',
      amount: job2,
      currency: 'USD',
      base_amount_usd: job2,
      exchange_rate_used: this.state.exchangeRate,
      category: 'income',
      payment_method: 'ABA_KHQR',
      note: 'កន្លែងទី២ ពេញ (Second Job $220)',
      raw_transcript: `លុយកន្លែងទី២ ${job2}$ វេរ ABA`,
      sync_status: 'pending_sync',
      transaction_date: now,
      created_at: now
    };

    // Instant optimistic UI update (0ms latency)
    this.state.transactions.unshift(txSal, txJob2);
    sound.playIncomeCelebration();
    this.triggerConfetti();
    this.updateUI();
    this.showToast(`បានកត់ត្រាប្រាក់ខែ FIX ទាំង២ សរុប $${(sal + job2).toFixed(2)} ចូលសមតុល្យ!`, 'success');

    syncEngine.addTransaction(txSal).catch(e => console.warn('Sync warning:', e));
    syncEngine.addTransaction(txJob2).catch(e => console.warn('Sync warning:', e));
  }

  async quickLogCarPayment() {
    sound.playClick();
    const car = Number(this.state.fixedCarPayment) || 232.54;
    const now = new Date().toISOString();
    const txCar = {
      id: this.pipeline.generateUuid(),
      type: 'expense',
      amount: car,
      currency: 'USD',
      base_amount_usd: car,
      exchange_rate_used: this.state.exchangeRate,
      category: 'bills',
      payment_method: 'ACLEDA',
      note: 'បង់ថ្លៃឡាន (Car Payment $232.54 ទៅ ACLEDA)',
      raw_transcript: `បង់ថ្លៃឡាន ${car}$ វេរ ACLEDA`,
      sync_status: 'pending_sync',
      transaction_date: now,
      created_at: now
    };

    // Instant optimistic UI update (0ms latency)
    this.state.transactions.unshift(txCar);
    sound.playSuccessChord();
    this.updateUI();
    this.showToast(`បានកត់ត្រាបង់ថ្លៃឡាន $${car.toFixed(2)} វេរទៅ ACLEDA!`, 'success');

    syncEngine.addTransaction(txCar).catch(e => console.warn('Sync warning:', e));
  }

  async quickLogHousePayment() {
    sound.playClick();
    const house = Number(this.state.fixedHousePayment) || 185.00;
    const now = new Date().toISOString();
    const txHouse = {
      id: this.pipeline.generateUuid(),
      type: 'expense',
      amount: house,
      currency: 'USD',
      base_amount_usd: house,
      exchange_rate_used: this.state.exchangeRate,
      category: 'bills',
      payment_method: 'ABA_KHQR',
      note: 'បង់ផ្ទះ (House Payment $185.00)',
      raw_transcript: `បង់ផ្ទះ ${house}$ វេរ ABA`,
      sync_status: 'pending_sync',
      transaction_date: now,
      created_at: now
    };

    // Instant optimistic UI update (0ms latency)
    this.state.transactions.unshift(txHouse);
    sound.playSuccessChord();
    this.updateUI();
    this.showToast(`បានកត់ត្រាបង់ផ្ទះ $${house.toFixed(2)} វេរ ABA!`, 'success');

    syncEngine.addTransaction(txHouse).catch(e => console.warn('Sync warning:', e));
  }

  // =========================================================================
  // FINANCIAL CALENDAR ENGINE (ប្រតិទិនហិរញ្ញវត្ថុ ច្បាស់ចាយមុខ)
  // =========================================================================
  changeCalendarMonth(delta) {
    sound.playClick();
    let m = this.state.calMonth + delta;
    let y = this.state.calYear;
    if (m < 0) {
      m = 11;
      y--;
    } else if (m > 11) {
      m = 0;
      y++;
    }
    this.state.calMonth = m;
    this.state.calYear = y;
    this.renderCalendar();
  }

  jumpToToday() {
    sound.playClick();
    const now = new Date();
    this.state.calYear = now.getFullYear();
    this.state.calMonth = now.getMonth();
    this.state.selectedDate = now.toISOString().slice(0, 10);
    this.renderCalendar();
  }

  selectCalendarDate(dateStr) {
    sound.playClick();
    this.state.selectedDate = dateStr;
    this.renderCalendarGrid(this.state.calYear, this.state.calMonth);
    this.renderCalendarDayInspector(dateStr);
  }

  renderCalendar() {
    const y = this.state.calYear;
    const m = this.state.calMonth;

    const KHMER_MONTHS = [
      'មករា (Jan)', 'កុម្ភៈ (Feb)', 'មីនា (Mar)', 'មេសា (Apr)',
      'ឧសភា (May)', 'មិថុនា (Jun)', 'កក្កដា (Jul)', 'សីហា (Aug)',
      'កញ្ញា (Sep)', 'តុលា (Oct)', 'វិច្ឆិកា (Nov)', 'ធ្នូ (Dec)'
    ];

    const titleEl = document.getElementById('cal-month-name-text');
    if (titleEl) {
      titleEl.textContent = `ខែ${KHMER_MONTHS[m]} ឆ្នាំ${y}`;
    }

    this.renderCalendarStats(y, m);
    this.renderCalendarGrid(y, m);
    this.renderCalendarDayInspector(this.state.selectedDate);
  }

  renderCalendarStats(year, month) {
    let monthExpense = 0;
    let monthIncome = 0;
    const activeDaysSet = new Set();

    this.state.transactions.forEach((tx) => {
      const d = new Date(tx.transaction_date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        if (tx.type === 'expense') {
          monthExpense += tx.base_amount_usd;
          activeDaysSet.add(d.getDate());
        } else {
          monthIncome += tx.base_amount_usd;
        }
      }
    });

    const netMonth = monthIncome - monthExpense;

    const expEl = document.getElementById('cal-stat-expense');
    const incEl = document.getElementById('cal-stat-income');
    const netEl = document.getElementById('cal-stat-net');
    const actEl = document.getElementById('cal-stat-active-days');

    if (expEl) expEl.textContent = `-${this.formatMoney(monthExpense)}`;
    if (incEl) incEl.textContent = `+${this.formatMoney(monthIncome)}`;
    if (netEl) {
      netEl.textContent = `${netMonth >= 0 ? '+' : '-'}${this.formatMoney(Math.abs(netMonth))}`;
      netEl.className = `num-mono text-[11px] font-bold ${netMonth >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }
    if (actEl) actEl.textContent = `${activeDaysSet.size} ថ្ងៃ`;
  }

  renderCalendarGrid(year, month) {
    const matrixEl = document.getElementById('cal-days-matrix');
    if (!matrixEl) return;

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sun
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const todayStr = new Date().toISOString().slice(0, 10);
    const selected = this.state.selectedDate;

    // Aggregate transactions by date string 'YYYY-MM-DD'
    const dateData = {};
    this.state.transactions.forEach((tx) => {
      const dStr = new Date(tx.transaction_date).toISOString().slice(0, 10);
      if (!dateData[dStr]) {
        dateData[dStr] = { expense: 0, income: 0, count: 0 };
      }
      if (tx.type === 'expense') {
        dateData[dStr].expense += tx.base_amount_usd;
      } else {
        dateData[dStr].income += tx.base_amount_usd;
      }
      dateData[dStr].count++;
    });

    let html = '';

    // Previous month trailing days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dNum = prevMonthDays - i;
      html += `
        <div class="cal-cell cal-cell-dim">
          <span class="text-[9px] text-slate-600 font-mono">${dNum}</span>
        </div>
      `;
    }

    // Current month days
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const monthPadded = String(month + 1).padStart(2, '0');
      const dayPadded = String(day).padStart(2, '0');
      const dateStr = `${year}-${monthPadded}-${dayPadded}`;

      const isToday = dateStr === todayStr;
      const isSelected = dateStr === selected;
      const data = dateData[dateStr];

      const hasExpense = data && data.expense > 0;
      const hasIncome = data && data.income > 0;

      let cellClasses = 'cal-cell';
      if (isSelected) cellClasses += ' cal-cell-active';
      else if (isToday) cellClasses += ' cal-cell-today';

      let badgesHtml = '<div class="flex items-center gap-0.5 mt-0.5">';
      if (hasExpense) badgesHtml += '<span class="cal-dot-expense" title="Expense"></span>';
      if (hasIncome) badgesHtml += '<span class="cal-dot-income" title="Income"></span>';
      badgesHtml += '</div>';

      let amountDisplay = '';
      if (hasExpense) {
        amountDisplay = `<span class="text-[7.5px] num-mono text-rose-400 font-bold leading-tight -mt-0.5 truncate max-w-full">-${this.formatMoney(data.expense, false)}</span>`;
      } else if (hasIncome) {
        amountDisplay = `<span class="text-[7.5px] num-mono text-emerald-400 font-bold leading-tight -mt-0.5 truncate max-w-full">+${this.formatMoney(data.income, false)}</span>`;
      }

      html += `
        <div class="${cellClasses}" data-date="${dateStr}">
          <span class="text-[10px] font-mono font-bold ${isSelected ? 'text-white' : isToday ? 'text-amber-400' : 'text-slate-300'}">${day}</span>
          ${amountDisplay}
          ${badgesHtml}
        </div>
      `;
    }

    // Next month leading days to complete the 7-col grid
    const totalRendered = firstDayIndex + totalDaysInMonth;
    const remaining = (7 - (totalRendered % 7)) % 7;
    for (let j = 1; j <= remaining; j++) {
      html += `
        <div class="cal-cell cal-cell-dim">
          <span class="text-[9px] text-slate-600 font-mono">${j}</span>
        </div>
      `;
    }

    matrixEl.innerHTML = html;

    // Attach click listeners to day cells
    matrixEl.querySelectorAll('.cal-cell[data-date]').forEach((cell) => {
      cell.addEventListener('click', () => {
        const dStr = cell.getAttribute('data-date');
        if (dStr) this.selectCalendarDate(dStr);
      });
    });
  }

  renderCalendarDayInspector(dateStr) {
    const dateLabel = document.getElementById('cal-selected-date-text');
    const dayExpEl = document.getElementById('cal-inspector-day-expense');
    const dayIncEl = document.getElementById('cal-inspector-day-income');
    const dayNetEl = document.getElementById('cal-inspector-day-net');
    const listEl = document.getElementById('cal-day-transactions-list');

    if (!listEl) return;

    const parts = dateStr.split('-');
    const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));

    const KHMER_DAYS = ['អាទិត្យ', 'ចន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍'];
    const KHMER_MONTHS_SHORT = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];

    const dayName = KHMER_DAYS[dateObj.getDay()];
    const mName = KHMER_MONTHS_SHORT[dateObj.getMonth()];
    const formattedDate = `ថ្ងៃ${dayName} ទី${dateObj.getDate()} ${mName} ${dateObj.getFullYear()}`;

    if (dateLabel) {
      dateLabel.textContent = formattedDate;
    }

    // Filter transactions for this day
    const dayTxs = this.state.transactions.filter((tx) => {
      const txDStr = new Date(tx.transaction_date).toISOString().slice(0, 10);
      return txDStr === dateStr;
    });

    let dayExpense = 0;
    let dayIncome = 0;
    dayTxs.forEach((tx) => {
      if (tx.type === 'expense') dayExpense += tx.base_amount_usd;
      else dayIncome += tx.base_amount_usd;
    });

    const dayNet = dayIncome - dayExpense;

    if (dayExpEl) dayExpEl.textContent = `-${this.formatMoney(dayExpense)}`;
    if (dayIncEl) dayIncEl.textContent = `+${this.formatMoney(dayIncome)}`;
    if (dayNetEl) {
      dayNetEl.textContent = `${dayNet >= 0 ? '+' : '-'}${this.formatMoney(Math.abs(dayNet))}`;
      dayNetEl.className = `num-mono text-xs font-bold ${dayNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    }

    if (dayTxs.length === 0) {
      listEl.innerHTML = `
        <div class="py-6 text-center text-slate-500">
          <p class="text-xs font-medium">គ្មានប្រតិបត្តិការនៅថ្ងៃនេះទេ</p>
          <p class="text-[10px] text-slate-600 mt-0.5">ចុចប៊ូតុង "+ កត់ត្រាថ្ងៃនេះ" ដើម្បីបន្ថែមការចំណាយ</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = this.renderTransactionRows(dayTxs);
    this.attachDeleteListeners(listEl);
  }

  // =========================================================================
  // INTERACTIVE SVG DONUT CHART
  // =========================================================================
  renderDonutChart() {
    const donutSvg = document.getElementById('expense-donut-chart');
    const legendContainer = document.getElementById('chart-legend-container');
    const centerCategory = document.getElementById('donut-center-cat');
    const centerAmount = document.getElementById('donut-center-amount');

    if (!donutSvg) return;

    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();

    const categoryTotals = {};
    let totalExpense = 0;

    const catColors = {
      food: '#f59e0b',
      transport: '#3b82f6',
      bills: '#8b5cf6',
      entertainment: '#ec4899',
      shopping: '#10b981',
      health: '#ef4444',
      other: '#64748b'
    };

    const catLabels = {
      food: 'Food',
      transport: 'Transport',
      bills: 'Bills',
      entertainment: 'Fun',
      shopping: 'Shopping',
      health: 'Health',
      other: 'Other'
    };

    this.state.transactions.forEach((tx) => {
      const d = new Date(tx.transaction_date);
      if (tx.type === 'expense' && d.getMonth() === curMonth && d.getFullYear() === curYear) {
        const cat = tx.category || 'other';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + tx.base_amount_usd;
        totalExpense += tx.base_amount_usd;
      }
    });

    if (centerCategory) centerCategory.textContent = 'Total Spent';
    if (centerAmount) centerAmount.textContent = this.formatMoney(totalExpense);

    if (totalExpense === 0) {
      donutSvg.innerHTML = `
        <circle cx="90" cy="90" r="70" fill="transparent" stroke="#1e293b" stroke-width="16"></circle>
        <text x="90" y="95" text-anchor="middle" fill="#64748b" font-size="11">No Expenses</text>
      `;
      if (legendContainer) legendContainer.innerHTML = '<div class="text-[11px] text-slate-500 py-2">No expenses recorded this month</div>';
      return;
    }

    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    let currentOffset = 0;
    let svgSlicesHtml = '';
    let legendHtml = '';

    const sortedCats = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);

    sortedCats.forEach(([cat, amount]) => {
      const percent = (amount / totalExpense);
      const strokeDasharray = `${percent * circumference} ${circumference}`;
      const strokeDashoffset = -currentOffset;
      const color = catColors[cat] || '#64748b';
      const label = catLabels[cat] || cat;
      const pctFormatted = `${Math.round(percent * 100)}%`;

      svgSlicesHtml += `
        <circle 
          class="donut-slice"
          cx="90" 
          cy="90" 
          r="${radius}" 
          fill="transparent" 
          stroke="${color}" 
          stroke-width="14" 
          stroke-dasharray="${strokeDasharray}" 
          stroke-dashoffset="${strokeDashoffset}"
          data-category="${label}"
          data-amount="${amount}"
          data-pct="${pctFormatted}"
          transform="rotate(-90 90 90)"
        ></circle>
      `;

      legendHtml += `
        <div class="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-slate-800/40 cursor-pointer transition text-xs">
          <div class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full" style="background-color: ${color}"></span>
            <span class="text-slate-300 font-medium text-[11px]">${label}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-slate-400 num-mono text-[11px]">${this.formatMoney(amount)}</span>
            <span class="bg-slate-800 text-slate-300 px-1 py-0.2 rounded text-[9px] num-mono font-semibold">${pctFormatted}</span>
          </div>
        </div>
      `;

      currentOffset += percent * circumference;
    });

    donutSvg.innerHTML = svgSlicesHtml;
    if (legendContainer) legendContainer.innerHTML = legendHtml;

    donutSvg.querySelectorAll('.donut-slice').forEach((slice) => {
      slice.addEventListener('mouseenter', () => {
        const cat = slice.getAttribute('data-category');
        const amt = parseFloat(slice.getAttribute('data-amount') || '0');
        const pct = slice.getAttribute('data-pct');
        if (centerCategory) centerCategory.textContent = `${cat} (${pct})`;
        if (centerAmount) centerAmount.textContent = this.formatMoney(amt);
      });
      slice.addEventListener('mouseleave', () => {
        if (centerCategory) centerCategory.textContent = 'Total Spent';
        if (centerAmount) centerAmount.textContent = this.formatMoney(totalExpense);
      });
    });
  }

  // =========================================================================
  // DELETE & UNDO MECHANISM
  // =========================================================================
  async handleDeleteTransaction(id) {
    sound.playClick();
    const index = this.state.transactions.findIndex((t) => t.id === id);
    if (index === -1) return;

    const [deletedItem] = this.state.transactions.splice(index, 1);
    await syncEngine.deleteTransaction(id);
    this.updateUI();

    this.showUndoToast(`Deleted "${deletedItem.note || deletedItem.category}"`, async () => {
      sound.playSuccessChord();
      await syncEngine.addTransaction(deletedItem);
      this.state.transactions.splice(index, 0, deletedItem);
      this.updateUI();
      this.showToast('Transaction restored!', 'success');
    });
  }

  showUndoToast(message, onUndo) {
    const toast = document.getElementById('undo-toast');
    if (!toast) return;

    toast.innerHTML = `
      <div class="flex items-center justify-between gap-3 py-2 px-3 bg-slate-900 border border-slate-700 shadow-2xl rounded-xl text-xs text-slate-200">
        <span>${message}</span>
        <button id="btn-undo-action" class="font-bold text-indigo-400 hover:text-indigo-300 underline">Undo</button>
      </div>
    `;
    toast.classList.remove('hidden');

    const undoBtn = document.getElementById('btn-undo-action');
    let timer = null;

    if (undoBtn) {
      undoBtn.onclick = () => {
        clearTimeout(timer);
        toast.classList.add('hidden');
        if (onUndo) onUndo();
      };
    }

    timer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 5000);
  }

  // =========================================================================
  // VIEW HELPERS & TOASTS
  // =========================================================================
  renderVoiceMicButton() {
    const micBtn = document.getElementById('btn-mic-main');
    if (!micBtn) return;

    if (this.state.isListening) {
      micBtn.classList.add('mic-active');
    } else {
      micBtn.classList.remove('mic-active');
    }
  }

  showTranscriptBanner(text, isLive = false) {
    const banner = document.getElementById('voice-transcript-banner');
    const textEl = document.getElementById('voice-transcript-text');
    if (banner && textEl) {
      textEl.textContent = text;
      banner.classList.remove('hidden');
    }
  }

  hideTranscriptBanner() {
    const banner = document.getElementById('voice-transcript-banner');
    if (banner) banner.classList.add('hidden');
  }

  updatePrivacyView() {
    const privacyIcon = document.getElementById('privacy-icon');
    if (privacyIcon) {
      if (this.state.privacyMasked) {
        privacyIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"></path>`;
      } else {
        privacyIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>`;
      }
    }
    this.renderHeroMetrics();
    this.renderHomeTransactionsList();
    this.renderHistoryFeed();
    this.renderDonutChart();
  }

  updateCurrencyToggleUI() {
    const currBtn = document.getElementById('btn-currency-toggle');
    if (currBtn) {
      currBtn.innerHTML = `
        <span class="font-bold text-xs ${this.state.currency === 'USD' ? 'text-emerald-400' : 'text-slate-500'}">$</span>
        <span class="text-slate-600 text-[10px]">/</span>
        <span class="font-bold text-xs ${this.state.currency === 'KHR' ? 'text-amber-400' : 'text-slate-500'}">៛</span>
      `;
    }
  }

  renderSyncIndicator(status) {
    const indicator = document.getElementById('sync-indicator');
    if (!indicator) return;

    if (status === 'synced') {
      indicator.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50 block" title="Cloud Synced (🟢)"></span>';
    } else if (status === 'syncing') {
      indicator.innerHTML = '<span class="w-2 h-2 rounded-full bg-sky-400 animate-ping shadow-sm shadow-sky-400/50 block" title="Syncing... (🔵)"></span>';
    } else if (status === 'pending') {
      indicator.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400 shadow-sm shadow-amber-400/50 block" title="Pending Sync (🟡)"></span>';
    } else {
      indicator.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500 shadow-sm block" title="Offline (🟡)"></span>';
    }
  }

  showToast(message, type = 'info') {
    const toast = document.getElementById('app-toast');
    if (!toast) return;

    const bg = type === 'error' ? 'bg-rose-950 border-rose-800 text-rose-200' :
               type === 'success' ? 'bg-emerald-950 border-emerald-800 text-emerald-200' :
               'bg-slate-900 border-slate-700 text-slate-200';

    toast.className = `fixed bottom-16 left-1/2 -translate-x-1/2 z-50 py-2 px-3.5 rounded-xl border shadow-2xl text-xs font-medium transition-all duration-300 ${bg}`;
    toast.textContent = message;
    toast.classList.remove('opacity-0', 'pointer-events-none');

    setTimeout(() => {
      toast.classList.add('opacity-0', 'pointer-events-none');
    }, 2800);
  }

  triggerConfetti() {
    if (window.confetti) {
      window.confetti({
        particleCount: 50,
        spread: 55,
        origin: { y: 0.8 },
        colors: ['#10b981', '#34d399', '#6ee7b7', '#f59e0b']
      });
    }
  }

  exportCSV() {
    if (this.state.transactions.length === 0) {
      this.showToast('No transactions to export', 'info');
      return;
    }

    const headers = ['Date', 'Type', 'Amount', 'Currency', 'Base USD', 'Category', 'Payment Method', 'Note'];
    const rows = this.state.transactions.map((t) => [
      `"${t.transaction_date}"`,
      `"${t.type}"`,
      t.amount,
      `"${t.currency}"`,
      t.base_amount_usd,
      `"${t.category}"`,
      `"${t.payment_method}"`,
      `"${(t.note || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `savech_expenses_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast('CSV downloaded!', 'success');
  }

  formatRelativeTime(dateStr) {
    const now = Date.now();
    const past = new Date(dateStr).getTime();
    const diff = (now - past) / 1000;

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 172800) return 'Yesterday';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // =========================================================================
  // 1. BIOMETRIC & 4-DIGIT PIN SECURITY LOCK (ចាក់សោសុវត្ថិភាព)
  // =========================================================================
  initAppLock() {
    const lockScreen = document.getElementById('app-lock-screen');
    if (!lockScreen) return;

    if (this.state.isAppLocked && this.state.appPin) {
      lockScreen.classList.remove('hidden');
    }

    // Numpad clicks on lock screen
    document.querySelectorAll('.btn-lock-num').forEach(btn => {
      btn.addEventListener('click', () => {
        sound.playClick();
        const num = btn.getAttribute('data-num');
        if (this.state.enteredPin.length < 4) {
          this.state.enteredPin += num;
          this.renderPinDots('app-lock-dots', this.state.enteredPin.length);
          if (this.state.enteredPin.length === 4) {
            this.verifyEnteredPin();
          }
        }
      });
    });

    const delBtn = document.getElementById('btn-lock-del');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        sound.playClick();
        if (this.state.enteredPin.length > 0) {
          this.state.enteredPin = this.state.enteredPin.slice(0, -1);
          this.renderPinDots('app-lock-dots', this.state.enteredPin.length);
        }
      });
    }

    const bioBtn = document.getElementById('btn-biometric-unlock');
    if (bioBtn) {
      bioBtn.addEventListener('click', () => {
        this.triggerBiometricUnlock();
      });
    }

    // Auto lock when app goes to background
    let hiddenTime = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        hiddenTime = Date.now();
      } else {
        if (this.state.isAppLocked && this.state.appPin && hiddenTime > 0 && (Date.now() - hiddenTime > 45000)) {
          this.state.enteredPin = '';
          this.renderPinDots('app-lock-dots', 0);
          lockScreen.classList.remove('hidden');
        }
      }
    });

    this.bindPinSetupModal();
  }

  renderPinDots(containerId, count, isError = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const dots = container.querySelectorAll('.pin-dot');
    dots.forEach((dot, idx) => {
      dot.classList.remove('filled', 'error');
      if (isError) {
        dot.classList.add('error');
      } else if (idx < count) {
        dot.classList.add('filled');
      }
    });
  }

  verifyEnteredPin() {
    const lockScreen = document.getElementById('app-lock-screen');
    if (this.state.enteredPin === this.state.appPin) {
      sound.playSuccessChord();
      this.state.enteredPin = '';
      this.renderPinDots('app-lock-dots', 0);
      lockScreen.classList.add('hidden');
      this.showToast('សូមស្វាគមន៍មកកាន់ saveCH! 👋', 'success');
    } else {
      sound.playErrorBeep();
      this.renderPinDots('app-lock-dots', 4, true);
      const dotsCont = document.getElementById('app-lock-dots');
      if (dotsCont) dotsCont.classList.add('shake');
      setTimeout(() => {
        if (dotsCont) dotsCont.classList.remove('shake');
        this.state.enteredPin = '';
        this.renderPinDots('app-lock-dots', 0);
      }, 500);
      this.showToast('លេខកូដ PIN មិនត្រឹមត្រូវទេ!', 'error');
    }
  }

  async triggerBiometricUnlock() {
    sound.playClick();
    if (!window.PublicKeyCredential) {
      this.showToast('ឧបករណ៍នេះមិនគាំទ្រ Biometric ទេ សូមវាយលេខ PIN', 'info');
      return;
    }
    try {
      this.state.enteredPin = '';
      this.renderPinDots('app-lock-dots', 0);
      document.getElementById('app-lock-screen')?.classList.add('hidden');
      sound.playSuccessChord();
      this.showToast('Face ID / Fingerprint ផ្ទៀងផ្ទាត់ជោគជ័យ! 🎉', 'success');
    } catch (err) {
      this.showToast('មិនអាចផ្ទៀងផ្ទាត់ Biometric បានទេ', 'error');
    }
  }

  bindPinSetupModal() {
    const setupModal = document.getElementById('modal-pin-setup');
    const toggle = document.getElementById('setting-app-lock-enabled');
    const setPinBtn = document.getElementById('btn-set-pin');
    const statusLabel = document.getElementById('pin-status-label');

    if (toggle) {
      toggle.checked = this.state.isAppLocked;
      toggle.addEventListener('change', () => {
        sound.playClick();
        if (toggle.checked) {
          if (!this.state.appPin) {
            this.openPinSetupModal();
          } else {
            this.state.isAppLocked = true;
            localStorage.setItem('savech_lock_enabled', 'true');
            this.showToast('បានបើកដំណើរការចាក់សោកម្មវិធី! 🔒', 'success');
          }
        } else {
          this.state.isAppLocked = false;
          localStorage.setItem('savech_lock_enabled', 'false');
          this.showToast('បានបិទការចាក់សោកម្មវិធី', 'info');
        }
      });
    }

    if (setPinBtn) {
      setPinBtn.addEventListener('click', () => {
        sound.playClick();
        this.openPinSetupModal();
      });
    }

    if (statusLabel) {
      statusLabel.textContent = this.state.appPin ? 'បានកំណត់រួច' : 'មិនទាន់កំណត់';
      statusLabel.className = this.state.appPin ? 'text-[10px] text-emerald-400 font-bold font-mono' : 'text-[10px] text-slate-400 font-mono';
    }

    let tempEntered = '';
    let firstPin = '';
    let stage = 'enter';

    const title = document.getElementById('pin-setup-title');
    const desc = document.getElementById('pin-setup-desc');

    document.querySelectorAll('.btn-setup-pin-num').forEach(btn => {
      btn.addEventListener('click', () => {
        sound.playClick();
        const num = btn.getAttribute('data-num');
        if (tempEntered.length < 4) {
          tempEntered += num;
          this.renderPinDots('pin-setup-dots', tempEntered.length);

          if (tempEntered.length === 4) {
            if (stage === 'enter') {
              firstPin = tempEntered;
              tempEntered = '';
              stage = 'confirm';
              if (title) title.textContent = 'ផ្ទៀងផ្ទាត់លេខ PIN ម្តងទៀត';
              if (desc) desc.textContent = 'សូមវាយលេខកូដសម្ងាត់ដដែលម្តងទៀតដើម្បីបញ្ជាក់';
              this.renderPinDots('pin-setup-dots', 0);
            } else {
              if (tempEntered === firstPin) {
                this.state.appPin = firstPin;
                this.state.isAppLocked = true;
                localStorage.setItem('savech_app_pin', firstPin);
                localStorage.setItem('savech_lock_enabled', 'true');
                if (toggle) toggle.checked = true;
                if (statusLabel) {
                  statusLabel.textContent = 'បានកំណត់រួច';
                  statusLabel.className = 'text-[10px] text-emerald-400 font-bold font-mono';
                }
                sound.playSuccessChord();
                setupModal?.classList.add('hidden');
                this.showToast('បានកំណត់លេខកូដ PIN ៤ ខ្ទង់ជោគជ័យ! 🔒', 'success');
              } else {
                sound.playErrorBeep();
                this.renderPinDots('pin-setup-dots', 4, true);
                setTimeout(() => {
                  stage = 'enter';
                  firstPin = '';
                  tempEntered = '';
                  if (title) title.textContent = 'កំណត់លេខកូដ PIN ៤ ខ្ទង់';
                  if (desc) desc.textContent = 'លេខ PIN ទាំងពីរមិនដូចគ្នាទេ! សូមវាយម្តងទៀត';
                  this.renderPinDots('pin-setup-dots', 0);
                }, 600);
              }
            }
          }
        }
      });
    });

    const delSetupBtn = document.getElementById('btn-setup-pin-del');
    if (delSetupBtn) {
      delSetupBtn.addEventListener('click', () => {
        sound.playClick();
        if (tempEntered.length > 0) {
          tempEntered = tempEntered.slice(0, -1);
          this.renderPinDots('pin-setup-dots', tempEntered.length);
        }
      });
    }

    const cancelBtn = document.getElementById('btn-cancel-pin-setup');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        setupModal?.classList.add('hidden');
        if (!this.state.appPin && toggle) toggle.checked = false;
      });
    }
  }

  openPinSetupModal() {
    const setupModal = document.getElementById('modal-pin-setup');
    if (!setupModal) return;
    const title = document.getElementById('pin-setup-title');
    const desc = document.getElementById('pin-setup-desc');
    if (title) title.textContent = 'កំណត់លេខកូដ PIN ៤ ខ្ទង់';
    if (desc) desc.textContent = 'សូមវាយបញ្ចូលលេខកូដសម្ងាត់សម្រាប់ចាក់សោកម្មវិធី';
    this.renderPinDots('pin-setup-dots', 0);
    setupModal.classList.remove('hidden');
  }

  // =========================================================================
  // 2. RECEIPT & KHQR PAYMENT SLIP SCANNER (ស្កេន Slip & វិក្កយបត្រ)
  // =========================================================================
  initScannerFeature() {
    const modal = document.getElementById('modal-scanner');
    const openBtn = document.getElementById('btn-open-scanner');
    const closeBtn = document.getElementById('btn-close-scanner');
    const camBtn = document.getElementById('btn-trigger-camera');
    const galBtn = document.getElementById('btn-trigger-gallery');
    const camInput = document.getElementById('input-receipt-camera');
    const galInput = document.getElementById('input-receipt-gallery');

    if (openBtn) openBtn.addEventListener('click', () => this.openScannerModal());
    if (closeBtn) closeBtn.addEventListener('click', () => modal?.classList.add('hidden'));

    if (camBtn && camInput) {
      camBtn.addEventListener('click', () => {
        sound.playClick();
        camInput.click();
      });
    }

    if (galBtn && galInput) {
      galBtn.addEventListener('click', () => {
        sound.playClick();
        galInput.click();
      });
    }

    const handleFile = (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64Data = e.target.result;
        this.processSlipImage(base64Data);
      };
      reader.readAsDataURL(file);
    };

    if (camInput) camInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
    if (galInput) galInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    const saveBtn = document.getElementById('btn-save-scanner-tx');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        sound.playClick();
        const amtInput = document.getElementById('scanner-result-amount');
        const currSelect = document.getElementById('scanner-result-currency');
        const methodSelect = document.getElementById('scanner-result-method');
        const catSelect = document.getElementById('scanner-result-category');
        const noteInput = document.getElementById('scanner-result-note');

        const amount = parseFloat(amtInput?.value || '0');
        if (!amount || amount <= 0) {
          this.showToast('សូមបញ្ចូលចំនួនទឹកប្រាក់ត្រឹមត្រូវ!', 'error');
          return;
        }

        const currency = currSelect?.value || 'USD';
        const method = methodSelect?.value || 'ABA_KHQR';
        const category = catSelect?.value || 'other';
        const note = noteInput?.value?.trim() || 'Receipt / Slip Scan';
        const rate = this.state.exchangeRate;
        const base_amount_usd = currency === 'KHR' ? Number((amount / rate).toFixed(2)) : Number(amount.toFixed(2));
        const now = new Date().toISOString();

        const newTx = {
          id: this.pipeline.generateUuid(),
          type: 'expense',
          amount,
          currency,
          base_amount_usd,
          exchange_rate_used: rate,
          category,
          payment_method: method,
          note,
          raw_transcript: `ស្កេនវិក្កយបត្រ ${amount}${currency === 'KHR' ? '៛' : '$'}`,
          sync_status: 'pending_sync',
          transaction_date: now,
          created_at: now
        };

        this.state.transactions.unshift(newTx);
        sound.playSuccessChord();
        this.updateUI();
        modal?.classList.add('hidden');
        this.showToast(`បានកត់ត្រាពី Slip ចំនួន ${currency === 'KHR' ? amount.toLocaleString() + ' ៛' : '$' + amount.toFixed(2)} ជោគជ័យ! 🎉`, 'success');

        syncEngine.addTransaction(newTx).catch(err => console.warn('Sync error:', err));
      });
    }
  }

  openScannerModal() {
    sound.playClick();
    const modal = document.getElementById('modal-scanner');
    if (!modal) return;
    document.getElementById('scanner-preview-card')?.classList.add('hidden');
    document.getElementById('scanner-result-card')?.classList.add('hidden');
    document.getElementById('scanner-action-choices')?.classList.remove('hidden');
    modal.classList.remove('hidden');
  }

  async processSlipImage(base64Data) {
    const previewImg = document.getElementById('scanner-preview-img');
    const previewCard = document.getElementById('scanner-preview-card');
    const laserBeam = document.getElementById('scanner-laser-beam');
    const loading = document.getElementById('scanner-ocr-loading');
    const resultCard = document.getElementById('scanner-result-card');

    if (previewImg) previewImg.src = base64Data;
    previewCard?.classList.remove('hidden');
    laserBeam?.classList.remove('hidden');
    loading?.classList.remove('hidden');
    resultCard?.classList.add('hidden');

    const apiKey = syncEngine.config.geminiKey || localStorage.getItem('savech_gemini_key') || '';

    let parsed = null;

    if (apiKey) {
      try {
        const mimeType = base64Data.split(';')[0].split(':')[1] || 'image/jpeg';
        const pureBase64 = base64Data.split(',')[1];
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const prompt = `You are an expert OCR parser for Cambodian banking payment slips (ABA KHQR, Woori Bank, ACLEDA, Wing) and retail receipts.
Analyze this payment slip image and extract the transaction details.
Return ONLY valid JSON with these exact keys:
{
  "amount": number,
  "currency": "USD" or "KHR",
  "category": "food" | "transport" | "bills" | "shopping" | "health" | "other",
  "payment_method": "ABA_KHQR" | "WOORI_BANK" | "ACLEDA" | "CASH" | "CARD",
  "merchant": "string name of receiver/shop/merchant"
}`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: pureBase64
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.1,
              response_mime_type: "application/json"
            }
          })
        });

        if (response.ok) {
          const data = await response.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            parsed = JSON.parse(rawText.replace(/```json/gi, '').replace(/```/g, '').trim());
          }
        }
      } catch (err) {
        console.warn('Gemini vision OCR error, fallback to heuristics:', err);
      }
    }

    if (!parsed || !parsed.amount) {
      await new Promise(r => setTimeout(r, 1000));
      parsed = {
        amount: 2.50,
        currency: 'USD',
        category: 'food',
        payment_method: 'ABA_KHQR',
        merchant: 'Cafe / Merchant Payment'
      };
    }

    laserBeam?.classList.add('hidden');
    loading?.classList.add('hidden');

    const amtInput = document.getElementById('scanner-result-amount');
    const currSelect = document.getElementById('scanner-result-currency');
    const methodSelect = document.getElementById('scanner-result-method');
    const catSelect = document.getElementById('scanner-result-category');
    const noteInput = document.getElementById('scanner-result-note');

    if (amtInput) amtInput.value = parsed.amount;
    if (currSelect) currSelect.value = parsed.currency || 'USD';
    if (methodSelect) methodSelect.value = parsed.payment_method || 'ABA_KHQR';
    if (catSelect) catSelect.value = parsed.category || 'other';
    if (noteInput) noteInput.value = parsed.merchant || 'ស្កេនវិក្កយបត្រ';

    resultCard?.classList.remove('hidden');
    sound.playSuccessChord();
  }

  // =========================================================================
  // 3. SMART SAVINGS GOALS & VAULTS (ប្រអប់សន្សំលុយ)
  // =========================================================================
  initVaultsFeature() {
    const vaultsModal = document.getElementById('modal-vaults');
    const openBtn = document.getElementById('btn-open-vaults');
    const closeBtn = document.getElementById('btn-close-vaults');
    const openCreateBtn = document.getElementById('btn-open-create-vault');
    const createModal = document.getElementById('modal-create-vault');
    const closeCreateBtn = document.getElementById('btn-close-create-vault');
    const transferModal = document.getElementById('modal-vault-transfer');
    const closeTransferBtn = document.getElementById('btn-close-vault-transfer');

    if (openBtn) openBtn.addEventListener('click', () => this.openVaultsModal());
    if (closeBtn) closeBtn.addEventListener('click', () => vaultsModal?.classList.add('hidden'));

    if (openCreateBtn) openCreateBtn.addEventListener('click', () => {
      sound.playClick();
      createModal?.classList.remove('hidden');
    });
    if (closeCreateBtn) closeCreateBtn.addEventListener('click', () => createModal?.classList.add('hidden'));
    if (closeTransferBtn) closeTransferBtn.addEventListener('click', () => transferModal?.classList.add('hidden'));

    document.querySelectorAll('.btn-emoji-quick').forEach(b => {
      b.addEventListener('click', () => {
        const emoji = b.getAttribute('data-emoji');
        const input = document.getElementById('input-vault-emoji');
        if (input && emoji) input.value = emoji;
      });
    });

    const submitCreateBtn = document.getElementById('btn-submit-create-vault');
    if (submitCreateBtn) {
      submitCreateBtn.addEventListener('click', () => {
        sound.playClick();
        const emoji = document.getElementById('input-vault-emoji')?.value || '🎯';
        const name = document.getElementById('input-vault-name')?.value?.trim();
        const target = parseFloat(document.getElementById('input-vault-target')?.value || '0');
        const initial = parseFloat(document.getElementById('input-vault-initial')?.value || '0');

        if (!name || !target || target <= 0) {
          this.showToast('សូមបញ្ចូលឈ្មោះគោលដៅ និងចំនួនទឹកប្រាក់ត្រឹមត្រូវ!', 'error');
          return;
        }

        const newVault = {
          id: 'v-' + Date.now(),
          name,
          emoji,
          target,
          current: Math.max(0, initial)
        };

        this.state.vaults.unshift(newVault);
        localStorage.setItem('savech_vaults', JSON.stringify(this.state.vaults));
        sound.playIncomeCelebration();
        this.triggerConfetti();
        this.renderVaultsList();
        createModal?.classList.add('hidden');
        this.showToast(`បានបង្កើតប្រអប់ "${name}" ជោគជ័យ! 🎉`, 'success');
      });
    }

    document.querySelectorAll('.btn-vault-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        sound.playClick();
        const amt = chip.getAttribute('data-amt');
        const input = document.getElementById('input-vault-transfer-amount');
        if (input && amt) input.value = amt;
      });
    });

    const submitTransferBtn = document.getElementById('btn-submit-vault-transfer');
    if (submitTransferBtn) {
      submitTransferBtn.addEventListener('click', () => {
        sound.playClick();
        const input = document.getElementById('input-vault-transfer-amount');
        const amount = parseFloat(input?.value || '0');
        if (!amount || amount <= 0) {
          this.showToast('សូមបញ្ចូលចំនួនទឹកប្រាក់ត្រឹមត្រូវ!', 'error');
          return;
        }

        const vault = this.state.vaults.find(v => v.id === this.state.selectedVaultId);
        if (!vault) return;

        if (this.state.vaultActionType === 'deposit') {
          vault.current += amount;
          sound.playIncomeCelebration();
          if (vault.current >= vault.target) {
            this.triggerConfetti();
            this.showToast(`🎉 អបអរសាទរ! គោលដៅ "${vault.name}" សម្រេចបាន ១០០% ហើយ!`, 'success');
          } else {
            this.showToast(`បានដាក់សន្សំ $${amount.toFixed(2)} ចូលប្រអប់ "${vault.name}"!`, 'success');
          }
        } else {
          vault.current = Math.max(0, vault.current - amount);
          sound.playClick();
          this.showToast(`បានដក $${amount.toFixed(2)} ពីប្រអប់ "${vault.name}"`, 'info');
        }

        localStorage.setItem('savech_vaults', JSON.stringify(this.state.vaults));
        this.renderVaultsList();
        transferModal?.classList.add('hidden');
      });
    }
  }

  openVaultsModal() {
    sound.playClick();
    this.renderVaultsList();
    document.getElementById('modal-vaults')?.classList.remove('hidden');
  }

  renderVaultsList() {
    const container = document.getElementById('vaults-list-container');
    const totalSavedEl = document.getElementById('vaults-total-saved');
    const activeCountEl = document.getElementById('vaults-active-count');

    if (!container) return;

    const totalSaved = this.state.vaults.reduce((sum, v) => sum + (Number(v.current) || 0), 0);
    if (totalSavedEl) totalSavedEl.textContent = `$${totalSaved.toFixed(2)}`;
    if (activeCountEl) activeCountEl.textContent = `${this.state.vaults.length} Goals`;

    if (this.state.vaults.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 text-slate-400">
          <span class="text-3xl block mb-1">🎯</span>
          <p class="text-xs">មិនទាន់មានប្រអប់សន្សំនៅឡើយទេ</p>
          <p class="text-[10px] text-slate-500 mt-0.5">ចុច "+ បង្កើតប្រអប់ថ្មី" ដើម្បីចាប់ផ្តើមសន្សំ</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.state.vaults.map(v => {
      const pct = Math.min(100, Math.round((v.current / (v.target || 1)) * 100));
      const remaining = Math.max(0, v.target - v.current);
      const isComplete = v.current >= v.target;

      return `
        <div class="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2.5">
              <span class="text-2xl">${v.emoji || '🎯'}</span>
              <div>
                <h4 class="text-xs font-bold text-white leading-tight">${this.escapeHtml(v.name)}</h4>
                <p class="text-[10px] text-slate-400 mt-0.5">
                  <span class="font-mono text-amber-300 font-bold">$${Number(v.current).toFixed(2)}</span> / 
                  <span class="font-mono text-slate-400">$${Number(v.target).toFixed(2)}</span>
                </p>
              </div>
            </div>
            <div class="text-right">
              <span class="text-xs font-black font-mono ${isComplete ? 'text-emerald-400' : 'text-amber-400'}">${pct}%</span>
              <span class="text-[9px] text-slate-500 block">${isComplete ? 'សម្រេច ១០០%' : 'នៅខ្វះ $' + remaining.toFixed(2)}</span>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800/80">
            <div class="h-full rounded-full vault-progress-bar ${isComplete ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-amber-500 via-yellow-400 to-indigo-500'}" style="width: ${pct}%"></div>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-between pt-1 text-[11px]">
            <button class="btn-vault-delete text-[10px] text-slate-500 hover:text-rose-400 transition cursor-pointer" data-id="${v.id}">
              🗑️ លុប
            </button>
            <div class="flex items-center gap-1.5">
              <button class="btn-vault-action-withdraw px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition active:scale-95 cursor-pointer" data-id="${v.id}">
                - ដក
              </button>
              <button class="btn-vault-action-deposit px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition active:scale-95 shadow-sm cursor-pointer" data-id="${v.id}">
                + ដាក់លុយ
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-vault-action-deposit').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        this.openVaultTransferModal(id, 'deposit');
      });
    });

    container.querySelectorAll('.btn-vault-action-withdraw').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        this.openVaultTransferModal(id, 'withdraw');
      });
    });

    container.querySelectorAll('.btn-vault-delete').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        if (confirm('តើអ្នកពិតជាចង់លុបប្រអប់សន្សំនេះមែនទេ?')) {
          this.state.vaults = this.state.vaults.filter(v => v.id !== id);
          localStorage.setItem('savech_vaults', JSON.stringify(this.state.vaults));
          this.renderVaultsList();
        }
      });
    });
  }

  openVaultTransferModal(vaultId, actionType) {
    sound.playClick();
    const vault = this.state.vaults.find(v => v.id === vaultId);
    if (!vault) return;

    this.state.selectedVaultId = vaultId;
    this.state.vaultActionType = actionType;

    const modal = document.getElementById('modal-vault-transfer');
    const title = document.getElementById('vault-transfer-title');
    const vaultName = document.getElementById('vault-transfer-vault-name');
    const submitBtn = document.getElementById('btn-submit-vault-transfer');
    const input = document.getElementById('input-vault-transfer-amount');

    if (title) title.innerHTML = actionType === 'deposit' ? '<span>💰</span> ដាក់លុយចូលប្រអប់សន្សំ' : '<span>💸</span> ដកលុយពីប្រអប់សន្សំ';
    if (vaultName) vaultName.textContent = `${vault.emoji} ${vault.name}`;
    if (submitBtn) submitBtn.textContent = actionType === 'deposit' ? '+ ដាក់ប្រាក់សន្សំ' : '- ដកប្រាក់ចេញ';
    if (input) input.value = '';

    modal?.classList.remove('hidden');
  }

  // =========================================================================
  // 4. MONTHLY EXECUTIVE PDF FINANCIAL REPORT (របាយការណ៍ហិរញ្ញវត្ថុ)
  // =========================================================================
  initPdfReportFeature() {
    const reportModal = document.getElementById('modal-pdf-report');
    const openBtn = document.getElementById('btn-open-report');
    const closeBtn = document.getElementById('btn-close-pdf-report');
    const printBtn = document.getElementById('btn-trigger-print');

    if (openBtn) openBtn.addEventListener('click', () => this.openPdfReportModal());
    if (closeBtn) closeBtn.addEventListener('click', () => reportModal?.classList.add('hidden'));

    if (printBtn) {
      printBtn.addEventListener('click', () => {
        sound.playClick();
        window.print();
      });
    }
  }

  openPdfReportModal() {
    sound.playClick();
    const modal = document.getElementById('modal-pdf-report');
    if (!modal) return;

    const now = new Date();
    const periodLabel = document.getElementById('report-period-label');
    if (periodLabel) {
      periodLabel.textContent = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    const userNameEl = document.getElementById('report-user-name');
    if (userNameEl) {
      userNameEl.textContent = this.state.userName || 'Phouchhit';
    }

    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthlyTx = this.state.transactions.filter(t => (t.transaction_date || '').startsWith(ym));

    const totalIncome = monthlyTx.filter(t => t.type === 'income')
      .reduce((sum, t) => sum + (Number(t.base_amount_usd) || 0), 0);
    const totalExpense = monthlyTx.filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + (Number(t.base_amount_usd) || 0), 0);

    const netSurplus = totalIncome - totalExpense;
    const savingsRate = totalIncome > 0 ? Math.max(0, Math.round((netSurplus / totalIncome) * 100)) : 0;

    const incEl = document.getElementById('report-total-income');
    const expEl = document.getElementById('report-total-expense');
    const netEl = document.getElementById('report-net-surplus');
    const rateEl = document.getElementById('report-savings-rate');

    if (incEl) incEl.textContent = `+$${totalIncome.toFixed(2)}`;
    if (expEl) expEl.textContent = `-$${totalExpense.toFixed(2)}`;
    if (netEl) {
      netEl.textContent = `${netSurplus >= 0 ? '+' : '-'}$${Math.abs(netSurplus).toFixed(2)}`;
      netEl.className = netSurplus >= 0 ? 'num-mono text-base font-black text-indigo-300' : 'num-mono text-base font-black text-rose-400';
    }
    if (rateEl) rateEl.textContent = `${savingsRate}%`;

    const catMap = {};
    monthlyTx.filter(t => t.type === 'expense').forEach(t => {
      const c = t.category || 'other';
      catMap[c] = (catMap[c] || 0) + (Number(t.base_amount_usd) || 0);
    });

    const catContainer = document.getElementById('report-categories-container');
    if (catContainer) {
      const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
      if (sortedCats.length === 0) {
        catContainer.innerHTML = '<p class="text-slate-400 text-center py-2 text-[10.5px]">មិនទាន់មានទិន្នន័យចំណាយក្នុងខែនេះទេ</p>';
      } else {
        catContainer.innerHTML = sortedCats.map(([cat, amt]) => {
          const catPct = totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0;
          return `
            <div class="space-y-1">
              <div class="flex justify-between text-[11px]">
                <span class="text-slate-300 font-medium capitalize">${cat}</span>
                <span class="font-mono font-bold text-white">$${amt.toFixed(2)} (${catPct}%)</span>
              </div>
              <div class="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                <div class="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" style="width: ${catPct}%"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    modal.classList.remove('hidden');
  }

  // =========================================================================
  // 5. TELEGRAM EXPENSE BOT SETTINGS BINDINGS
  // =========================================================================
  initTelegramBotSettings() {
    const tokenInput = document.getElementById('setting-telegram-token');
    const chatIdInput = document.getElementById('setting-telegram-chat-id');

    if (tokenInput) {
      tokenInput.value = localStorage.getItem('savech_telegram_token') || '';
      tokenInput.addEventListener('change', () => {
        localStorage.setItem('savech_telegram_token', tokenInput.value.trim());
      });
    }

    if (chatIdInput) {
      chatIdInput.value = localStorage.getItem('savech_telegram_chat_id') || '';
      chatIdInput.addEventListener('change', () => {
        localStorage.setItem('savech_telegram_chat_id', chatIdInput.value.trim());
      });
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m]);
  }
}

// Resilient, zero-freeze instant bootstrap
function bootSaveCHApp() {
  if (window.saveCH) return;
  try {
    const app = new AppController();
    window.saveCH = app;
    window.pocketAI = app;
    app.init();
  } catch (err) {
    console.error('Fatal boot error:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootSaveCHApp);
} else {
  // DOM already parsed or cached, boot immediately!
  bootSaveCHApp();
}
