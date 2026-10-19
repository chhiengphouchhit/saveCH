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
  // STAGE 1: KHMER & COLLOQUIAL NORMALIZER (HUMAN-LEVEL INTELLIGENCE)
  // =========================================================================
  stage1NormalizeKhmer(text) {
    if (!text || typeof text !== 'string') return '';
    let normalized = text.trim();

    // 0. Phonetic & STT Typo Corrections (Human Speech Imperfection Tolerance)
    normalized = normalized.replace(/ការហ្វេ|កាហ្វេរ|ខាហ្វេ/gi, 'កាហ្វេ');
    normalized = normalized.replace(/ដុល្ល័រ/gi, 'ដុល្លារ');
    normalized = normalized.replace(/រៀលខ្មែរ/gi, 'រៀល');
    normalized = normalized.replace(/អាប៊ីអេ|អេប៊ីអេ/gi, 'ABA');
    normalized = normalized.replace(/អេស៊ីលីដា/gi, 'ACLEDA');
    normalized = normalized.replace(/វូរីប៊ែង/gi, 'Woori Bank');

    // 1. Convert Khmer numerals ០-៩ to standard Arabic numerals 0-9
    const khmerDigits = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩'];
    khmerDigits.forEach((digit, i) => {
      normalized = normalized.replaceAll(digit, String(i));
    });

    // 2. Map Khmer spoken numbers (tens and units) to Arabic numbers
    const khmerTens = [
      { word: 'កៅសិប', val: 90 },
      { word: 'ប៉ែតសិប', val: 80 },
      { word: 'ចិតសិប', val: 70 },
      { word: 'ហុកសិប', val: 60 },
      { word: 'ហាសិប', val: 50 },
      { word: 'សែសិប', val: 40 },
      { word: 'សាមសិប', val: 30 },
      { word: 'ម្ភៃ', val: 20 },
      { word: 'ដប់', val: 10 }
    ];

    const khmerDigitsWords = [
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

    // Compound numbers e.g. ដប់ប្រាំ (15), ម្ភៃប្រាំ (25), សាមសិបពីរ (32)
    khmerTens.forEach((t) => {
      khmerDigitsWords.forEach((d) => {
        normalized = normalized.replaceAll(t.word + d.word, String(t.val + d.val));
      });
      normalized = normalized.replaceAll(t.word, String(t.val));
    });

    khmerDigitsWords.forEach((d) => {
      normalized = normalized.replaceAll(d.word, String(d.val));
    });

    // 3. Human Self-Correction While Speaking (ដូចមនុស្សកែសំដី)
    // E.g. "កាហ្វេ ៣ ដុល្លារ អត់ទេ ២ ដុល្លារកន្លះ" -> catches the last correction
    normalized = normalized.replace(/(\d+(?:\.\d+)?)\s*(?:ដុល្លារ|ដុល្លា|លា|\$|រៀល|៛)?\s*(?:អត់ទេ|ច្រឡំ|មិនមែន|no wait|not)\s*(\d+(?:\.\d+)?)/gi, (m, oldVal, newVal) => newVal);

    // 4. Human Bill Split Math (ដូចមនុស្សគិតចែកលុយគ្នា)
    // E.g. "បាយ ២០ ដុល្លារ ចែកគ្នា ២ នាក់" -> $10.00
    normalized = normalized.replace(/(\d+(?:\.\d+)?)\s*(?:ដុល្លារ|ដុល្លា|លា|\$)?\s*(?:ចែកគ្នា|ចែក|split with|between)\s*(\d+)\s*(?:នាក់|people|person)?/gi, (m, total, people) => {
      const p = parseFloat(people) || 1;
      return `${(parseFloat(total) / p).toFixed(2)} $`;
    });
    // E.g. "បាយ ៤ ម៉ឺន ចែកគ្នា ៤ នាក់" -> 10000 ៛
    normalized = normalized.replace(/(\d+(?:\.\d+)?)\s*(?:រៀល|៛)?\s*(?:ចែកគ្នា|ចែក)\s*(\d+)\s*(?:នាក់)?/gi, (m, total, people) => {
      const p = parseFloat(people) || 1;
      return `${Math.round(parseFloat(total) / p)} ៛`;
    });

    // 5. Cambodian verbal multiplier & currency structures:
    // Combinations: "២ ម៉ឺន ៥ ពាន់" -> 25000 ៛
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ម៉ឺន\s*(\d+(\.\d+)?)\s*ពាន់/g, (match, m1, _, m2) => {
      const total = Number(m1) * 10000 + Number(m2) * 1000;
      return `${total} ៛`;
    });

    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ពាន់\s*(\d+(\.\d+)?)\s*រយ/g, (match, p1, _, r1) => {
      const total = Number(p1) * 1000 + Number(r1) * 100;
      return `${total} ៛`;
    });

    // Multipliers with half "កន្លះ" (e.g. "២ ម៉ឺន កន្លះ" -> 25,000 ៛)
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ម៉ឺន\s*កន្លះ/g, (match, n) => {
      return `${Number(n) * 10000 + 5000} ៛`;
    });

    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ពាន់\s*កន្លះ/g, (match, n) => {
      return `${Number(n) * 1000 + 500} ៛`;
    });

    // Dollars with half "កន្លះ": "៥លាកន្លះ", "២ ដុល្លារកន្លះ", "2 dollar kanlah" -> 5.5 $, 2.5 $
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*(?:ដុល្លារ|ដុល្លា|លា|dollars?|\$)\s*កន្លះ/gi, (match, n) => {
      return `${Number(n) + 0.5} $`;
    });

    // Generic "X កន្លះ" -> X.5
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*កន្លះ/g, (match, n) => {
      return `${Number(n) + 0.5}`;
    });

    // Cambodian colloquial currency: "លា", "ដុល្លា", "ដុល្លារ" -> $
    normalized = normalized.replace(/(\d+(?:\.\d+)?)\s*(?:ដុល្លារ|ដុល្លា|លា|dollars?)/gi, '$1 $');

    // Standalone multipliers:
    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ម៉ឺន\s*(?:រៀល|riel|៛)?/gi, (match, n) => {
      return `${Number(n) * 10000} ៛`;
    });

    normalized = normalized.replace(/(\d+(\.\d+)?)\s*ពាន់\s*(?:រៀល|riel|៛)?/gi, (match, n) => {
      return `${Number(n) * 1000} ៛`;
    });

    normalized = normalized.replace(/(\d+(\.\d+)?)\s*រយ\s*(?:រៀល|riel|៛)?/gi, (match, n) => {
      return `${Number(n) * 100} ៛`;
    });

    return normalized.trim();
  }

  // Relative Date & Time Recognizer (ដូចមនុស្សចាំពេលវេលា)
  extractRelativeDate(text) {
    const now = new Date();
    if (/ម្សិលមិញ|yesterday/i.test(text)) {
      return new Date(now.getTime() - 86400000).toISOString();
    }
    const daysAgo = text.match(/(\d+)\s*(?:ថ្ងៃមុន|days?\s*ago)/i);
    if (daysAgo) {
      return new Date(now.getTime() - 86400000 * parseInt(daysAgo[1])).toISOString();
    }
    if (/អាទិត្យមុន|សប្តាហ៍មុន|last\s*week/i.test(text)) {
      return new Date(now.getTime() - 86400000 * 7).toISOString();
    }
    return now.toISOString();
  }

  // =========================================================================
  // STAGE 2: INTENT & ENTITY PARSING (HYBRID STRATEGY)
  // =========================================================================
  async stage2ParseIntent(rawTranscript, normalizedText) {
    const isMultiItem = this.detectMultiItem(normalizedText);

    // If Gemini API is available and utterance is complex or multi-item, use AI
    if (this.geminiApiKey && isMultiItem) {
      try {
        const aiResults = await this.parseWithGemini(rawTranscript, normalizedText);
        if (aiResults && aiResults.length > 0) {
          return aiResults;
        }
      } catch (err) {
        console.warn('Gemini fallback error, falling back to local multi-item parser:', err);
      }
    }

    // Local Multi-Item Splitter (Super Smart Offline Split Engine)
    if (isMultiItem) {
      const subClauses = normalizedText.split(/(?:\s*(?:ហើយ|រួចហើយ|និង|រួច|បូក|then|and|\+)\s*)/i)
        .filter(p => p.trim().length > 0 && /\d/.test(p));

      if (subClauses.length > 1) {
        const results = [];
        for (const sub of subClauses) {
          const subRes = this.parseLocalHeuristics(sub, sub);
          if (subRes.payload && subRes.payload.amount) {
            results.push(subRes.payload);
          }
        }
        if (results.length > 0) {
          return results;
        }
      }
    }

    // Single item Local Heuristics
    const localResult = this.parseLocalHeuristics(normalizedText, rawTranscript);
    if (localResult.confidence >= 0.7) {
      return [localResult.payload];
    }

    // If confidence is low and Gemini is available, query Gemini
    if (this.geminiApiKey) {
      try {
        const aiResults = await this.parseWithGemini(rawTranscript, normalizedText);
        if (aiResults && aiResults.length > 0) {
          return aiResults;
        }
      } catch (err) {
        console.warn('Gemini error, fallback to local heuristic:', err);
      }
    }

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
    const hasIndicator = multiItemIndicators.some((regex) => regex.test(text));
    const numberMatches = text.match(/\d+(\.\d+)?/g);
    return hasIndicator && numberMatches && numberMatches.length > 1;
  }

  parseLocalHeuristics(text, rawTranscript) {
    const lower = text.toLowerCase();
    let confidence = 0.1;

    // 0. Extract Relative Date
    const transactionDate = this.extractRelativeDate(rawTranscript);

    // 1. Type Classifier (Broad Human Vocabulary)
    let type = 'expense';
    const incomeKeywords = [
      'received', 'earned', 'salary', 'income', 'freelance', 'bonus', 'wage',
      'sold', 'refund', 'paid me', 'got', 'deposit', 'tip', 'commission', 'interest',
      'បានលុយ', 'ចំណូល', 'ប្រាក់ខែ', 'រកបាន', 'ផ្ញើមក', 'ទទួល', 'លក់បាន',
      'ម៉ូយផ្ញើ', 'ម៉ូយវេរ', 'ភ្ញៀវបាញ់', 'គេសង', 'គេឱ្យ', 'លុយធីប',
      'កម្រៃជើងសារ', 'ភាគលាភ', 'ការប្រាក់', 'លុយចូល', 'បើកលុយ', 'បើកប្រាក់ខែ'
    ];
    if (incomeKeywords.some((kw) => lower.includes(kw))) {
      type = 'income';
      confidence += 0.3;
    }

    // 2. Amount & Currency Detection
    let amount = null;
    let currency = 'USD';

    const prefixCurrMatch = text.match(/([\$៛])\s*(\d+(?:\.\d+)?)/);
    const postfixCurrMatch = text.match(/(\d+(?:\.\d+)?)\s*(\$|dollars?|bucks?|riel|៛|រៀល|ដុល្លារ|ដុល្លា|លា)/i);
    const pureNumMatch = text.match(/(\d+(?:\.\d+)?)/);

    if (prefixCurrMatch) {
      currency = prefixCurrMatch[1] === '៛' ? 'KHR' : 'USD';
      amount = parseFloat(prefixCurrMatch[2]);
      confidence += 0.65;
    } else if (postfixCurrMatch) {
      const symbol = postfixCurrMatch[2].toLowerCase();
      if (['riel', '៛', 'រៀល'].includes(symbol)) {
        currency = 'KHR';
      } else {
        currency = 'USD';
      }
      amount = parseFloat(postfixCurrMatch[1]);
      confidence += 0.65;
    } else if (pureNumMatch) {
      amount = parseFloat(pureNumMatch[1]);
      if (amount >= 500) {
        currency = 'KHR';
      } else {
        currency = 'USD';
      }
      confidence += 0.40;
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

    // 3. Category Matcher (Human Everyday Vocabulary)
    const categories = {
      food: [
        'coffee', 'cafe', 'lunch', 'dinner', 'breakfast', 'noodle', 'food',
        'drink', 'eat', 'snack', 'tea', 'starbucks', 'brown', 'burger', 'pizza',
        'rice', 'beer', 'boba', 'amazon', 'bakery', 'bread', 'soup', 'sushi', 'kfc',
        'អាហារ', 'បាយ', 'គុយទាវ', 'ញ៉ាំ', 'ផឹក', 'កាហ្វេ', 'ទឹកដោះគោ', 'នំប៉័ង',
        'ភេសជ្ជៈ', 'សាច់', 'មាន់បំពង', 'ភីហ្សា', 'ស៊ុប', 'តែគុជ', 'ទឹកក្រឡុក',
        'ស្រាបៀរ', 'ហាងបាយ', 'ម្ហូប', 'នំ', 'មី', 'មីឆា', 'បាយឆា', 'អាហារថ្ងៃត្រង់',
        'អាហារពេលព្រឹក', 'អាហារពេលល្ងាច', 'ប្រហិត', 'ផ្លែឈើ', 'ភេសជ្ជះ'
      ],
      transport: [
        'passapp', 'grab', 'taxi', 'gas', 'fuel', 'petrol', 'bus', 'tuktuk',
        'remork', 'parking', 'toll', 'trip', 'wash', 'mechanic', 'tire', 'oil',
        'caltex', 'tela', 'total', 'ptt',
        'សាំង', 'ម៉ូតូ', 'ធ្វើដំណើរ', 'ឡាន', 'ចាក់សាំង', 'កង់បី', 'ថ្លៃផ្ញើ',
        'ផ្ញើម៉ូតូ', 'ផ្ញើឡាន', 'លាងឡាន', 'លាងម៉ូតូ', 'ប្តូរប្រេង', 'ប្រេងម៉ាស៊ីន',
        'ប៉ះកង់', 'បង់ថ្លៃផ្លូវ', 'ផ្លូវល្បឿនលឿន', 'កង់', 'តាក់ស៊ី', 'ឡានឈ្នួល'
      ],
      bills: [
        'rent', 'wifi', 'electric', 'electricity', 'water', 'utility', 'phone',
        'internet', 'edc', 'ppwsas', 'bill', 'cellcard', 'smart', 'metfone',
        'topup', 'data', 'sim', 'housing', 'loan',
        'ថ្លៃផ្ទះ', 'ទឹកភ្លើង', 'បង់ថ្លៃ', 'ទូរស័ព្ទ', 'អ៊ីនធឺណិត', 'ថ្លៃទឹក',
        'ថ្លៃភ្លើង', 'អគ្គិសនី', 'បញ្ចូលកាត', 'បញ្ចូលលុយ', 'កាតទូរស័ព្ទ', 'សេវា',
        'ថ្លៃបន្ទប់', 'ថ្លៃខុនដូ', 'បង់ធនាគារ', 'បង់រំលស់', 'បង់សាលា', 'ថ្លៃសាលា'
      ],
      entertainment: [
        'movie', 'cinema', 'game', 'snooker', 'football', 'concert', 'netflix',
        'steam', 'pub', 'club', 'party', 'gym', 'sport', 'bowling', 'legend', 'major',
        'ដើរលេង', 'កម្សាន្ត', 'មើលកុន', 'កុន', 'បាល់', 'ទាត់បាល់', 'វាយសី',
        'ហែលទឹក', 'ហាត់ប្រាណ', 'ក្លឹប', 'ផឹកស៊ី', 'ច្រៀង', 'ខារ៉ាអូខេ', 'លេងហ្គេម'
      ],
      shopping: [
        'mart', 'buy', 'clothes', 'shopee', 'taobao', 'aeon', '7-eleven', 'market',
        'supermarket', 'shoes', 'gadget', 'bag', 'cosmetic', 'makeup',
        'ទិញ', 'ខោអាវ', 'ផ្សារ', 'សម្ភារៈ', 'ស្បែកជើង', 'កាបូប', 'គ្រឿងសំអាង',
        'ឡេ', 'គ្រឿងទេស', 'អីវ៉ាន់', 'របស់របរ', 'ផ្សារទំនើប', 'ម៉ាត', 'កុម្ម៉ង់'
      ],
      health: [
        'medicine', 'doctor', 'pharmacy', 'clinic', 'hospital', 'pill', 'dental',
        'dentist', 'vitamin', 'haircut', 'salon', 'spa', 'massage',
        'ថ្នាំ', 'ពេទ្យ', 'ព្យាបាល', 'ធ្មេញ', 'ឈឺ', 'ពិនិត្យ', 'វីតាមីន',
        'ឱសថស្ថាន', 'កាត់សក់', 'ម៉ាស្សា', 'ស្ប៉ា', 'ធ្វើក្រចក', 'ធ្វើសក់'
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

    // 4. Payment Method Detector (Everyday Cambodian Banking Slang)
    let paymentMethod = /បង់(?:ថ្លៃ)?ឡាន|car\s*(?:loan|payment)/i.test(text) ? 'ACLEDA' : 'ABA_KHQR';
    const paymentMatchers = {
      WOORI_BANK: ['woori', 'worrie', 'wori', 'អ៊ូរី', 'វូរី', 'វូរីប៊ែង'],
      ACLEDA: ['acleda', 'aclida', 'អេស៊ីលីដា', 'អេស៊ី'],
      ABA_KHQR: ['aba', 'aba_khqr', 'ស្កេន', 'ស្គែន', 'បាញ់', 'វេរ', 'ផ្ទេរ', 'khqr'],
      WING: ['wing', 'វីង'],
      CASH: ['cash', 'hand', 'pocket', 'physical', 'លុយសុទ្ធ', 'សាច់ប្រាក់', 'លុយដៃ'],
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

    // 5. Build clean, human-like note
    let cleanNote = rawTranscript.trim();
    const isPureAmount = /^(?:[\$៛]?\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:\$|dollars?|bucks?|riel|៛|រៀល|ដុល្លារ|ដុល្លា|លា)?|[\u17E0-\u17E9]+(?:\s*(?:ដុល្លារ|ដុល្លា|លា|រៀល))?|(?:មួយ|ពីរ|បី|បួន|ប្រាំ|ប្រាំមួយ|ប្រាំពីរ|ប្រាំបី|ប្រាំបួន|ដប់|ម្ភៃ|សាមសិប|សែសិប|ហាសិប)+(?:\s*(?:ដុល្លារ|ដុល្លា|លា|រៀល|ពាន់|ម៉ឺន|កន្លះ))?)$/i.test(cleanNote);
    if (isPureAmount && matchedCategory === 'other') {
      cleanNote = `${cleanNote} (ទូទៅ)`;
    } else if (cleanNote.length > 60) {
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
        raw_transcript: rawTranscript,
        transaction_date: transactionDate
      }
    };
  }

  // =========================================================================
  // GEMINI AI INTEGRATION (ULTRA-DEEP HUMAN REASONING)
  // =========================================================================
  async parseWithGemini(rawTranscript, normalizedText) {
    if (!this.geminiApiKey) return null;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;

    const systemPrompt = `You are an elite bilingual (Khmer & English) financial transaction parser for a personal expense tracker app used in Cambodia.
Think and listen like a real human Cambodian cashier and personal financial assistant.

CORE UNDERSTANDINGS:
1. CAMBODIAN SLANG & IDIOMS:
   - "លា", "ដុល្លា", "ដុល្លារ", "bucks" = USD ($). E.g. "៥លា" = 5 USD, "១០លា" = 10 USD, "២លាកន្លះ" = 2.50 USD.
   - "រៀល", "៛", "ពាន់", "ម៉ឺន" = KHR (Cambodian Riel). E.g. "៦ ពាន់" = 6000 KHR, "២ ម៉ឺន" = 20000 KHR.
   - Bank slang: "បាញ់", "វេរ", "ស្កេន" = ABA_KHQR (or bank transfer). "អេស៊ី" = ACLEDA. "វូរី" = WOORI_BANK. "វីង" = WING. "លុយសុទ្ធ" = CASH.
   - Relative dates: "ម្សិលមិញ" = yesterday, "២ ថ្ងៃមុន" = 2 days ago.

2. MATH & HUMAN MENTAL CORRECTIONS:
   - Self-corrections: If user says "កាហ្វេ ៣ ដុល្លារ អត់ទេ ២ ដុល្លារកន្លះ", discard 3 and use 2.50 USD!
   - Bill splitting: If user says "បាយ ២០ ដុល្លារ ចែកគ្នា ២ នាក់", calculate 20 / 2 = 10 USD!

3. MULTI-ITEM SENTENCES:
   - If user speaks multiple expenses (e.g. "គុយទាវ 10000៛ ហើយកាហ្វេ 2$"), return MULTIPLE transaction objects in the JSON array!

4. CATEGORY STRICTNESS (NO HALLUCINATIONS):
   - Categories allowed: ["food", "transport", "bills", "entertainment", "shopping", "health", "income", "other"].
   - STRICT: If user only speaks an amount (e.g. "៥លា", "5$", "10$") without item name, set category to "other" and note to "Expense (5$)". NEVER guess coffee/food!

EXAMPLES (BILINGUAL KHMER-ENGLISH):
- "៥លា" -> [{"type":"expense","amount":5,"currency":"USD","category":"other","payment_method":"ABA_KHQR","note":"៥ ដុល្លារ"}]
- "កាហ្វេ ២ ដុល្លារកន្លះ" -> [{"type":"expense","amount":2.5,"currency":"USD","category":"food","payment_method":"WOORI_BANK","note":"កាហ្វេ"}]
- "ព្រឹកមិញញ៉ាំគុយទាវអស់ 12000៛ ហើយទិញកាហ្វេអស់ 2.50$ បាញ់ ABA" -> [
    {"type":"expense","amount":12000,"currency":"KHR","category":"food","payment_method":"ABA_KHQR","note":"គុយទាវ"},
    {"type":"expense","amount":2.5,"currency":"USD","category":"food","payment_method":"ABA_KHQR","note":"កាហ្វេ"}
  ]
- "ចាក់សាំងម៉ូតូ 10000៛ លុយសុទ្ធ" -> [{"type":"expense","amount":10000,"currency":"KHR","category":"transport","payment_method":"CASH","note":"ចាក់សាំងម៉ូតូ"}]
- "បាយថ្ងៃត្រង់ 20$ ចែកគ្នា 4 នាក់" -> [{"type":"expense","amount":5,"currency":"USD","category":"food","payment_method":"ABA_KHQR","note":"បាយថ្ងៃត្រង់ (ចែកគ្នា ៤ នាក់)"}]
- "កាហ្វេ 3$ អត់ទេ 2$ វេរ ABA" -> [{"type":"expense","amount":2,"currency":"USD","category":"food","payment_method":"ABA_KHQR","note":"កាហ្វេ"}]
- "ម៉ូយផ្ញើលុយ Freelance 50$" -> [{"type":"income","amount":50,"currency":"USD","category":"income","payment_method":"ABA_KHQR","note":"Freelance"}]
- "បង់ថ្លៃភ្លើង EDC 35$" -> [{"type":"expense","amount":35,"currency":"USD","category":"bills","payment_method":"ABA_KHQR","note":"ថ្លៃភ្លើង EDC"}]
- "PassApp 6000៛" -> [{"type":"expense","amount":6000,"currency":"KHR","category":"transport","payment_method":"CASH","note":"PassApp"}]

Respond ONLY with a valid JSON array. Do not include markdown formatting or backticks.`;

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
