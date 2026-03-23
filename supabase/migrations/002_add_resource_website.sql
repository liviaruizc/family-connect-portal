-- Adds website support to organizations/resources.
-- Run this in Supabase SQL Editor before using the website field in the app.

ALTER TABLE public.resource
ADD COLUMN IF NOT EXISTS website TEXT;
