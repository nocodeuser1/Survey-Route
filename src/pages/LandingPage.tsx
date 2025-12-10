import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEffect, useState } from 'react';
import { MapPin, Route, BarChart3, Users, Clock, CheckCircle, Navigation, Camera, FileText, Upload, Map, Smartphone, Monitor, Shield, Zap, TrendingUp, Globe, ChevronDown, ChevronUp, Star } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useStripeCheckout } from '../hooks/useStripeCheckout';

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

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [isAnnual, setIsAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [products, setProducts] = useState<StripeProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const { createCheckoutSession, loading: checkoutLoading } = useStripeCheckout();

  useEffect(() => {
    if (user && !loading) {
      if (user.isAgencyOwner) {
        navigate('/agency', { replace: true });
      } else {
        navigate('/app', { replace: true });
      }
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('stripe_products')
        .select('*')
        .eq('is_active', true)
        .order('tier_name');

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error loading products:', error);
    } finally {
      setProductsLoading(false);
    }
  };

  const handleGetStarted = async (product: StripeProduct) => {
    if (!user) {
      navigate('/request-access');
      return;
    }

    const priceId = isAnnual ? product.annual_price_id : product.monthly_price_id;

    if (!priceId) {
      alert('This pricing option is not available yet. Please contact support.');
      return;
    }

    try {
      await createCheckoutSession({
        priceId,
        mode: 'subscription',
      });
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Failed to start checkout. Please try again.');
    }
  };

  const formatPrice = (cents: number) => {
    return (cents / 100).toFixed(0);
  };

  const getTierConfig = (tierName: string) => {
    const configs: Record<string, { color: string; borderColor: string; buttonClass: string; popular?: boolean }> = {
      starter: {
        color: 'text-gray-900',
        borderColor: 'border-gray-200',
        buttonClass: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
      },
      professional: {
        color: 'text-blue-600',
        borderColor: 'border-blue-600 border-4',
        buttonClass: 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg hover:shadow-xl',
        popular: true,
      },
      enterprise: {
        color: 'text-gray-900',
        borderColor: 'border-gray-200',
        buttonClass: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
      },
    };
    return configs[tierName] || configs.starter;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white/95 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 p-2 rounded-lg shadow-md">
                <Route className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Survey-Route</h1>
                <p className="text-xs text-gray-500">by BEAR DATA</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/login')}
                className="px-4 py-2 text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                Sign In
              </button>
              <button
                onClick={() => navigate('/request-access')}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-medium shadow-md hover:shadow-lg"
              >
                Request Access
              </button>
            </div>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-green-50">
          <div className="absolute inset-0 bg-blue-50/30"></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32 relative">
            <div className="text-center max-w-4xl mx-auto">
              <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                <Star className="w-4 h-4" />
                Trusted for inspections nationwide
              </div>
              <h2 className="text-5xl md:text-6xl lg:text-7xl font-bold text-gray-900 mb-6 leading-tight">
                Complete Facility Inspections
                <span className="block text-blue-600 mt-2">Stay Compliant & Efficient</span>
              </h2>
              <p className="text-xl md:text-2xl text-gray-600 mb-10 leading-relaxed">
                The complete platform for environmental compliance, safety inspections, and facility management.
                Digital forms, photo documentation, and intelligent route planning in one solution.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
                <button
                  onClick={() => navigate('/request-access')}
                  className="w-full sm:w-auto px-8 py-4 bg-blue-600 text-white text-lg rounded-lg hover:bg-blue-700 transition-all font-semibold shadow-lg hover:shadow-xl hover:scale-105"
                >
                  Get Started Free
                </button>
                <button
                  onClick={() => navigate('/login')}
                  className="w-full sm:w-auto px-8 py-4 bg-white text-blue-600 text-lg rounded-lg hover:bg-gray-50 transition-all font-semibold border-2 border-blue-600 shadow-md"
                >
                  Sign In
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-8 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span>14-day free trial</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span>Cancel anytime</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Highlights - Quick Grid */}
        <section className="py-20 bg-white border-y border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Built for Oil & Gas Compliance</h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Everything you need for SPCC inspections, environmental monitoring, safety audits, and regulatory compliance.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              <div className="bg-gradient-to-br from-blue-50 to-white rounded-xl p-8 border border-blue-100 hover:shadow-lg transition-shadow">
                <div className="bg-blue-600 w-12 h-12 rounded-lg flex items-center justify-center mb-4 shadow-md">
                  <Shield className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">SPCC & Environmental Compliance</h3>
                <p className="text-gray-600 leading-relaxed">
                  Customizable inspection templates for SPCC, stormwater, and environmental audits.
                  Track completion status, deadlines, and maintain complete compliance records.
                </p>
              </div>

              <div className="bg-gradient-to-br from-green-50 to-white rounded-xl p-8 border border-green-100 hover:shadow-lg transition-shadow">
                <div className="bg-green-600 w-12 h-12 rounded-lg flex items-center justify-center mb-4 shadow-md">
                  <Camera className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">Photo Documentation</h3>
                <p className="text-gray-600 leading-relaxed">
                  Capture and store photo evidence with GPS tagging and timestamps. Build comprehensive visual records
                  for audits and regulatory reporting.
                </p>
              </div>

              <div className="bg-gradient-to-br from-orange-50 to-white rounded-xl p-8 border border-orange-100 hover:shadow-lg transition-shadow">
                <div className="bg-orange-600 w-12 h-12 rounded-lg flex items-center justify-center mb-4 shadow-md">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">Digital Signatures & Audit Trail</h3>
                <p className="text-gray-600 leading-relaxed">
                  Inspector certification with digital signatures. Complete audit trail of who inspected what and when.
                  Meet regulatory documentation requirements.
                </p>
              </div>

              <div className="bg-gradient-to-br from-teal-50 to-white rounded-xl p-8 border border-teal-100 hover:shadow-lg transition-shadow">
                <div className="bg-teal-600 w-12 h-12 rounded-lg flex items-center justify-center mb-4 shadow-md">
                  <Route className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">Smart Route Planning</h3>
                <p className="text-gray-600 leading-relaxed">
                  Automatically optimize multi-day routes across well sites, tank farms, and facilities.
                  Reduce travel time by 40% with intelligent routing.
                </p>
              </div>

              <div className="bg-gradient-to-br from-red-50 to-white rounded-xl p-8 border border-red-100 hover:shadow-lg transition-shadow">
                <div className="bg-red-600 w-12 h-12 rounded-lg flex items-center justify-center mb-4 shadow-md">
                  <Navigation className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">Real-Time Field Navigation</h3>
                <p className="text-gray-600 leading-relaxed">
                  GPS-enabled survey mode shows nearby facilities with distances and bearings.
                  One-tap navigation to Google/Apple Maps for turn-by-turn directions.
                </p>
              </div>

              <div className="bg-gradient-to-br from-yellow-50 to-white rounded-xl p-8 border border-yellow-100 hover:shadow-lg transition-shadow">
                <div className="bg-yellow-600 w-12 h-12 rounded-lg flex items-center justify-center mb-4 shadow-md">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">Compliance Reporting</h3>
                <p className="text-gray-600 leading-relaxed">
                  Generate professional inspection reports with photos and signatures. Export data for regulatory
                  submissions. Custom branding with your company logo.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-20 bg-gradient-to-br from-gray-50 to-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">How It Works</h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Four simple steps to transform your field inspection workflow
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="text-center">
                <div className="relative inline-flex items-center justify-center w-20 h-20 bg-blue-600 text-white rounded-full text-2xl font-bold mb-4 shadow-lg">
                  1
                </div>
                <div className="bg-white rounded-lg p-6 shadow-md border border-gray-200 h-full">
                  <Upload className="w-8 h-8 text-blue-600 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Facilities</h3>
                  <p className="text-gray-600">
                    Import your facility list via CSV with addresses and visit durations
                  </p>
                </div>
              </div>

              <div className="text-center">
                <div className="relative inline-flex items-center justify-center w-20 h-20 bg-green-600 text-white rounded-full text-2xl font-bold mb-4 shadow-lg">
                  2
                </div>
                <div className="bg-white rounded-lg p-6 shadow-md border border-gray-200 h-full">
                  <MapPin className="w-8 h-8 text-green-600 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Configure Teams</h3>
                  <p className="text-gray-600">
                    Set up team home bases and assign facilities to different inspection teams
                  </p>
                </div>
              </div>

              <div className="text-center">
                <div className="relative inline-flex items-center justify-center w-20 h-20 bg-orange-600 text-white rounded-full text-2xl font-bold mb-4 shadow-lg">
                  3
                </div>
                <div className="bg-white rounded-lg p-6 shadow-md border border-gray-200 h-full">
                  <Route className="w-8 h-8 text-orange-600 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Generate Routes</h3>
                  <p className="text-gray-600">
                    Click optimize and instantly get multi-day routes with driving times
                  </p>
                </div>
              </div>

              <div className="text-center">
                <div className="relative inline-flex items-center justify-center w-20 h-20 bg-teal-600 text-white rounded-full text-2xl font-bold mb-4 shadow-lg">
                  4
                </div>
                <div className="bg-white rounded-lg p-6 shadow-md border border-gray-200 h-full">
                  <CheckCircle className="w-8 h-8 text-teal-600 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Complete Inspections</h3>
                  <p className="text-gray-600">
                    Use survey mode in the field to navigate, inspect, and generate reports
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Proven Results for Oil & Gas Operations</h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Stay compliant, improve efficiency, and reduce operational costs
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              <div className="text-center p-8 bg-gradient-to-br from-blue-50 to-white rounded-xl border border-blue-100">
                <div className="text-5xl font-bold text-blue-600 mb-2">100%</div>
                <div className="text-gray-900 font-semibold mb-2">Audit Ready</div>
                <div className="text-gray-600">Complete digital records with photos, signatures, and timestamps for regulatory compliance</div>
              </div>

              <div className="text-center p-8 bg-gradient-to-br from-green-50 to-white rounded-xl border border-green-100">
                <div className="text-5xl font-bold text-green-600 mb-2">Zero</div>
                <div className="text-gray-900 font-semibold mb-2">Missed Inspections</div>
                <div className="text-gray-600">Track compliance deadlines and inspection status across all facilities in real-time</div>
              </div>

              <div className="text-center p-8 bg-gradient-to-br from-orange-50 to-white rounded-xl border border-orange-100">
                <div className="text-5xl font-bold text-orange-600 mb-2">40%</div>
                <div className="text-gray-900 font-semibold mb-2">Reduced Travel</div>
                <div className="text-gray-600">Smart route optimization minimizes miles driven and fuel costs</div>
              </div>

              <div className="text-center p-8 bg-gradient-to-br from-teal-50 to-white rounded-xl border border-teal-100">
                <div className="text-5xl font-bold text-teal-600 mb-2">Instant</div>
                <div className="text-gray-900 font-semibold mb-2">Report Generation</div>
                <div className="text-gray-600">Professional inspection reports with photos and signatures in seconds</div>
              </div>

              <div className="text-center p-8 bg-gradient-to-br from-red-50 to-white rounded-xl border border-red-100">
                <div className="text-5xl font-bold text-red-600 mb-2">Cloud</div>
                <div className="text-gray-900 font-semibold mb-2">Secure Storage</div>
                <div className="text-gray-600">Enterprise-grade security for sensitive compliance data and records</div>
              </div>

              <div className="text-center p-8 bg-gradient-to-br from-yellow-50 to-white rounded-xl border border-yellow-100">
                <div className="text-5xl font-bold text-yellow-600 mb-2">Multi-Site</div>
                <div className="text-gray-900 font-semibold mb-2">Management</div>
                <div className="text-gray-600">Manage inspections across hundreds of facilities from one platform</div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section className="py-20 bg-gradient-to-br from-gray-50 to-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Simple, Transparent Pricing</h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
                Choose the plan that fits your team size. All plans include 14-day free trial.
              </p>

              <div className="inline-flex items-center gap-4 bg-white rounded-lg p-1 shadow-md border border-gray-200">
                <button
                  onClick={() => setIsAnnual(false)}
                  className={`px-6 py-2 rounded-md font-medium transition-all ${
                    !isAnnual ? 'bg-blue-600 text-white shadow-md' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setIsAnnual(true)}
                  className={`px-6 py-2 rounded-md font-medium transition-all ${
                    isAnnual ? 'bg-blue-600 text-white shadow-md' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Annual
                  <span className="ml-2 text-sm bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                    Save 17%
                  </span>
                </button>
              </div>
            </div>

            {productsLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading pricing...</p>
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-600">Pricing information coming soon. Please contact us for details.</p>
                <button
                  onClick={() => navigate('/request-access')}
                  className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                >
                  Request Access
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                {products.map((product) => {
                  const config = getTierConfig(product.tier_name);
                  const monthlyPrice = formatPrice(product.monthly_price_amount);
                  const annualPrice = formatPrice(product.annual_price_amount);
                  const annualMonthlyPrice = formatPrice(Math.round(product.annual_price_amount / 12));

                  return (
                    <div
                      key={product.id}
                      className={`bg-white rounded-2xl shadow-lg ${config.borderColor} p-8 hover:shadow-xl transition-shadow ${
                        config.popular ? 'relative transform scale-105 shadow-2xl' : ''
                      }`}
                    >
                      {config.popular && (
                        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                          <span className="bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-bold shadow-lg">
                            MOST POPULAR
                          </span>
                        </div>
                      )}

                      <div className="text-center mb-6">
                        <h3 className="text-2xl font-bold text-gray-900 mb-2 capitalize">
                          {product.tier_name}
                        </h3>
                        <div className="mb-4">
                          <span className={`text-5xl font-bold ${config.color}`}>
                            ${isAnnual ? annualMonthlyPrice : monthlyPrice}
                          </span>
                          <span className="text-gray-600">/month</span>
                        </div>
                        {isAnnual && (
                          <p className="text-sm text-green-600 font-medium">
                            Billed annually at ${annualPrice}
                          </p>
                        )}
                      </div>

                      <ul className="space-y-4 mb-8">
                        {product.features.map((feature, idx) => (
                          <li key={idx} className="flex items-start gap-3">
                            <CheckCircle className={`w-5 h-5 ${config.popular ? 'text-blue-600' : 'text-green-600'} flex-shrink-0 mt-0.5`} />
                            <span className="text-gray-700">{feature}</span>
                          </li>
                        ))}
                      </ul>

                      <button
                        onClick={() => handleGetStarted(product)}
                        disabled={checkoutLoading}
                        className={`w-full py-3 rounded-lg transition-colors font-semibold ${config.buttonClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {checkoutLoading ? 'Loading...' : 'Get Started'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Use Cases */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Purpose-Built for Oil & Gas</h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Complete solutions for every type of facility inspection and compliance need
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-blue-50 to-white p-6 rounded-xl border border-blue-100">
                <Shield className="w-10 h-10 text-blue-600 mb-3" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">SPCC Inspections</h3>
                <p className="text-gray-600">Spill Prevention Control and Countermeasure inspections with customizable checklists and photo documentation</p>
              </div>

              <div className="bg-gradient-to-br from-green-50 to-white p-6 rounded-xl border border-green-100">
                <CheckCircle className="w-10 h-10 text-green-600 mb-3" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Well Site Inspections</h3>
                <p className="text-gray-600">Production facility monitoring, wellhead inspections, and equipment condition assessments</p>
              </div>

              <div className="bg-gradient-to-br from-orange-50 to-white p-6 rounded-xl border border-orange-100">
                <Zap className="w-10 h-10 text-orange-600 mb-3" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Tank Farm Audits</h3>
                <p className="text-gray-600">Storage tank inspections, secondary containment checks, and capacity monitoring</p>
              </div>

              <div className="bg-gradient-to-br from-teal-50 to-white p-6 rounded-xl border border-teal-100">
                <MapPin className="w-10 h-10 text-teal-600 mb-3" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Pipeline Integrity</h3>
                <p className="text-gray-600">Right-of-way monitoring, leak detection surveys, and pipeline integrity assessments</p>
              </div>

              <div className="bg-gradient-to-br from-red-50 to-white p-6 rounded-xl border border-red-100">
                <FileText className="w-10 h-10 text-red-600 mb-3" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Environmental Monitoring</h3>
                <p className="text-gray-600">Stormwater compliance, air quality checks, and environmental impact assessments</p>
              </div>

              <div className="bg-gradient-to-br from-yellow-50 to-white p-6 rounded-xl border border-yellow-100">
                <TrendingUp className="w-10 h-10 text-yellow-600 mb-3" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Safety & OSHA Compliance</h3>
                <p className="text-gray-600">Workplace safety audits, equipment safety checks, and regulatory compliance verification</p>
              </div>
            </div>
          </div>
        </section>

        {/* Technical Features */}
        <section className="py-20 bg-gradient-to-br from-gray-900 to-gray-800 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold mb-4">Enterprise-Grade Technology</h2>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto">
                Built on modern infrastructure for reliability and performance
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="text-center">
                <div className="bg-blue-600/20 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4 border border-blue-500">
                  <Route className="w-8 h-8 text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">OSRM Routing</h3>
                <p className="text-gray-400 text-sm">Accurate driving times and distances using real road networks</p>
              </div>

              <div className="text-center">
                <div className="bg-green-600/20 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4 border border-green-500">
                  <Smartphone className="w-8 h-8 text-green-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Mobile Optimized</h3>
                <p className="text-gray-400 text-sm">Responsive design works perfectly on phones and tablets</p>
              </div>

              <div className="text-center">
                <div className="bg-orange-600/20 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4 border border-orange-500">
                  <Globe className="w-8 h-8 text-orange-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Real-Time GPS</h3>
                <p className="text-gray-400 text-sm">Track inspector locations with live position updates</p>
              </div>

              <div className="text-center">
                <div className="bg-teal-600/20 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4 border border-teal-500">
                  <Shield className="w-8 h-8 text-teal-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Secure Cloud</h3>
                <p className="text-gray-400 text-sm">Enterprise-grade security with Supabase infrastructure</p>
              </div>

              <div className="text-center">
                <div className="bg-red-600/20 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4 border border-red-500">
                  <Camera className="w-8 h-8 text-red-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Photo Upload</h3>
                <p className="text-gray-400 text-sm">Document findings with in-app photo capture and storage</p>
              </div>

              <div className="text-center">
                <div className="bg-yellow-600/20 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4 border border-yellow-500">
                  <FileText className="w-8 h-8 text-yellow-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Digital Signatures</h3>
                <p className="text-gray-400 text-sm">Capture inspector signatures directly on any device</p>
              </div>

              <div className="text-center">
                <div className="bg-blue-600/20 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4 border border-blue-500">
                  <Monitor className="w-8 h-8 text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Dark Mode</h3>
                <p className="text-gray-400 text-sm">Full dark mode support for comfortable viewing</p>
              </div>

              <div className="text-center">
                <div className="bg-green-600/20 w-16 h-16 rounded-lg flex items-center justify-center mx-auto mb-4 border border-green-500">
                  <BarChart3 className="w-8 h-8 text-green-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Export Anywhere</h3>
                <p className="text-gray-400 text-sm">CSV and PDF exports for seamless data integration</p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-20 bg-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Frequently Asked Questions</h2>
              <p className="text-xl text-gray-600">
                Everything you need to know about Survey Hub
              </p>
            </div>

            <div className="space-y-4">
              {[
                {
                  q: "How does route optimization work?",
                  a: "Survey Hub uses k-means clustering to intelligently group nearby facilities, then applies the OSRM routing engine to calculate accurate driving times and distances. You can set constraints like max facilities per day or daily hour limits, and the system automatically generates optimized multi-day routes that minimize travel time."
                },
                {
                  q: "Can I use this on mobile devices?",
                  a: "Absolutely! Survey Hub is fully responsive and optimized for mobile use. The survey mode is specifically designed for field inspectors using smartphones, with large touch targets, GPS tracking, and one-tap navigation to Google Maps or Apple Maps."
                },
                {
                  q: "Is my data secure?",
                  a: "Yes. All data is stored in secure Supabase infrastructure with enterprise-grade encryption. We implement row-level security policies, role-based access control, and regular backups. Your facility data, inspections, and team information are protected and only accessible to your organization."
                },
                {
                  q: "Can I customize inspection forms?",
                  a: "Yes, Professional and Enterprise plans include custom inspection template creation. You can design forms specific to your compliance needs with various question types, photo uploads, and digital signature capture."
                },
                {
                  q: "What happens if I exceed my facility limit?",
                  a: "You'll receive a notification when approaching your plan's facility limit. You can either upgrade to a higher tier or contact us to discuss custom pricing for your specific needs. We never automatically charge you without permission."
                },
                {
                  q: "Do you offer training and onboarding?",
                  a: "Yes! All plans include email support with comprehensive documentation. Professional plans get priority support, and Enterprise customers receive dedicated onboarding sessions with an account manager plus ongoing training for your team."
                },
                {
                  q: "Can I import existing facility data?",
                  a: "Yes! You can upload facility lists via CSV with addresses, visit durations, and other metadata. The system automatically geocodes addresses and makes facilities ready for route optimization."
                },
                {
                  q: "Does it work offline?",
                  a: "Inspection forms can be filled out with limited connectivity, and the app will sync data when connection is restored. However, route optimization and map features require an internet connection for accurate routing and geocoding."
                }
              ].map((faq, index) => (
                <div key={index} className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => toggleFaq(index)}
                    className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-100 transition-colors"
                  >
                    <span className="font-semibold text-gray-900 pr-4">{faq.q}</span>
                    {openFaq === index ? (
                      <ChevronUp className="w-5 h-5 text-blue-600 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    )}
                  </button>
                  {openFaq === index && (
                    <div className="px-6 py-4 bg-white border-t border-gray-200">
                      <p className="text-gray-700 leading-relaxed">{faq.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-20 bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 relative overflow-hidden">
          <div className="absolute inset-0 bg-white/10"></div>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
              Start Optimizing Your Field Inspections Today
            </h2>
            <p className="text-xl text-blue-100 mb-10 leading-relaxed">
              Join teams across the country using Survey Hub to reduce travel time,
              complete more inspections, and deliver better results.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={() => navigate('/request-access')}
                className="w-full sm:w-auto px-8 py-4 bg-white text-blue-600 text-lg rounded-lg hover:bg-gray-50 transition-all font-semibold shadow-xl hover:shadow-2xl hover:scale-105"
              >
                Request Access - Free 14-Day Trial
              </button>
              <button
                onClick={() => navigate('/login')}
                className="w-full sm:w-auto px-8 py-4 bg-blue-500 text-white text-lg rounded-lg hover:bg-blue-400 transition-all font-semibold border-2 border-white/20"
              >
                Sign In
              </button>
            </div>
            <p className="mt-6 text-blue-200 text-sm">
              No credit card required • Cancel anytime • Setup in minutes
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-blue-600 p-2 rounded-lg">
                  <Route className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold">Survey Hub</p>
                  <p className="text-xs text-gray-400">by BEAR DATA</p>
                </div>
              </div>
              <p className="text-gray-400 text-sm">
                Intelligent route planning and digital inspections for field teams.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Use Cases</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Documentation</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Support</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Get Started</h4>
              <button
                onClick={() => navigate('/request-access')}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium mb-3"
              >
                Request Access
              </button>
              <button
                onClick={() => navigate('/login')}
                className="w-full px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium border border-gray-700"
              >
                Sign In
              </button>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-8 text-center text-sm text-gray-400">
            <p>&copy; {new Date().getFullYear()} BEAR DATA. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
