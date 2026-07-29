-- ============================================================================
-- 0029 · Short friend codes, and a shorter life
--
-- Owner feedback, 2026-07-29: 32 characters is far too long to read out, and
-- the code should expire after a minute and keep regenerating while the member
-- has the screen open.
--
-- Both are right, and the second is what makes the first safe.
--
-- THE ARITHMETIC, BECAUSE THIS IS THE SAFETY PROPERTY
--
-- 8 characters from a 32-symbol alphabet is 40 bits — 1.1 trillion codes.
-- Against that an attacker has: a 60-second window, one use per code, and at
-- most a few hundred codes live across the whole club at once. Landing on any
-- of them needs on the order of a billion guesses per second, sustained, over
-- HTTP. It is not a practical attack, and the prize for winning it is being
-- added as one person's friend.
--
-- The old 122-bit code was not buying anything the expiry was not already
-- buying. What it was costing was real: nobody can read 32 hex characters out
-- loud at a meeting point, which is the fallback the whole feature depends on
-- when a camera will not focus.
--
-- ALPHABET
--
-- Crockford-style: no I, L, O or U. The first three because they are
-- indistinguishable from 1 and 0 when read off a phone screen at arm's length,
-- and U because removing it means the alphabet cannot accidentally spell
-- anything unfortunate.
--
-- EACH CODE RETIRES THE LAST
--
-- Showing a new code revokes the previous one, so the code on screen is always
-- the only one that works. That is also why the member-facing "turn off my
-- code" button is gone from the app: waiting sixty seconds now does the same
-- job, and a button that duplicates the passage of time is a button that only
-- adds doubt. The organiser's moderation path (admin_disable_member_qr) stays —
-- that one answers a complaint, not an accident.
-- ============================================================================

create or replace function app_private.friend_code_alphabet()
returns text
language sql
immutable
parallel safe
as $$
  -- 32 symbols exactly, so a byte maps into it with no modulo bias.
  select '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
$$;

create or replace function app_private.new_friend_code()
returns text
language plpgsql
volatile
as $$
declare
  v_hex   text;
  v_code  text := '';
  v_alpha text := app_private.friend_code_alphabet();
  i       integer;
begin
  -- gen_random_uuid() draws from Postgres's strong random source. random() does
  -- not, and a predictable friend code is a code somebody else can mint.
  v_hex := replace(gen_random_uuid()::text, '-', '');

  for i in 0..7 loop
    -- One byte per character. 256 / 32 = 8 exactly, so every symbol is equally
    -- likely — a non-power-of-two alphabet here would quietly bias the output.
    v_code := v_code || substr(
      v_alpha,
      1 + (('x' || substr(v_hex, i * 2 + 1, 2))::bit(8)::integer % 32),
      1
    );
  end loop;

  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Showing a code.
--
-- No longer reuses an unexpired one. At three minutes reuse kept the code
-- stable while it was being scanned; at sixty seconds the member is watching it
-- roll over anyway, and always minting fresh means the newest code is the only
-- live one.
-- ---------------------------------------------------------------------------
create or replace function public.my_friend_qr()
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_token text;
  v_exp   timestamptz;
  v_tries integer := 0;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  -- Retire whatever they were showing. One live code per member, always the
  -- one on screen.
  update public.friend_qr_tokens
     set revoked_at = now()
   where user_id = v_user and revoked_at is null;

  v_exp := now() + interval '60 seconds';

  -- Short codes collide far more often than 122-bit ones did — still rarely,
  -- but often enough that "it errored once in a year" is a real outcome rather
  -- than a theoretical one. Retry rather than fail.
  loop
    v_tries := v_tries + 1;
    v_token := app_private.new_friend_code();

    begin
      insert into public.friend_qr_tokens (token, user_id, expires_at)
      values (v_token, v_user, v_exp);
      exit;
    exception when unique_violation then
      if v_tries >= 5 then
        raise exception 'could not generate a code, please try again'
          using errcode = 'internal_error';
      end if;
    end;
  end loop;

  return query select v_token, v_exp;
end;
$$;

-- ---------------------------------------------------------------------------
-- Redeeming one.
--
-- Case-insensitive and whitespace-tolerant, because the fallback path is one
-- person reading eight characters out and another typing them. "k7m2 9xqp"
-- is the same code as "K7M29XQP", and a member who typed it correctly should
-- not be told their friend's code is invalid.
-- ---------------------------------------------------------------------------
create or replace function public.add_friend_by_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_owner   uuid;
  v_low     uuid;
  v_high    uuid;
  v_cleaned text;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  -- Strip anything that is not part of the alphabet: spaces, dashes, and the
  -- formatting the app itself adds when it displays the code in two groups.
  v_cleaned := upper(regexp_replace(coalesce(p_token, ''), '[^0-9A-Za-z]', '', 'g'));

  select t.user_id into v_owner
  from public.friend_qr_tokens t
  where t.token = v_cleaned
    and t.revoked_at is null
    and t.expires_at > now()
  for update;

  if v_owner is null then
    -- Deliberately one message for expired, revoked and never-existed. A
    -- distinct "no such code" would let someone probe for valid codes, which
    -- matters more now the search space is smaller.
    raise exception 'that code is not valid any more — ask them to show it again'
      using errcode = 'check_violation';
  end if;

  if v_owner = v_me then
    raise exception 'that is your own code' using errcode = 'check_violation';
  end if;

  update public.friend_qr_tokens set revoked_at = now() where token = v_cleaned;

  v_low  := least(v_me, v_owner);
  v_high := greatest(v_me, v_owner);

  insert into public.friendships (user_low, user_high, initiated_by)
  values (v_low, v_high, v_me)
  on conflict (user_low, user_high) do nothing;

  return v_owner;
end;
$$;

comment on function public.my_friend_qr is
  'Mints a fresh 8-character code valid for 60 seconds, retiring any previous one. See migration 0029 for why 40 bits is enough.';
