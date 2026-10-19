-- An agreed daily request limit, enforced rather than intended.
--
-- Tauste's legal department granted access from tauste.com.br on condition
-- of twenty requests a day, a figure their technical coordinator set to keep
-- their system stable. A condition attached to a permission has to be kept
-- by the code: earlier today I managed to run three collectors at once
-- without noticing, which is exactly how good intentions fail.
--
-- The count is per day rather than per run, so a second run on the same day
-- does not quietly get a fresh allowance.

alter table stores
  add column if not exists daily_request_budget integer;

comment on column stores.daily_request_budget is
  'Requests this store has agreed to receive per day. Null means no agreed limit.';

alter table stores
  drop constraint if exists stores_budget_positive;

alter table stores
  add constraint stores_budget_positive
  check (daily_request_budget is null or daily_request_budget > 0);

create table if not exists store_request_log (
  store_id uuid not null references stores (id) on delete cascade,
  day      date not null,
  requests integer not null default 0,
  primary key (store_id, day)
);

comment on table store_request_log is
  'Requests spent per store per day, so a budget survives across runs.';

-- Tauste back on, with the limit they asked for.
update stores
   set active = true,
       daily_request_budget = 20
 where slug = 'tauste';
