/**
 * Expense Middleware Pipeline (The Brain Layer)
 * 6-Stage Operational Pipeline:
 *  1. Khmer & Colloquial Normalizer (Digits, verbal numbers, units)
 *  2. Multi-Engine Intent Parser (Local regex + Gemini AI Fallback)
 *  3. FX Engine & Dual-Currency Normalizer
 *  4. Schema Validator & Error Boundary
 *  5. Local-First Offline Queue (IndexedDB/LocalStorage)
 *  6. Standard Payload Dispatcher
 */

export class ExpenseMiddlewarePipeline {
  constructor(options = {}) {
    this.exchangeRate = options.exchangeRate || 4100;
    this.geminiApiKey = options.geminiApiKey || '';
    this.geminiModel = options.geminiModel || 'gemini-2.5-flash';
    this.onPromptManualAmount = options.onPromptManualAmount || null;
    this.onValidationError = options.onValidationError || null;
  }

  setExchangeRate(rate) {
    if (rate && !isNaN(rate) && rate > 0) {
      this.exchangeRate = Number(rate);
    }
  }

  setGeminiApiKey(key) {
    this.geminiApiKey = (key || '').trim();
  }

  // =========================================================================
  // STAGE 1: KHMER & COLLOQUIAL NORMALIZER
  // =========================================================================
  stage1NormalizeKhmer(text) {
    if (!text || typeof text !== 'string') return '';
    let normalized = text.trim();

    // 1. Convert Khmer numerals ០-៩ to standard Arabic numerals 0-9
    const khmerDigits = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩'];
    khmerDigits.forEach((digit, i) => {
      normalized = normalized.replaceAll(digit, String(i));
    });

    // 2. Map Khmer spoken numbers to Arabic numbers where isolated or paired
    const khmerWordNums = [
      { word: 'ដប់', val: 10 },
      { word: 'ប្រាំបួន', val: 9 },
      { word: 'ប្រាំបី', val: 8 },
      { word: 'ប្រាំពីរ', val: 7 },
      { word: 'ប្រាំមួយ', val: 6 },
      { word: 'ប្រាំ', val: 5 },
      { word: 'បួន', val: 4 },
      { word: 'បី', val: 3 },
      { word: 'ពីរ', val: 2 },
      { word: 'មួយ', val: 1 },
      { word: 'សូន្យ', val: 0 }
    ];

    khmerWordNums.forEach(({ word, val }) => {
      // Replace only when space or boundary adjacent
      const reg = new RegExp(`(^|\\s)${word}(\\s|$)`, 'g');
      normalized = normalized.replace(reg, `$1${val}$2`);
    });

    // 3. Cambodian verbal multiplier structures:
    // "ម៉ឺន" (ten-thousand) -> x 10,000
    // "ពាន់" (thousand) -> x 1,000
    // "រយ" (hundred) -> x 100
    // "កន្លះ" (half) -> +0.5 (or x 1.5 if combined)

    // Handle combinations like "២ ម៉ឺន ៥ ពាន់" -> 25000
    // First, let's normalize patterns like: (\d+)\s*ម៉ឺន\s*(\d+)\s*ពាន់
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ម៉ឺន\s*(\d+(\.\d+)?)\s*ពាន់/g, (match, m1, _, m2) => {
      const total = Number(m1) * 10000 + Number(m2) * 1000;
      return `${total} ៛`;
    });

