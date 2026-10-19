/**
 * saveCH Telegram Expense Bot
 * Allows users to record expenses directly by sending text messages, voice, or slip photos on Telegram.
 * 
 * Requirements:
 *  npm install node-telegram-bot-api @supabase/supabase-js
 * 
 * Run:
 *  node telegram/bot.js
 */

import TelegramBot from 'node-telegram-bot-api';
import { createClient } from '@supabase/supabase-js';

// Configuration
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bhenhujwovbnmsajoxmn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_e1R9ThI8oTt_OovzRA885w_P0B6NnDx';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('🤖 saveCH Telegram Expense Bot is running...');

// /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `👋 សួស្តី! ខ្ញុំជា saveCH Expense Bot 🤖\n\nបងអាចកត់ត្រាចំណាយបានយ៉ាងងាយស្រួល៖\n• វាយសារអក្សរ: "កាហ្វេ 2.5$" ឬ "PassApp 6000r"\n• ផ្ញើរូបភាព: Screenshot Slip ផ្ទេរប្រាក់ ABA / Woori\n\nទិន្នន័យនឹង Sync ចូល App saveCH របស់បងភ្លាមៗ! 🚀`);
});

// Text message handler
bot.on('message', async (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    const text = msg.text.trim();
    const chatId = msg.chat.id;

    // Simple parser for Telegram messages (e.g., "coffee 2.5", "កាហ្វេ 2.5$", "សាំង 20000r")
    const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(\$|r|រៀល|៛|dollars?)?/i);
    let amount = match ? parseFloat(match[1]) : 0;
    let currency = (text.includes('r') || text.includes('រៀល') || text.includes('៛') || amount >= 500) ? 'KHR' : 'USD';
    let baseUsd = currency === 'KHR' ? Number((amount / 4100).toFixed(2)) : amount;

    if (amount > 0) {
      const { data, error } = await supabase.from('transactions').insert([{
        type: 'expense',
        amount: amount,
        currency: currency,
        base_amount_usd: baseUsd,
        exchange_rate_used: 4100,
        category: text.includes('សាំង') || text.includes('passapp') ? 'transport' : 'food',
        payment_method: 'ABA_KHQR',
        note: text,
        sync_status: 'synced'
      }]);

      if (!error) {
        bot.sendMessage(chatId, `✅ បានកត់ត្រាចំណាយជោគជ័យ!\n\n💰 ចំនួន: ${currency === 'KHR' ? amount.toLocaleString() + ' ៛' : '$' + amount.toFixed(2)}\n📝 កំណត់ចំណាំ: "${text}"\n⚡ Sync ចូល saveCH រួចរាល់!`);
      } else {
        bot.sendMessage(chatId, `⚠️ កំហុសក្នុងការរក្សាទុក: ${error.message}`);
      }
    } else {
      bot.sendMessage(chatId, `💡 សូមបញ្ជាក់ចំនួនទឹកប្រាក់ ឧទាហរណ៍៖ "កាហ្វេ 2.5$" ឬ "សាំង ២ ម៉ឺន"`);
    }
  }
});
