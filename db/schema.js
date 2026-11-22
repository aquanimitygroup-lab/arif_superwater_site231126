// Database tables (PostgreSQL 14+). Safe to run more than once.
// Kept as JavaScript so Vercel always bundles it with the server functions.
export const SCHEMA = String.raw`
-- Super Water database schema (PostgreSQL 14+).
-- Safe to run more than once: every statement is "if not exists".

-- People who can sign in to /admin.
-- role 'admin'      = everything
-- role 'production' = inventory and production only (for facility staff)
create table if not exists users (
  id            serial primary key,
  email         text not null unique,
  name          text not null default '',
  role          text not null check (role in ('admin', 'production')),
  password_hash text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists login_attempts (
  id  bigserial primary key,
  ip  text not null,
  at  timestamptz not null default now()
);
create index if not exists login_attempts_ip_at on login_attempts (ip, at);

-- Editable website text. One row per field; value is JSON so it can hold
-- text, numbers or true/false.
create table if not exists content (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- What the shop sells. Prices are whole Taka.
-- bottles = how many bottles of size_ml one unit of this product uses.
create table if not exists products (
  sku     text primary key,
  name    text not null,
  size_ml integer not null check (size_ml in (500, 2000)),
  bottles integer not null check (bottles > 0),
  price   integer not null check (price >= 0),
  was     integer not null check (was >= 0),
  active  boolean not null default true,
  sort    integer not null default 0
);

-- Stock held at the production facility, counted in bottles per size.
-- on_hand  = physically at the facility
-- reserved = promised to website orders that have not been dispatched yet
-- available to sell = on_hand - reserved
create table if not exists stock (
  size_ml       integer primary key check (size_ml in (500, 2000)),
  on_hand       integer not null default 0 check (on_hand >= 0),
  reserved      integer not null default 0 check (reserved >= 0),
  low_threshold integer not null default 0,
  updated_at    timestamptz not null default now()
);

-- Every change to stock, so the numbers can always be explained.
create table if not exists stock_movements (
  id              bigserial primary key,
  size_ml         integer not null,
  on_hand_change  integer not null default 0,
  reserved_change integer not null default 0,
  reason          text not null,   -- production, stocktake, adjustment, order_reserved, order_released, order_dispatched
  ref             text,            -- batch number or order code
  note            text,
  actor           text,            -- who or what made the change
  created_at      timestamptz not null default now()
);
create index if not exists stock_movements_created on stock_movements (created_at desc);

create table if not exists orders (
  id              serial primary key,
  code            text not null unique,      -- shown to the customer, e.g. SW-261121-4821
  public_token    text not null,             -- lets the customer view their own order page
  customer_name   text not null,
  phone           text not null,
  email           text,
  address         text not null,
  city            text not null,
  note            text,
  items           jsonb not null,            -- [{sku, name, qty, price, size_ml, bottles}]
  subtotal        integer not null,
  delivery_fee    integer not null default 0,
  total           integer not null,
  payment_method  text not null,             -- cod, sslcommerz, bkash, ...
  payment_status  text not null default 'unpaid' check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'dispatched', 'delivered', 'cancelled')),
  stock_state     text not null default 'reserved' check (stock_state in ('reserved', 'released', 'dispatched')),
  provider_ref    text,                      -- the gateway's transaction / payment id
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists orders_created on orders (created_at desc);

-- Raw record of every message from a payment gateway, for auditing.
create table if not exists payment_events (
  id         bigserial primary key,
  order_code text,
  provider   text not null,
  kind       text not null,  -- init, callback, ipn, verify
  ok         boolean not null default false,
  payload    jsonb,
  created_at timestamptz not null default now()
);

-- Small key/value store for things like a payment gateway's access token.
create table if not exists app_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
`;
