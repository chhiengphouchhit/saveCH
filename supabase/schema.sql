-- =========================================================================
-- saveCH App: Supabase PostgreSQL Schema & Security Policies
-- Run this script in the Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- =========================================================================

-- 1. Create Transactions Table
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  type text not null check (type in ('expense', 'income')),
  amount numeric not null check (amount > 0),
  currency text not null default 'USD' check (currency in ('USD', 'KHR')),
  base_amount_usd numeric not null,
  exchange_rate_used numeric not null default 4100,
  category text not null,
  payment_method text not null check (payment_method in ('WOORI_BANK', 'ACLEDA', 'ABA_KHQR', 'CASH', 'CARD')),
  note text,
  sync_status text default 'synced',
  transaction_date timestamp with time zone default timezone('utc'::text, now()),
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 2. Performance Indexes (Ultra-fast querying by user & date)
create index if not exists idx_transactions_user_date on public.transactions (user_id, transaction_date desc);
create index if not exists idx_transactions_user_category on public.transactions (user_id, category);

-- 3. Enable Row Level Security (RLS)
alter table public.transactions enable row level security;

-- 4. RLS Policies: Allow users to strictly SELECT, INSERT, UPDATE, DELETE only their own transactions
drop policy if exists "Users can select own transactions" on public.transactions;
create policy "Users can select own transactions"
  on public.transactions
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own transactions" on public.transactions;
create policy "Users can insert own transactions"
  on public.transactions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own transactions" on public.transactions;
create policy "Users can update own transactions"
  on public.transactions
  for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own transactions" on public.transactions;
create policy "Users can delete own transactions"
  on public.transactions
  for delete
  using (auth.uid() = user_id);

-- Optional: Enable Realtime on transactions table for live multi-device sync
alter publication supabase_realtime add table public.transactions;
