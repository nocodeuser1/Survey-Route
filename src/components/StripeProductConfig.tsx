import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { DollarSign, Save, AlertCircle, CheckCircle } from 'lucide-react';

interface StripeProduct {
  id: number;
  tier_name: string;
  monthly_price_id: string | null;
  annual_price_id: string | null;
  monthly_price_amount: number;
  annual_price_amount: number;
  features: string[];
  is_active: boolean;
}

export default function StripeProductConfig() {
  const [products, setProducts] = useState<StripeProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('stripe_products')
        .select('*')
        .order('tier_name');

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error loading products:', error);
      setMessage({ type: 'error', text: 'Failed to load products' });
    } finally {
      setLoading(false);
    }
  };

  const updateProduct = (id: number, field: keyof StripeProduct, value: any) => {
    setProducts(products.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const saveProduct = async (product: StripeProduct) => {
    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase
        .from('stripe_products')
        .update({
          monthly_price_id: product.monthly_price_id || null,
          annual_price_id: product.annual_price_id || null,
          monthly_price_amount: product.monthly_price_amount,
          annual_price_amount: product.annual_price_amount,
          is_active: product.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', product.id);

      if (error) throw error;

      setMessage({ type: 'success', text: `${product.tier_name} tier updated successfully` });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error('Error saving product:', error);
      setMessage({ type: 'error', text: 'Failed to save product' });
    } finally {
      setSaving(false);
    }
  };

  const formatPrice = (cents: number) => {
    return (cents / 100).toFixed(2);
  };

  const getTierLabel = (tierName: string) => {
    return tierName.charAt(0).toUpperCase() + tierName.slice(1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-600">Loading products...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Stripe Product Configuration</h2>
          <p className="mt-1 text-sm text-gray-600">
            Connect your Stripe price IDs to enable subscription payments
          </p>
        </div>
        <DollarSign className="w-8 h-8 text-blue-600" />
      </div>

      {message && (
        <div
          className={`p-4 rounded-lg flex items-center gap-3 ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-green-600" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-600" />
          )}
          <span
            className={`text-sm ${
              message.type === 'success' ? 'text-green-800' : 'text-red-800'
            }`}
          >
            {message.text}
          </span>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">How to get your Stripe Price IDs:</h3>
        <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
          <li>Go to your <a href="https://dashboard.stripe.com/products" target="_blank" rel="noopener noreferrer" className="underline font-medium">Stripe Dashboard Products</a></li>
          <li>Create or select a product for each tier (Starter, Professional, Enterprise)</li>
          <li>Create two prices for each product: one for monthly billing and one for annual billing</li>
          <li>Copy the Price ID (starts with "price_") and paste it below</li>
          <li>Make sure the amount matches what you set in Stripe</li>
        </ol>
      </div>

      <div className="space-y-6">
        {products.map((product) => (
          <div
            key={product.id}
            className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-gray-900">
                  {getTierLabel(product.tier_name)}
                </h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={product.is_active}
                    onChange={(e) => updateProduct(product.id, 'is_active', e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-600">Active</span>
                </label>
              </div>
              <button
                onClick={() => saveProduct(product)}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="font-medium text-gray-900">Monthly Billing</h4>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Stripe Price ID
                  </label>
                  <input
                    type="text"
                    value={product.monthly_price_id || ''}
                    onChange={(e) => updateProduct(product.id, 'monthly_price_id', e.target.value)}
                    placeholder="price_..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Price Amount (USD)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={formatPrice(product.monthly_price_amount)}
                      onChange={(e) =>
                        updateProduct(
                          product.id,
                          'monthly_price_amount',
                          Math.round(parseFloat(e.target.value) * 100)
                        )
                      }
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Displayed as ${formatPrice(product.monthly_price_amount)}/month
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-medium text-gray-900">Annual Billing</h4>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Stripe Price ID
                  </label>
                  <input
                    type="text"
                    value={product.annual_price_id || ''}
                    onChange={(e) => updateProduct(product.id, 'annual_price_id', e.target.value)}
                    placeholder="price_..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Price Amount (USD)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={formatPrice(product.annual_price_amount)}
                      onChange={(e) =>
                        updateProduct(
                          product.id,
                          'annual_price_amount',
                          Math.round(parseFloat(e.target.value) * 100)
                        )
                      }
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Displayed as ${formatPrice(product.annual_price_amount)}/year
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium text-gray-700 mb-2">Features:</p>
              <ul className="text-sm text-gray-600 space-y-1">
                {product.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-800">
            <p className="font-medium mb-1">Important Notes:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Price amounts must match exactly what you set in Stripe</li>
              <li>Only active tiers will be displayed on the pricing page</li>
              <li>Changes take effect immediately for new subscriptions</li>
              <li>Test your pricing flow before going live</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
