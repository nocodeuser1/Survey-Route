/*
  # Fix Stripe Products RLS Policies

  1. Changes
    - Update RLS policies to allow agency owners to view ALL products (including inactive ones)
    - This enables the admin interface to show and configure products before activation
    - Make products globally managed (not account-specific)

  2. Security
    - Agency owners can view and manage all products
    - Regular users can only view active products on the public pricing page
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view active products" ON stripe_products;
DROP POLICY IF EXISTS "Agency owners can insert products" ON stripe_products;
DROP POLICY IF EXISTS "Agency owners can update products" ON stripe_products;
DROP POLICY IF EXISTS "Agency owners can manage their products" ON stripe_products;

-- Public users can view only active products
CREATE POLICY "Public can view active products"
  ON stripe_products
  FOR SELECT
  USING (is_active = true);

-- Agency owners can view all products (for management interface)
CREATE POLICY "Agency owners can view all products for management"
  ON stripe_products
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = auth.uid()
      AND users.is_agency_owner = true
    )
  );

-- Agency owners can update all products
CREATE POLICY "Agency owners can update products"
  ON stripe_products
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = auth.uid()
      AND users.is_agency_owner = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = auth.uid()
      AND users.is_agency_owner = true
    )
  );

-- Agency owners can insert products
CREATE POLICY "Agency owners can insert products"
  ON stripe_products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_user_id = auth.uid()
      AND users.is_agency_owner = true
    )
  );