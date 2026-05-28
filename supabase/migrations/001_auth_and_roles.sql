-- ============================================================================
-- Family Connect Portal — Auth & Roles Setup
-- ============================================================================
-- This script creates the profiles table, auto-trigger for user signup,
-- helper functions, and Row-Level Security (RLS) policies for role-based access.
--
-- Run this in the Supabase SQL editor (in your project dashboard under SQL Editor).
-- It will set up the volunteer/admin role model.
--
-- ============================================================================

-- ============================================================================
-- 1. CREATE PROFILES TABLE (linked to auth.users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'volunteer' CHECK (role IN ('volunteer', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on profiles table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. AUTO-CREATE PROFILE ON USER SIGNUP
-- ============================================================================
-- Trigger function: creates a profile row whenever a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'volunteer'  -- All new users start as volunteers
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    updated_at = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block auth signup if profile sync fails.
  RAISE LOG 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 3. HELPER FUNCTION — Check if user is admin
-- ============================================================================
CREATE OR REPLACE FUNCTION is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT role = 'admin'
    FROM public.profiles
    WHERE id = user_id
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. RLS POLICIES — PROFILES TABLE
-- ============================================================================

-- Users can read their own profile and admins can read all profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (is_admin(auth.uid()));

-- Users can update only their own profile (but NOT role)
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()));

-- Users can create their own profile row if it is missing
CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Only admins can promote users (update role)
CREATE POLICY "Admins can update user roles"
  ON public.profiles
  FOR UPDATE
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- ============================================================================
-- 5. RLS POLICIES — RESOURCE TABLE (organizations)
-- ============================================================================

-- Anyone authenticated can read resources
CREATE POLICY "Authenticated users can read resources"
  ON public.resource
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admins can insert resources (create organizations)
CREATE POLICY "Only admins can create resources"
  ON public.resource
  FOR INSERT
  WITH CHECK (is_admin(auth.uid()));

-- Only admins can update resources
CREATE POLICY "Only admins can update resources"
  ON public.resource
  FOR UPDATE
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Only admins can delete resources
CREATE POLICY "Only admins can delete resources"
  ON public.resource
  FOR DELETE
  USING (is_admin(auth.uid()));

-- ============================================================================
-- 6. RLS POLICIES — CATEGORY TABLE
-- ============================================================================

-- Anyone authenticated can read categories
CREATE POLICY "Authenticated users can read categories"
  ON public.category
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- 7. RLS POLICIES — RESOURCE_CATEGORY TABLE
-- ============================================================================

-- Anyone authenticated can read resource-category links
CREATE POLICY "Authenticated users can read resource categories"
  ON public.resource_category
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admins can manage resource-category links
CREATE POLICY "Only admins can create resource categories"
  ON public.resource_category
  FOR INSERT
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Only admins can delete resource categories"
  ON public.resource_category
  FOR DELETE
  USING (is_admin(auth.uid()));

-- ============================================================================
-- 8. RLS POLICIES — RESOURCE_SERVICE TABLE
-- ============================================================================

-- Anyone authenticated can read resource-service links
CREATE POLICY "Authenticated users can read resource services"
  ON public.resource_service
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admins can manage resource-service links
CREATE POLICY "Only admins can create resource services"
  ON public.resource_service
  FOR INSERT
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Only admins can delete resource services"
  ON public.resource_service
  FOR DELETE
  USING (is_admin(auth.uid()));

-- ============================================================================
-- 9. GRANT PERMISSIONS
-- ============================================================================

-- Allow authenticated users to read from public tables
GRANT SELECT ON public.resource TO authenticated;
GRANT SELECT ON public.category TO authenticated;
GRANT SELECT ON public.resource_category TO authenticated;
GRANT SELECT ON public.resource_service TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;

-- Allow authenticated users to insert/update resources (RLS will enforce admin-only)
GRANT INSERT, UPDATE, DELETE ON public.resource TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.resource_category TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.resource_service TO authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;

ALTER TABLE public.resource
ADD COLUMN IF NOT EXISTS website TEXT;

-- ============================================================================
-- 10. INITIAL SETUP — PROMOTE YOUR FIRST ADMIN
-- ============================================================================
-- IMPORTANT: After running this script, promote the first admin user by running:
--
--   UPDATE public.profiles SET role = 'admin' WHERE email = 'your-email@example.com';
--
-- Replace 'your-email@example.com' with your actual email address.
-- You only need to do this once to bootstrap the system.
-- After that, admins can promote other admins via the app's "Add Admin" feature.
-- ============================================================================

-- Done!
