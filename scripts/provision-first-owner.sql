-- Disposable/test projects only.
-- Replace both placeholders with the exact Auth user UUID and existing test
-- business slug. This script never selects the newest user or updates a profile.
DO $$
DECLARE
  target_auth_user_id UUID := '00000000-0000-0000-0000-000000000000';
  target_business_slug TEXT := 'replace-with-disposable-business-slug';
  target_email TEXT;
  target_business_id UUID;
BEGIN
  IF target_auth_user_id = '00000000-0000-0000-0000-000000000000'::UUID
     OR target_business_slug = 'replace-with-disposable-business-slug' THEN
    RAISE EXCEPTION 'Set the explicit test Auth user UUID and disposable business slug first.';
  END IF;

  SELECT u.email
  INTO target_email
  FROM auth.users u
  WHERE u.id = target_auth_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The specified Auth user UUID does not exist in this project.';
  END IF;

  SELECT b.id
  INTO target_business_id
  FROM public.businesses b
  WHERE b.slug = target_business_slug;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The specified disposable business does not exist.';
  END IF;

  INSERT INTO public.profiles (id, business_id, email, full_name, role)
  VALUES (
    target_auth_user_id,
    target_business_id,
    target_email,
    'Disposable Test Owner',
    'OWNER_ADMIN'
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = target_auth_user_id
      AND p.business_id = target_business_id
      AND p.email = target_email
      AND p.role = 'OWNER_ADMIN'
      AND p.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Profile was not changed; verify its email, tenant, role, and active status manually.';
  END IF;
END;
$$;