    // (\d+)\s*ពាន់\s*(\d+)\s*រយ
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ពាន់\s*(\d+(\.\d+)?)\s*រយ/g, (match, p1, _, r1) => {
      const total = Number(p1) * 1000 + Number(r1) * 100;
      return `${total} ៛`;
    });

    // Single multiplier with half "កន្លះ" (e.g. "២ ម៉ឺន កន្លះ" -> 25,000)
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ម៉ឺន\s*កន្លះ/g, (match, n) => {
      return `${Number(n) * 10000 + 5000} ៛`;
    });

    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ពាន់\s*កន្លះ/g, (match, n) => {
      return `${Number(n) * 1000 + 500} ៛`;
    });

    // "២ ដុល្លារកន្លះ" or "2 ដុល្លារ កន្លះ" or "2 dollar kanlah" -> 2.5 $
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*(?:ដុល្លារ|dollars?|\$)\s*កន្លះ/gi, (match, n) => {
      return `${Number(n) + 0.5} $`;
    });

    // Generic "X កន្លះ" -> X.5
    normalized = normalized.replace(/(\d+)\s*កន្លះ/g, (match, n) => {
      return `${Number(n) + 0.5}`;
    });

    // Standalone multipliers (with optional trailing រៀល / riel):
    // (\d+)\s*ម៉ឺន
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ម៉ឺន\s*(?:រៀល|riel|៛)?/gi, (match, n) => {
      return `${Number(n) * 10000} ៛`;
    });

    // (\d+)\s*ពាន់
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ពាន់\s*(?:រៀល|riel|៛)?/gi, (match, n) => {
      return `${Number(n) * 1000} ៛`;
    });

    // (\d+)\s*រយ
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*រយ\s*(?:រៀល|riel|៛)?/gi, (match, n) => {
      return `${Number(n) * 100} ៛`;
    });

    return normalized.trim();
  }

  // =========================================================================
  // STAGE 2: INTENT & ENTITY PARSING (HYBRID STRATEGY)
  // =========================================================================
  async stage2ParseIntent(rawTranscript, normalizedText) {
    // Check if multi-item or complex utterance
    const isMultiItem = this.detectMultiItem(normalizedText);

    // Run Local Heuristics
    const localResult = this.parseLocalHeuristics(normalizedText, rawTranscript);

    // If local confidence is high (>= 0.7) and not multi-item, use local result
    if (localResult.confidence >= 0.7 && !isMultiItem) {
      return [localResult.payload];
    }

    // If Gemini API is available and confidence is low or multi-item, use AI fallback
    if (this.geminiApiKey) {
      try {
        const aiResults = await this.parseWithGemini(rawTranscript, normalizedText);
        if (aiResults && aiResults.length > 0) {
          return aiResults;
        }
      } catch (err) {
        console.warn('Gemini fallback error, falling back to local heuristic:', err);
      }
    }

    // Fallback to local heuristic result (single item)
    return [localResult.payload];
  }

  detectMultiItem(text) {
    const multiItemIndicators = [
      /\band\b/i,
      /\bthen\b/i,
      /\bplus\b/i,
      /\balso\b/i,
      /ហើយ/i,
      /និង/i,
      /រួច/i,
      /បូក/i
    ];
    // Check if contains indicator and has multiple number occurrences
    const hasIndicator = multiItemIndicators.some((regex) => regex.test(text));
    const numberMatches = text.match(/\d+(\.\d+)?/g);
    return hasIndicator && numberMatches && numberMatches.length > 1;
  }

  parseLocalHeuristics(text, rawTranscript) {
    const lower = text.toLowerCase();
    let confidence = 0.1;

    // 1. Type Classifier
    let type = 'expense';
    const incomeKeywords = [
      'received', 'earned', 'salary', 'income', 'freelance', 'bonus', 'wage',
      'sold', 'refund', 'paid me', 'got', 'deposit',
      'បានលុយ', 'ចំណូល', 'ប្រាក់ខែ', 'រកបាន', 'ផ្ញើមក', 'ទទួល', 'លក់បាន'
    ];
    if (incomeKeywords.some((kw) => lower.includes(kw))) {
      type = 'income';
      confidence += 0.2;
    }

    // 2. Amount & Currency Detection
    let amount = null;
    let currency = 'USD';

    // Patterns for amount & currency:
    // a. "$4.5", "$ 4.5", "៛ 6000", "៛6000"
    const prefixCurrMatch = text.match(/([\$៛])\s*(\d+(?:\.\d+)?)/);
    // b. "4.5$", "4.5 dollars", "2.5 bucks", "6000 riel", "10000 ៛", "20000 រៀល", "2 ដុល្លារ"
    const postfixCurrMatch = text.match(/(\d+(?:\.\d+)?)\s*(\$|dollars?|bucks?|riel|៛|រៀល|ដុល្លារ)/i);
    // c. Pure numbers like "coffee 2.5", "lunch 4000"
    const pureNumMatch = text.match(/(\d+(?:\.\d+)?)/);

    if (prefixCurrMatch) {
      currency = prefixCurrMatch[1] === '៛' ? 'KHR' : 'USD';
      amount = parseFloat(prefixCurrMatch[2]);
      confidence += 0.45;
    } else if (postfixCurrMatch) {
      const symbol = postfixCurrMatch[2].toLowerCase();
      if (['riel', '៛', 'រៀល'].includes(symbol)) {
        currency = 'KHR';
      } else {
        currency = 'USD';
      }
      amount = parseFloat(postfixCurrMatch[1]);
      confidence += 0.45;
    } else if (pureNumMatch) {
      amount = parseFloat(pureNumMatch[1]);
      // Heuristic: In Cambodia, transactions >= 500 without explicit '$' are usually KHR (Riel)
      if (amount >= 500) {
        currency = 'KHR';
      } else {
        currency = 'USD';
      }
      confidence += 0.25;
    } else {
      // Smart shortcut defaults if spoken without numeric amount:
      if (/ប្រាក់ខែ\s*fix|salary\s*fix/i.test(text)) {
        amount = 739.34;
        currency = 'USD';
        type = 'income';
        confidence += 0.55;
      } else if (/កន្លែង\s*(?:ទី)?២|second\s*job/i.test(text)) {
        amount = 220.00;
        currency = 'USD';
        type = 'income';
        confidence += 0.45;
      } else if (/បង់(?:ថ្លៃ)?ឡាន|car\s*(?:loan|payment)/i.test(text)) {
        amount = 232.54;
        currency = 'USD';
        type = 'expense';
        confidence += 0.55;
      } else if (/បង់(?:ថ្លៃ)?ផ្ទះ|house\s*(?:loan|payment|rent)/i.test(text)) {
        amount = 185.00;
        currency = 'USD';
        type = 'expense';
        confidence += 0.55;
      }
    }

    // 3. Category Matcher
    const categories = {
      food: [
        'coffee', 'cafe', 'lunch', 'dinner', 'breakfast', 'noodle', 'food',
        'drink', 'eat', 'snack', 'tea', 'starbucks', 'brown', 'burger', 'pizza',
        'rice', 'beer', 'boba', 'amazon',
        'អាហារ', 'បាយ', 'គុយទាវ', 'ញ៉ាំ', 'ផឹក', 'កាហ្វេ', 'ទឹកដោះគោ', 'នំប៉័ង'
      ],
      transport: [
        'passapp', 'grab', 'taxi', 'gas', 'fuel', 'petrol', 'bus', 'tuktuk',
        'remork', 'parking', 'toll', 'trip',
        'សាំង', 'ម៉ូតូ', 'ធ្វើដំណើរ', 'ឡាន', 'ចាក់សាំង', 'កង់បី'
      ],
      bills: [
        'rent', 'wifi', 'electric', 'electricity', 'water', 'utility', 'phone',
        'internet', 'edc', 'ppwsas', 'bill', 'cellcard', 'smart', 'metfone',
        'ថ្លៃផ្ទះ', 'ទឹកភ្លើង', 'បង់ថ្លៃ', 'ទូរស័ព្ទ', 'អ៊ីនធឺណិត', 'ថ្លៃទឹក'
      ],
      entertainment: [
        'movie', 'cinema', 'game', 'snooker', 'football', 'concert', 'netflix',
        'steam', 'pub', 'club', 'party', 'gym',
        'ដើរលេង', 'កម្សាន្ត', 'មើលកុន', 'កុន', 'បាល់'
      ],
      shopping: [
        'mart', 'buy', 'clothes', 'shopee', 'taobao', 'aeon', '7-eleven', 'market',
        'supermarket', 'shoes', 'gadget', 'amazon',
        'ទិញ', 'ខោអាវ', 'ផ្សារ', 'សម្ភារៈ'
      ],
      health: [
        'medicine', 'doctor', 'pharmacy', 'clinic', 'hospital', 'pill', 'dental',
        'ថ្នាំ', 'ពេទ្យ', 'ព្យាបាល', 'ធ្មេញ'
      ]
    };

    let matchedCategory = type === 'income' ? 'income' : 'other';
    for (const [cat, words] of Object.entries(categories)) {
      if (words.some((w) => lower.includes(w))) {
        matchedCategory = cat;
        confidence += 0.25;
        break;
      }
    }

    // 4. Payment Method Detector
    // Default fallback is ABA_KHQR (or ACLEDA for car payments)
    let paymentMethod = /បង់(?:ថ្លៃ)?ឡាន|car\s*(?:loan|payment)/i.test(text) ? 'ACLEDA' : 'ABA_KHQR';
    const paymentMatchers = {
      WOORI_BANK: ['woori', 'worrie', 'wori', 'អ៊ូរី', 'វូរី'],
      ACLEDA: ['acleda', 'aclida', 'អេស៊ីលីដា', 'អេស៊ី'],
      ABA_KHQR: ['aba', 'aba_khqr'],
      CASH: ['cash', 'hand', 'pocket', 'physical', 'លុយសុទ្ធ', 'សាច់ប្រាក់'],
      CARD: ['card', 'visa', 'mastercard', 'master', 'credit', 'debit', 'កាត']
    };

    let matchedPayment = false;
    for (const [method, words] of Object.entries(paymentMatchers)) {
      if (words.some((w) => lower.includes(w))) {
        paymentMethod = method;
        matchedPayment = true;
        confidence += 0.2;
        break;
      }
    }
    if (!matchedPayment) {
      if (/បង់(?:ថ្លៃ)?ឡាន|car\s*(?:loan|payment)/i.test(text)) {
        paymentMethod = 'ACLEDA';
      } else {
        paymentMethod = 'ABA_KHQR';
      }
    }

    // 5. Build clean note
    let cleanNote = rawTranscript.trim();
    if (cleanNote.length > 60) {
      cleanNote = cleanNote.slice(0, 60) + '...';
    }

    return {
      confidence: Math.min(confidence, 1.0),
      payload: {
        type,
        amount: isNaN(amount) ? null : amount,
        currency,
        category: matchedCategory,
        payment_method: paymentMethod,
        note: cleanNote || (type === 'income' ? 'Income' : 'Expense'),
        raw_transcript: rawTranscript
      }
    };
  }

  // =========================================================================
  // GEMINI AI INTEGRATION (Structured Output)
  // =========================================================================
  async parseWithGemini(rawTranscript, normalizedText) {
    if (!this.geminiApiKey) return null;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;

    const systemPrompt = `You are an expert bilingual (Khmer & English) financial transaction parser for a personal expense tracker app used in Cambodia.
The user primarily pays via Woori Bank (WOORI_BANK) for daily expenses, and ACLEDA Bank (ACLEDA) for car payments ($232.54).
Parse the user's transcript into a strict JSON array of transaction objects.
Each object must have:
- "type": "expense" or "income" (default "expense")
- "amount": positive number
- "currency": "USD" or "KHR" (Cambodian Riel). If spoken in Riel, ៛, or large numbers like 5000, 10000, use "KHR". Otherwise default "USD".
- "category": one of ["food", "transport", "bills", "entertainment", "shopping", "health", "income", "other"]
- "payment_method": one of ["WOORI_BANK", "ACLEDA", "ABA_KHQR", "CASH", "CARD", "OTHER"]. Default is "WOORI_BANK" (or "ACLEDA" if car payment/ACLEDA is mentioned).
- "note": concise description of the item in English or Khmer.

If the user mentions multiple items (e.g. "Spent 4$ for lunch and 2$ for iced latte"), return multiple JSON objects in the array.
Respond ONLY with a valid JSON array. Do not include markdown formatting, backticks, or any explanation.`;

    const userPrompt = `Transcript: "${rawTranscript}"\nNormalized: "${normalizedText}"`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: systemPrompt },
              { text: userPrompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1000
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) return null;

    // Clean any accidental markdown code blocks
    let cleanJson = candidateText.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    const parsedArray = JSON.parse(cleanJson);
    if (!Array.isArray(parsedArray)) {
      return [parsedArray];
    }

    return parsedArray.map((item) => ({
      ...item,
      amount: parseFloat(item.amount),
      raw_transcript: rawTranscript
    }));
  }

  // =========================================================================
  // STAGE 3: FX ENGINE & DUAL-CURRENCY NORMALIZER
  // =========================================================================
  stage3NormalizeFX(transaction) {
    const amount = Number(transaction.amount);
    const currency = (transaction.currency || 'USD').toUpperCase();
    const rate = this.exchangeRate || 4100;

    let baseAmountUsd = 0;
    if (currency === 'KHR') {
      baseAmountUsd = Number((amount / rate).toFixed(2));
    } else {
      baseAmountUsd = Number(amount.toFixed(2));
    }

    return {
      ...transaction,
      amount: Number(amount.toFixed(2)),
      currency: currency === 'KHR' ? 'KHR' : 'USD',
      base_amount_usd: baseAmountUsd,
      exchange_rate_used: rate
    };
  }

  // =========================================================================
  // STAGE 4: SCHEMA VALIDATOR & ERROR BOUNDARY
  // =========================================================================
  stage4Validate(transaction) {
    // Check if amount is missing or invalid
    if (
      transaction.amount === null ||
      transaction.amount === undefined ||
      isNaN(transaction.amount) ||
      transaction.amount <= 0
    ) {
      if (typeof this.onPromptManualAmount === 'function') {
        this.onPromptManualAmount(transaction);
      }
      const err = new Error('VALIDATION_ERROR: Missing or invalid amount extracted.');
      err.code = 'VALIDATION_ERROR';
      err.partialTransaction = transaction;
      throw err;
    }

    // Ensure valid payment method (matches Postgres schema check constraint)
    const validMethods = ['ABA_KHQR', 'WOORI_BANK', 'ACLEDA', 'CASH', 'CARD'];
    if (!validMethods.includes(transaction.payment_method)) {
      transaction.payment_method = 'ABA_KHQR';
    }

    // Ensure valid type
    if (!['expense', 'income'].includes(transaction.type)) {
      transaction.type = 'expense';
    }

    // Ensure category string
    if (!transaction.category) {
      transaction.category = transaction.type === 'income' ? 'income' : 'other';
    }

    return transaction;
  }

  // =========================================================================
  // STAGE 5 & 6: DISPATCHER & OFFLINE QUEUE PREPARATION
  // =========================================================================
  stage6DispatchPayload(validTransaction) {
    return {
      id: validTransaction.id || this.generateUuid(),
      user_id: validTransaction.user_id || 'local-user',
      type: validTransaction.type,
      amount: validTransaction.amount,
      currency: validTransaction.currency,
      base_amount_usd: validTransaction.base_amount_usd,
      exchange_rate_used: validTransaction.exchange_rate_used,
      category: validTransaction.category,
      payment_method: validTransaction.payment_method,
      note: validTransaction.note || '',
      raw_transcript: validTransaction.raw_transcript || '',
      sync_status: 'pending_sync',
      transaction_date: validTransaction.transaction_date || new Date().toISOString(),
      created_at: validTransaction.created_at || new Date().toISOString()
    };
  }

  // =========================================================================
  // MAIN EXECUTION PIPELINE ENTRY POINT
  // =========================================================================
  async process(rawTranscript, options = {}) {
    // 1. Stage 1: Khmer & Colloquial Normalizer
    const normalized = this.stage1NormalizeKhmer(rawTranscript);

    // 2. Stage 2: Intent & Entity Parsing (Hybrid)
    const rawEntities = await this.stage2ParseIntent(rawTranscript, normalized);

    // Process each entity (handles multi-item or single item)
    const results = [];
    for (const entity of rawEntities) {
      // Allow overriding fields if passed in options
      const merged = { ...entity, ...options };

      // 3. Stage 3: FX Normalization
      const fxNormalized = this.stage3NormalizeFX(merged);

      // 4. Stage 4: Validator
      const validated = this.stage4Validate(fxNormalized);

      // 5 & 6. Dispatcher Payload
      const finalPayload = this.stage6DispatchPayload(validated);
      results.push(finalPayload);
    }

    return results;
  }

  generateUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
