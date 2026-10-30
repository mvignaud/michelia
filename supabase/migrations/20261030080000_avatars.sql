-- La bobine de chaque compte : le petit portrait affiché dans la discussion et dans le compte.
-- Michel la dessine à l'inscription à partir de l'identifiant du compte (toujours la même, calculée
-- par l'appli : rien à stocker, et les comptes déjà créés en ont une d'office). La colonne ne garde que
-- les retouches faites dans l'atelier du compte : des choix courts (« beret », « gauloise »…), jamais d'image.
-- Rejouable sans risque.

alter table public.profiles add column if not exists avatar jsonb;

alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles add constraint profiles_avatar_check
  check (avatar is null or (jsonb_typeof(avatar) = 'object' and octet_length(avatar::text) <= 1024));

-- Lecture déjà permise sur tout le profil ; la modification, colonne par colonne.
grant update (avatar) on public.profiles to authenticated;
