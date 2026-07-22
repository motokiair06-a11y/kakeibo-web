-- ============================================================
-- 家計ノート - Supabase スキーマ
-- Supabase ダッシュボード > SQL Editor に貼り付けて実行してください
-- ============================================================

-- 拡張機能(uuid生成用)
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 家族共有メンバーシップ
-- household_id は「そのデータの持ち主(オーナー)」の auth.users.id を指す。
-- 他のユーザーがこのテーブルに参加登録すると、そのオーナーのデータを
-- 読み書きできるようになる。
-- ------------------------------------------------------------
create table household_members (
  household_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, member_id)
);

alter table household_members enable row level security;

create policy "自分が絡む行だけ見える" on household_members
  for select using (member_id = auth.uid() or household_id = auth.uid());

create policy "自分自身としてのみ参加できる" on household_members
  for insert with check (member_id = auth.uid());

create policy "自分の参加は自分で削除できる" on household_members
  for delete using (member_id = auth.uid() or household_id = auth.uid());

-- ------------------------------------------------------------
-- ユーザー設定
-- ------------------------------------------------------------
create table user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dark_mode boolean not null default false,
  active_household_id uuid not null,
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "自分の設定のみ操作可能" on user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- 共通の閲覧条件を関数化
-- ------------------------------------------------------------
create or replace function has_household_access(hh uuid)
returns boolean
language sql
stable
as $$
  select hh = auth.uid()
    or exists (
      select 1 from household_members
      where household_id = hh and member_id = auth.uid()
    );
$$;

-- ------------------------------------------------------------
-- カテゴリ
-- ------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  name text not null,
  type text not null check (type in ('income', 'expense')),
  color text not null default '#7A6A55',
  budget numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table categories enable row level security;

create policy "家族共有範囲で読み書き可能" on categories
  for all using (has_household_access(household_id))
  with check (has_household_access(household_id));

-- ------------------------------------------------------------
-- 口座・資産
-- ------------------------------------------------------------
create table accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  name text not null,
  type text not null default 'bank',
  balance numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table accounts enable row level security;

create policy "家族共有範囲で読み書き可能" on accounts
  for all using (has_household_access(household_id))
  with check (has_household_access(household_id));

-- ------------------------------------------------------------
-- 取引(収入・支出)
-- ------------------------------------------------------------
create table transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  date date not null,
  type text not null check (type in ('income', 'expense')),
  amount numeric not null,
  category_id uuid references categories(id) on delete set null,
  memo text default '',
  method text default '現金',
  tags text[] default '{}',
  status text not null default 'confirmed' check (status in ('confirmed', 'pending')),
  created_at timestamptz not null default now()
);

alter table transactions enable row level security;

create policy "家族共有範囲で読み書き可能" on transactions
  for all using (has_household_access(household_id))
  with check (has_household_access(household_id));

create index transactions_household_date_idx on transactions (household_id, date);

-- ------------------------------------------------------------
-- サブスクリプション
-- ------------------------------------------------------------
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  name text not null,
  amount numeric not null,
  cycle text not null check (cycle in ('monthly', 'yearly')),
  billing_day int default 1,
  billing_month_day text default '01-01',
  category_id uuid references categories(id) on delete set null,
  method text default 'クレジットカード',
  last_used date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

create policy "家族共有範囲で読み書き可能" on subscriptions
  for all using (has_household_access(household_id))
  with check (has_household_access(household_id));

-- ============================================================
-- 【既にschema.sqlを実行済みの人向け】追加マイグレーション
-- 「未確定の予定」機能を追加する場合は、以下だけを追加で実行してください
-- (テーブルを最初から作る場合は上のCREATE TABLEに既に含まれているので不要です)
-- ============================================================
-- alter table transactions
--   add column if not exists status text not null default 'confirmed'
--   check (status in ('confirmed', 'pending'));

-- ============================================================
-- 完了。あとはアプリ側の環境変数(.env.local)に
-- SupabaseのURLとanonキーを設定すれば動作します。
-- ============================================================
