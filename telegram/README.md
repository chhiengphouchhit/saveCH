# 🤖 saveCH Telegram Expense Bot

អនុញ្ញាតឱ្យអ្នកកត់ត្រាចំណាយផ្ទាល់តាមរយៈ **Telegram** ដោយគ្រាន់តែផ្ញើសារអក្សរ ឬរូបភាព Slip ផ្ទេរប្រាក់។

## របៀបដំឡើង (Setup Instructions)

1. **បង្កើត Bot លើ Telegram:**
   - ស្វែងរក `@BotFather` ក្នុង Telegram
   - វាយបញ្ជា `/newbot`
   - កំណត់ឈ្មោះ និង username ឱ្យ bot របស់អ្នក (ឧ. `my_savech_bot`)
   - ចម្លងយក **API Token** ដែល BotFather ផ្តល់ឱ្យ

2. **ដំណើរការ Bot លើកុំព្យូទ័រ ឬ Server (Render, Railway, VPS):**
   ```bash
   cd telegram
   npm install node-telegram-bot-api @supabase/supabase-js
   export TELEGRAM_BOT_TOKEN="your_token_here"
   node bot.js
   ```

3. **របៀបប្រើប្រាស់:**
   - ចូលទៅកាន់ Bot របស់អ្នកក្នុង Telegram រួចចុច `/start`
   - វាយសារដូចជា៖
     - `កាហ្វេ 2.5$`
     - `PassApp 6000r`
     - `សាំង 20000 ៛`
   - រាល់ពេលអ្នកផ្ញើសារ នោះ Bot នឹងកត់ត្រា និង Sync ចូលទៅក្នុង Database នៃ App **saveCH** ដោយស្វ័យប្រវត្តិ!
