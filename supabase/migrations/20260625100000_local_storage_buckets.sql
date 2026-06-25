insert into storage.buckets (id, name, public)
values
  ('session-context', 'session-context', false),
  ('brief-images', 'brief-images', false)
on conflict (id) do update
set public = excluded.public;
