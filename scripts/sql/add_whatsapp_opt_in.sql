-- Persist provider console "public WhatsApp" opt-in on providers.
-- Until true, public clients should hide WhatsApp CTAs (copy-number may still use phone).
-- Apply on Supabase (historically migrations also live in yoyo-scraper).

alter table public.providers
  add column if not exists whatsapp_opt_in boolean not null default false;

comment on column public.providers.whatsapp_opt_in is
  'When true, public surfaces may show a WhatsApp CTA for this provider phone. Default false.';
