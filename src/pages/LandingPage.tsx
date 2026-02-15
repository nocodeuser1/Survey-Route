import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEffect, useState, useRef, useCallback } from 'react';
import { Route, Star, CheckCircle, ArrowRight, Shield, Zap, BarChart3, Smartphone, Globe, Menu, X, ChevronRight, Camera, FileText, Navigation, Upload, MapPin, TrendingUp, Monitor, ChevronUp, ChevronDown, Mic, Wifi, WifiOff, ClipboardList, Settings, Layers, Headphones, Fingerprint } from 'lucide-react';
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

// ─── useScrollAnimation ───────────────────────────────────────────────
function useScrollAnimation(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.unobserve(el); } },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, isVisible };
}

// ─── useCountUp ───────────────────────────────────────────────────────
function useCountUp(end: number, duration = 2000, trigger = false, suffix = '', isText = false, textValue = '') {
  const [display, setDisplay] = useState(isText ? '' : '0');

  useEffect(() => {
    if (!trigger) return;
    if (isText) {
      // For text values like "Zero", "Instant", just reveal after a short delay
      const t = setTimeout(() => setDisplay(textValue), 400);
      return () => clearTimeout(t);
    }
    let start = 0;
    const startTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * end);
      if (current !== start) {
        start = current;
        setDisplay(`${current}${suffix}`);
      }
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [trigger, end, duration, suffix, isText, textValue]);

  return display;
}

// ─── MapMockup ────────────────────────────────────────────────────────
function MapMockup() {
  return (
    <div className="bg-gray-100 rounded-2xl overflow-hidden shadow-2xl border border-gray-200">
      {/* Browser chrome */}
      <div className="bg-gray-800 px-4 py-2.5 flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-500" />
        </div>
        <div className="flex-1 bg-gray-700 rounded-md px-3 py-1 text-xs text-gray-400 ml-2">app.survey-route.com/map</div>
      </div>
      {/* Stats bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-gray-900">Route Planner</span>
          <span className="text-blue-600 font-medium">Day 1 of 3</span>
        </div>
        <div className="flex items-center gap-3 text-gray-500">
          <span>12 stops</span>
          <span>•</span>
          <span>142 mi</span>
          <span>•</span>
          <span className="text-green-600 font-medium">Optimized</span>
        </div>
      </div>
      {/* Map area */}
      <div className="relative h-64 bg-gradient-to-br from-green-100 via-emerald-50 to-green-200 overflow-hidden">
        {/* Grid lines for map feel */}
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0,0,0,0.04)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#mapGrid)" />
          {/* Route lines */}
          <path d="M 60 200 Q 100 160 140 130 T 220 100 T 300 80 T 380 110" fill="none" stroke="#3b82f6" strokeWidth="3" strokeDasharray="none" opacity="0.8" />
          <path d="M 380 110 Q 400 140 350 170 T 280 200 T 200 220" fill="none" stroke="#3b82f6" strokeWidth="3" opacity="0.5" />
        </svg>
        {/* Facility pins */}
        <div className="absolute top-12 left-16 flex flex-col items-center">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg ring-2 ring-white">1</div>
          <div className="mt-1 bg-white px-2 py-0.5 rounded text-[10px] font-medium shadow text-gray-700">Well A-12</div>
        </div>
        <div className="absolute top-20 left-[40%] flex flex-col items-center">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg ring-2 ring-white">2</div>
          <div className="mt-1 bg-white px-2 py-0.5 rounded text-[10px] font-medium shadow text-gray-700">Tank Farm</div>
        </div>
        <div className="absolute top-8 right-[25%] flex flex-col items-center">
          <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg ring-2 ring-white">3</div>
          <div className="mt-1 bg-white px-2 py-0.5 rounded text-[10px] font-medium shadow text-gray-700">Pipeline X</div>
        </div>
        <div className="absolute bottom-16 right-[15%] flex flex-col items-center">
          <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg ring-2 ring-white">4</div>
          <div className="mt-1 bg-white px-2 py-0.5 rounded text-[10px] font-medium shadow text-gray-700">Compressor</div>
        </div>
        <div className="absolute bottom-12 left-[30%] flex flex-col items-center">
          <div className="w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg ring-2 ring-white">5</div>
          <div className="mt-1 bg-white px-2 py-0.5 rounded text-[10px] font-medium shadow text-gray-700">Well B-7</div>
        </div>
        {/* Floating action bar */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur rounded-xl shadow-xl px-4 py-2 flex items-center gap-3 border border-gray-200">
          <button className="bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">Optimize</button>
          <button className="text-xs text-gray-600 font-medium px-2 py-1.5">Add Stop</button>
          <button className="text-xs text-gray-600 font-medium px-2 py-1.5">Export</button>
        </div>
      </div>
    </div>
  );
}

// ─── SurveySettingsMockup ─────────────────────────────────────────────
function SurveySettingsMockup() {
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">Survey Configuration</h3>
          <p className="text-xs text-gray-500">Tank Farm Audit — 22 fields</p>
        </div>
        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full font-medium">Custom</span>
      </div>
      <div className="divide-y divide-gray-100">
        {[
          { name: 'Tank ID', type: 'Text', voice: true, photo: false },
          { name: 'Tank Condition', type: 'Dropdown', voice: true, photo: true },
          { name: 'Fluid Level (%)', type: 'Number', voice: true, photo: false },
          { name: 'Secondary Containment', type: 'Checkbox', voice: false, photo: true },
          { name: 'Corrosion Notes', type: 'Text', voice: true, photo: true },
          { name: 'Photo Evidence', type: 'Photo', voice: false, photo: true },
        ].map((field, i) => (
          <div key={i} className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                {i + 1}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{field.name}</p>
                <p className="text-xs text-gray-400">{field.type}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-7 h-4 rounded-full flex items-center ${field.voice ? 'bg-blue-600 justify-end' : 'bg-gray-200 justify-start'}`}>
                <div className="w-3 h-3 rounded-full bg-white shadow mx-0.5" />
              </div>
              <Mic className={`w-3.5 h-3.5 ${field.voice ? 'text-blue-600' : 'text-gray-300'}`} />
              <div className={`w-7 h-4 rounded-full flex items-center ${field.photo ? 'bg-green-600 justify-end' : 'bg-gray-200 justify-start'}`}>
                <div className="w-3 h-3 rounded-full bg-white shadow mx-0.5" />
              </div>
              <Camera className={`w-3.5 h-3.5 ${field.photo ? 'text-green-600' : 'text-gray-300'}`} />
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
        <button className="text-xs text-purple-600 font-medium">+ Add Field</button>
        <span className="text-xs text-gray-400">Drag to reorder</span>
      </div>
    </div>
  );
}

// ─── HandsFreeMockup ──────────────────────────────────────────────────
function HandsFreeMockup() {
  return (
    <div className="bg-gray-950 rounded-2xl shadow-2xl border border-gray-800 overflow-hidden">
      {/* Top bar */}
      <div className="px-5 py-3 flex items-center justify-between border-b border-gray-800">
        <span className="text-xs text-gray-500 font-medium">SPCC Inspection — Well A-12</span>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs text-red-400 font-medium">LISTENING</span>
        </div>
      </div>
      {/* Current field */}
      <div className="px-5 py-4">
        <p className="text-xs text-gray-500 mb-1">Field 3 of 14</p>
        <p className="text-lg text-white font-semibold mb-2">Secondary Containment Status</p>
        <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
          <p className="text-green-400 text-sm font-mono">"Secondary containment is intact, no visible cracks or leaks around the berm..."</p>
        </div>
      </div>
      {/* Waveform */}
      <div className="px-5 py-3 flex items-center justify-center gap-[3px]">
        {[...Array(40)].map((_, i) => {
          const height = Math.sin(i * 0.5) * 12 + Math.random() * 10 + 6;
          return (
            <div
              key={i}
              className="w-[3px] rounded-full bg-blue-500"
              style={{
                height: `${height}px`,
                opacity: 0.4 + Math.random() * 0.6,
              }}
            />
          );
        })}
      </div>
      {/* Bottom controls */}
      <div className="px-5 py-4 flex items-center justify-between border-t border-gray-800">
        <button className="text-xs text-gray-500 font-medium">← Previous</button>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center border border-gray-700">
            <Camera className="w-5 h-5 text-gray-400" />
          </div>
        </div>
        <button className="text-xs text-blue-400 font-medium">Next →</button>
      </div>
    </div>
  );
}

// ─── RouteMapMockup (for feature section) ─────────────────────────────
function RouteMapMockup() {
  return (
    <div className="bg-gray-100 rounded-2xl overflow-hidden shadow-2xl border border-gray-200">
      {/* Stats bar */}
      <div className="bg-white px-4 py-3 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900">3</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Days</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-blue-600">24</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Stops</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-green-600">267</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Miles</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-orange-600">-41%</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Savings</p>
          </div>
        </div>
      </div>
      {/* Map */}
      <div className="relative h-56 bg-gradient-to-br from-green-100 via-emerald-50 to-teal-100 overflow-hidden">
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="routeGrid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(0,0,0,0.03)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#routeGrid)" />
          {/* Day 1 route - blue */}
          <path d="M 40 180 Q 80 140 120 120 T 180 90 T 220 70" fill="none" stroke="#3b82f6" strokeWidth="3" opacity="0.8" />
          {/* Day 2 route - green */}
          <path d="M 200 160 Q 250 130 300 110 T 370 90" fill="none" stroke="#22c55e" strokeWidth="3" opacity="0.8" />
          {/* Day 3 route - orange */}
          <path d="M 150 200 Q 200 190 250 200 T 350 180" fill="none" stroke="#f97316" strokeWidth="3" opacity="0.8" />
        </svg>
        {/* Day markers */}
        <div className="absolute top-10 left-12">
          <div className="w-5 h-5 bg-blue-600 rounded-full ring-2 ring-white shadow" />
        </div>
        <div className="absolute top-16 left-[35%]">
          <div className="w-5 h-5 bg-blue-600 rounded-full ring-2 ring-white shadow" />
        </div>
        <div className="absolute top-8 left-[50%]">
          <div className="w-5 h-5 bg-blue-600 rounded-full ring-2 ring-white shadow" />
        </div>
        <div className="absolute top-[45%] left-[55%]">
          <div className="w-5 h-5 bg-green-600 rounded-full ring-2 ring-white shadow" />
        </div>
        <div className="absolute top-[35%] right-[20%]">
          <div className="w-5 h-5 bg-green-600 rounded-full ring-2 ring-white shadow" />
        </div>
        <div className="absolute bottom-10 left-[40%]">
          <div className="w-5 h-5 bg-orange-500 rounded-full ring-2 ring-white shadow" />
        </div>
        <div className="absolute bottom-6 right-[18%]">
          <div className="w-5 h-5 bg-orange-500 rounded-full ring-2 ring-white shadow" />
        </div>
        {/* Legend */}
        <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur rounded-lg px-3 py-2 flex items-center gap-3 text-[10px] font-medium shadow">
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-blue-600" /> Day 1</div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-green-600" /> Day 2</div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Day 3</div>
        </div>
      </div>
    </div>
  );
}

// ─── Topographic SVG Pattern ──────────────────────────────────────────
const topoPatternSvg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Cg fill='none' stroke='%233b82f6' stroke-width='0.8' opacity='0.07'%3E%3Cellipse cx='200' cy='200' rx='180' ry='120'/%3E%3Cellipse cx='200' cy='200' rx='150' ry='100'/%3E%3Cellipse cx='200' cy='200' rx='120' ry='80'/%3E%3Cellipse cx='200' cy='200' rx='90' ry='60'/%3E%3Cellipse cx='200' cy='200' rx='60' ry='40'/%3E%3Cellipse cx='200' cy='200' rx='30' ry='20'/%3E%3Cellipse cx='100' cy='320' rx='120' ry='80'/%3E%3Cellipse cx='100' cy='320' rx='90' ry='60'/%3E%3Cellipse cx='100' cy='320' rx='60' ry='40'/%3E%3Cellipse cx='320' cy='100' rx='100' ry='70'/%3E%3Cellipse cx='320' cy='100' rx='70' ry='50'/%3E%3Cellipse cx='320' cy='100' rx='40' ry='28'/%3E%3C/g%3E%3C/svg%3E")`;

// ─── Scroll animation styles ─────────────────────────────────────────
const animationStyles = `
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(32px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes waveform {
  0%, 100% { transform: scaleY(0.5); }
  50% { transform: scaleY(1); }
}
html { scroll-behavior: smooth; }
.animate-fade-in-up {
  animation: fadeInUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.card-hover {
  transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.25s ease;
}
.card-hover:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 40px -12px rgba(0,0,0,0.15);
}
.glass-card {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.3);
}
`;

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [isAnnual, setIsAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [products, setProducts] = useState<StripeProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const { createCheckoutSession, loading: checkoutLoading } = useStripeCheckout();
  const [showMobileCta, setShowMobileCta] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  // Scroll animations for each section
  const hero = useScrollAnimation(0.1);
  const socialProof = useScrollAnimation();
  const featureCustom = useScrollAnimation();
  const featureHandsFree = useScrollAnimation();
  const featureRoute = useScrollAnimation();
  const featureGrid = useScrollAnimation();
  const howItWorks = useScrollAnimation();
  const stats = useScrollAnimation();
  const pricing = useScrollAnimation();
  const useCases = useScrollAnimation();
  const techFeatures = useScrollAnimation();
  const faq = useScrollAnimation();
  const finalCta = useScrollAnimation();

  // Counter values
  const count100 = useCountUp(100, 2000, stats.isVisible, '%');
  const count40 = useCountUp(40, 2000, stats.isVisible, '%');
  const countZero = useCountUp(0, 0, stats.isVisible, '', true, 'Zero');
  const countInstant = useCountUp(0, 0, stats.isVisible, '', true, 'Instant');
  const countYour = useCountUp(0, 0, stats.isVisible, '', true, 'Your');
  const countMulti = useCountUp(0, 0, stats.isVisible, '', true, 'Multi-Site');

  // Sticky mobile CTA: show after scrolling past hero
  useEffect(() => {
    const onScroll = () => {
      if (heroRef.current) {
        const rect = heroRef.current.getBoundingClientRect();
        setShowMobileCta(rect.bottom < 0);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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
        borderColor: 'border-gray-200/50',
        buttonClass: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
      },
      professional: {
        color: 'text-blue-600',
        borderColor: 'border-blue-400/50 ring-2 ring-blue-400/20',
        buttonClass: 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg hover:shadow-xl',
        popular: true,
      },
      enterprise: {
        color: 'text-gray-900',
        borderColor: 'border-gray-200/50',
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

  const sectionClass = (visible: boolean, delay = 0) =>
    `transition-opacity duration-700 ${visible ? 'animate-fade-in-up' : 'opacity-0'}`;

  return (
    <div className="min-h-screen bg-white">
      <style>{animationStyles}</style>

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-12 sm:h-16">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="bg-blue-600 p-1.5 sm:p-2 rounded-lg shadow-md flex-shrink-0">
                <Route className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-xl font-bold text-gray-900 truncate">Survey-Route</h1>
                <p className="text-[10px] sm:text-xs text-gray-500 hidden sm:block">by BEAR DATA</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
              <button
                onClick={() => navigate('/login')}
                className="px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-base text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                Sign In
              </button>
              <button
                onClick={() => navigate('/request-access')}
                className="px-3 sm:px-6 py-1.5 sm:py-2 text-xs sm:text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-medium shadow-md hover:shadow-lg whitespace-nowrap"
              >
                Request Access
              </button>
            </div>
          </div>
        </div>
      </header>

      <main>
        {/* ══════════ HERO ══════════ */}
        <section
          ref={heroRef}
          className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-green-50"
          style={{ backgroundImage: topoPatternSvg, backgroundSize: '400px 400px' }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/50 to-transparent pointer-events-none" />
          <div ref={hero.ref} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-24 relative ${sectionClass(hero.isVisible)}`}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              {/* Left: Text */}
              <div>
                <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                  <Star className="w-4 h-4" />
                  Trusted for inspections nationwide
                </div>
                <h2 className="text-3xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                  Complete Facility Inspections{' '}
                  <span
                    className="block mt-2"
                    style={{
                      background: 'linear-gradient(135deg, #2563eb 0%, #06b6d4 50%, #3b82f6 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }}
                  >
                    Stay Compliant & Efficient
                  </span>
                </h2>
                <p className="text-base sm:text-lg md:text-xl text-gray-600 mb-8 leading-relaxed">
                  The complete platform for environmental compliance, safety inspections, and facility management.
                  Digital forms, photo documentation, and intelligent route planning in one solution.
                </p>
                <div className="flex flex-col sm:flex-row items-start gap-4 mb-8">
                  <button
                    onClick={() => navigate('/request-access')}
                    className="w-full sm:w-auto px-8 py-4 bg-blue-600 text-white text-lg rounded-xl hover:bg-blue-700 transition-all font-semibold shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Get Started Free
                  </button>
                  <button
                    onClick={() => navigate('/login')}
                    className="w-full sm:w-auto px-8 py-4 bg-white text-blue-600 text-lg rounded-xl hover:bg-gray-50 transition-all font-semibold border-2 border-gray-200 shadow-md"
                  >
                    Sign In
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-6 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span>No credit card required</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span>14-day free trial</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span>Cancel anytime</span>
                  </div>
                </div>
              </div>
              {/* Right: App Mockup */}
              <div className="hidden lg:block">
                <MapMockup />
              </div>
            </div>
          </div>
        </section>

        {/* ══════════ SOCIAL PROOF ══════════ */}
        <section className="py-10 sm:py-16 bg-gray-50 border-y border-gray-200">
          <div ref={socialProof.ref} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${sectionClass(socialProof.isVisible)}`}>
            <p className="text-center text-sm text-gray-400 font-medium uppercase tracking-wider mb-8">Trusted by inspection teams at</p>
            <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12 mb-12">
              {[
                { name: 'ACME OIL', icon: '▲' },
                { name: 'PLAINS ENERGY', icon: '◆' },
                { name: 'MIDWEST PIPELINE', icon: '━' },
                { name: 'EAGLE ENVIRONMENTAL', icon: '▶' },
                { name: 'SUMMIT RESOURCES', icon: '▲' },
              ].map((co) => (
                <div key={co.name} className="flex items-center gap-2 text-gray-300 hover:text-gray-400 transition-colors">
                  <span className="text-xl">{co.icon}</span>
                  <span className="text-sm sm:text-base font-bold tracking-wider whitespace-nowrap">{co.name}</span>
                </div>
              ))}
            </div>
            {/* Testimonial */}
            <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-md border border-gray-100 p-6 sm:p-8">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                ))}
              </div>
              <blockquote className="text-gray-700 text-lg leading-relaxed mb-6">
                "Survey-Route cut our average inspection time by 35% and eliminated the paper shuffle completely.
                The route optimization alone saves each inspector 2+ hours of driving per day.
                We went from dreading SPCC audits to being fully prepared in minutes."
              </blockquote>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                  JT
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Jake Thompson</p>
                  <p className="text-sm text-gray-500">Field Operations Manager, Plains Energy</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══════════ FEATURE 1: Custom Survey Types (text left, mockup right) ══════════ */}
        <section className="py-14 sm:py-24 bg-white overflow-hidden">
          <div ref={featureCustom.ref} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${sectionClass(featureCustom.isVisible)}`}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-purple-100 text-purple-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                  <Settings className="w-4 h-4" />
                  Fully Configurable
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">
                  Your Surveys, Your Way
                </h2>
                <p className="text-lg text-gray-600 mb-8 leading-relaxed">
                  Every company has different inspection needs. Survey-Route lets you create any survey type with any fields —
                  no coding required. If you can put it on a clipboard, you can put it in the app.
                </p>
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="bg-purple-100 w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <ClipboardList className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">12+ Field Types</h4>
                      <p className="text-gray-600">Text, numbers, dates, dropdowns, multi-select, checkboxes, photos, signatures, locations, ratings — and more coming.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="bg-purple-100 w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Layers className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Survey-Specific Views</h4>
                      <p className="text-gray-600">Switch between survey types and the entire app filters — facilities, map, and forms show only what's relevant to that survey.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="bg-purple-100 w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Shield className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">System + Custom Types</h4>
                      <p className="text-gray-600">SPCC Plan and SPCC Inspection come pre-built with all the right fields. Add your own survey types alongside them.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <SurveySettingsMockup />
              </div>
            </div>
          </div>
        </section>

        {/* ══════════ FEATURE 2: Hands-Free Mode (mockup left, text right) ══════════ */}
        <section className="py-14 sm:py-24 bg-gradient-to-br from-gray-50 to-white overflow-hidden">
          <div ref={featureHandsFree.ref} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${sectionClass(featureHandsFree.isVisible)}`}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              <div className="order-2 lg:order-1">
                <HandsFreeMockup />
              </div>
              <div className="order-1 lg:order-2">
                <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                  <Mic className="w-4 h-4" />
                  Voice-Powered
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">
                  Hands-Free Inspection Mode
                </h2>
                <p className="text-lg text-gray-600 mb-8 leading-relaxed">
                  Go hands-free in the field — just talk. Voice recognition fills in fields, voice commands snap photos and navigate between fields.
                  Say "take a picture" and the system captures, auto-captions from your speech, and maps it to the right field.
                </p>
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="bg-indigo-100 w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Mic className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Continuous Listening</h4>
                      <p className="text-gray-600">Speech-to-text fills fields in real time. No tap-to-talk — it just works while you inspect.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="bg-indigo-100 w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Camera className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Voice-Triggered Camera</h4>
                      <p className="text-gray-600">Say "take a picture" and photos are auto-captioned from what you were just saying and mapped to the correct field.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="bg-indigo-100 w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Headphones className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Perfect for Safety Gear</h4>
                      <p className="text-gray-600">Wearing gloves, hard hats, or FR gear? No problem. Complete inspections without touching the screen.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══════════ FEATURE 3: Smart Route Planning (text left, mockup right) ══════════ */}
        <section className="py-14 sm:py-24 bg-white overflow-hidden">
          <div ref={featureRoute.ref} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${sectionClass(featureRoute.isVisible)}`}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-teal-100 text-teal-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                  <Route className="w-4 h-4" />
                  Intelligent Routing
                </div>
                <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">
                  Smart Route Planning
                </h2>
                <p className="text-lg text-gray-600 mb-8 leading-relaxed">
                  Automatically optimize multi-day routes across well sites, tank farms, and facilities.
                  Reduce travel time by 40% with intelligent routing. Save, load, and share route plans across your team.
                </p>
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="bg-teal-100 w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Navigation className="w-5 h-5 text-teal-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Multi-Day Optimization</h4>
                      <p className="text-gray-600">K-means clustering groups nearby facilities, then OSRM calculates accurate driving times across real road networks.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="bg-teal-100 w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <MapPin className="w-5 h-5 text-teal-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">One-Tap Navigation</h4>
                      <p className="text-gray-600">GPS-enabled survey mode shows nearby facilities. One tap opens Google or Apple Maps for turn-by-turn directions.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="bg-teal-100 w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <BarChart3 className="w-5 h-5 text-teal-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Team Route Sharing</h4>
                      <p className="text-gray-600">Save, load, and share route plans across your team. Assign routes to inspectors and track completion.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <RouteMapMockup />
              </div>
            </div>
          </div>
        </section>

        {/* ══════════ REMAINING FEATURES GRID ══════════ */}
        <section className="py-10 sm:py-20 bg-gradient-to-br from-gray-50 to-white border-y border-gray-200">
          <div ref={featureGrid.ref} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${sectionClass(featureGrid.isVisible)}`}>
            <div className="text-center mb-8 sm:mb-16">
              <h2 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-2 sm:mb-4">Built for Oil & Gas Compliance</h2>
              <p className="text-sm sm:text-xl text-gray-600 max-w-3xl mx-auto">
                Everything you need for SPCC inspections, environmental monitoring, safety audits, and regulatory compliance.
              </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-8">
              {[
                { icon: Shield, color: 'blue', title: 'SPCC & Environmental Compliance', desc: 'Built-in SPCC Plan and SPCC Inspection workflows with pre-configured fields. Track completion status, deadlines, PE stamp dates, and maintain complete compliance records.' },
                { icon: Camera, color: 'green', title: 'Photo Documentation', desc: 'Capture and store photo evidence with GPS tagging and timestamps. Photos auto-attach to the right inspection field based on context.' },
                { icon: Navigation, color: 'red', title: 'Real-Time Field Navigation', desc: 'GPS-enabled survey mode shows nearby facilities with distances and bearings. One-tap navigation to Google/Apple Maps.' },
                { icon: FileText, color: 'orange', title: 'Digital Signatures & Audit Trail', desc: 'Inspector certification with digital signatures. Complete audit trail of who inspected what and when.' },
                { icon: WifiOff, color: 'cyan', title: 'Offline-First', desc: 'Work without cell service — routes, maps, and inspections are cached locally. Changes sync automatically when connectivity returns.' },
                { icon: BarChart3, color: 'yellow', title: 'Compliance Reporting', desc: 'Generate professional inspection reports with photos and signatures. Export full local backups of all your data for safekeeping.' },
              ].map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.title} className={`card-hover bg-gradient-to-br from-${f.color}-50 to-white rounded-xl p-4 sm:p-8 border border-${f.color}-100 shadow-sm`}>
                    <div className={`bg-${f.color}-600 w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center mb-3 sm:mb-4 shadow-md`}>
                      <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                    </div>
                    <h3 className="text-sm sm:text-xl font-semibold text-gray-900 mb-1 sm:mb-3">{f.title}</h3>
                    <p className="text-xs sm:text-base text-gray-600 leading-relaxed line-clamp-2 sm:line-clamp-none">{f.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ══════════ HOW IT WORKS ══════════ */}
        <section className="py-10 sm:py-20 bg-white">
          <div ref={howItWorks.ref} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${sectionClass(howItWorks.isVisible)}`}>
            <div className="text-center mb-8 sm:mb-16">
              <h2 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-2 sm:mb-4">How It Works</h2>
              <p className="text-sm sm:text-xl text-gray-600 max-w-3xl mx-auto">
                Four simple steps to transform your field inspection workflow
              </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-8">
              {[
                { n: 1, color: 'blue', icon: Upload, title: 'Upload Facilities', desc: 'Import your facility list via CSV with addresses and visit durations' },
                { n: 2, color: 'green', icon: MapPin, title: 'Configure Teams', desc: 'Set up team home bases and assign facilities to different inspection teams' },
                { n: 3, color: 'orange', icon: Route, title: 'Generate Routes', desc: 'Click optimize and instantly get multi-day routes with driving times' },
                { n: 4, color: 'teal', icon: CheckCircle, title: 'Complete Inspections', desc: 'Use survey mode in the field to navigate, inspect, and generate reports' },
              ].map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.n} className="text-center card-hover">
                    <div className={`relative inline-flex items-center justify-center w-14 h-14 sm:w-20 sm:h-20 bg-${step.color}-600 text-white rounded-full text-xl sm:text-2xl font-bold mb-3 sm:mb-4 shadow-lg`}>
                      {step.n}
                    </div>
                    <div className="bg-white rounded-lg p-3 sm:p-6 shadow-md border border-gray-200 h-full">
                      <Icon className={`w-8 h-8 text-${step.color}-600 mx-auto mb-3`} />
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
                      <p className="text-gray-600">{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ══════════ STATS / BENEFITS (animated counters) ══════════ */}
        <section className="py-10 sm:py-20 bg-gradient-to-br from-gray-50 to-white">
          <div ref={stats.ref} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${sectionClass(stats.isVisible)}`}>
            <div className="text-center mb-8 sm:mb-16">
              <h2 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-2 sm:mb-4">Proven Results for Oil & Gas Operations</h2>
              <p className="text-sm sm:text-xl text-gray-600 max-w-3xl mx-auto">
                Stay compliant, improve efficiency, and reduce operational costs
              </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-8">
              <div className="card-hover text-center p-4 sm:p-8 bg-gradient-to-br from-blue-50 to-white rounded-xl border border-blue-100">
                <div className="text-3xl sm:text-5xl font-bold text-blue-600 mb-2">{count100 || '0%'}</div>
                <div className="text-gray-900 font-semibold mb-2">Audit Ready</div>
                <div className="text-gray-600">Complete digital records with photos, signatures, and timestamps for regulatory compliance</div>
              </div>

              <div className="card-hover text-center p-4 sm:p-8 bg-gradient-to-br from-green-50 to-white rounded-xl border border-green-100">
                <div className="text-3xl sm:text-5xl font-bold text-green-600 mb-2">{countZero || '—'}</div>
                <div className="text-gray-900 font-semibold mb-2">Missed Inspections</div>
                <div className="text-gray-600">Track compliance deadlines and inspection status across all facilities in real-time</div>
              </div>

              <div className="card-hover text-center p-4 sm:p-8 bg-gradient-to-br from-orange-50 to-white rounded-xl border border-orange-100">
                <div className="text-3xl sm:text-5xl font-bold text-orange-600 mb-2">{count40 || '0%'}</div>
                <div className="text-gray-900 font-semibold mb-2">Reduced Travel</div>
                <div className="text-gray-600">Smart route optimization minimizes miles driven and fuel costs</div>
              </div>

              <div className="card-hover text-center p-4 sm:p-8 bg-gradient-to-br from-teal-50 to-white rounded-xl border border-teal-100">
                <div className="text-3xl sm:text-5xl font-bold text-teal-600 mb-2">{countInstant || '—'}</div>
                <div className="text-gray-900 font-semibold mb-2">Report Generation</div>
                <div className="text-gray-600">Professional inspection reports with photos and signatures in seconds</div>
              </div>

              <div className="card-hover text-center p-4 sm:p-8 bg-gradient-to-br from-red-50 to-white rounded-xl border border-red-100">
                <div className="text-3xl sm:text-5xl font-bold text-red-600 mb-2">{countYour || '—'}</div>
                <div className="text-gray-900 font-semibold mb-2">Data, Your Backups</div>
                <div className="text-gray-600">Enterprise-grade cloud security plus export your own local backups anytime — your company always owns its data</div>
              </div>

              <div className="card-hover text-center p-4 sm:p-8 bg-gradient-to-br from-yellow-50 to-white rounded-xl border border-yellow-100">
                <div className="text-3xl sm:text-5xl font-bold text-yellow-600 mb-2">{countMulti || '—'}</div>
                <div className="text-gray-900 font-semibold mb-2">Management</div>
                <div className="text-gray-600">Manage inspections across hundreds of facilities from one platform</div>
              </div>
            </div>
          </div>
        </section>

        {/* ══════════ PRICING ══════════ */}
        <section className="py-10 sm:py-20 bg-white">
          <div ref={pricing.ref} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${sectionClass(pricing.isVisible)}`}>
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-2 sm:mb-4">Simple, Transparent Pricing</h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
                Choose the plan that fits your team size. All plans include 14-day free trial.
              </p>

              <div className="inline-flex items-center gap-4 bg-white rounded-lg p-1 shadow-md border border-gray-200">
                <button
                  onClick={() => setIsAnnual(false)}
                  className={`px-6 py-2 rounded-md font-medium transition-all ${!isAnnual ? 'bg-blue-600 text-white shadow-md' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setIsAnnual(true)}
                  className={`px-6 py-2 rounded-md font-medium transition-all ${isAnnual ? 'bg-blue-600 text-white shadow-md' : 'text-gray-600 hover:text-gray-900'}`}
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-8 max-w-6xl mx-auto">
                {products.map((product) => {
                  const config = getTierConfig(product.tier_name);
                  const monthlyPrice = formatPrice(product.monthly_price_amount);
                  const annualPrice = formatPrice(product.annual_price_amount);
                  const annualMonthlyPrice = formatPrice(Math.round(product.annual_price_amount / 12));

                  return (
                    <div
                      key={product.id}
                      className={`glass-card card-hover rounded-2xl shadow-lg ${config.borderColor} p-8 ${config.popular ? 'relative transform scale-105 shadow-2xl' : ''}`}
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

        {/* ══════════ USE CASES ══════════ */}
        <section className="py-10 sm:py-20 bg-gradient-to-br from-gray-50 to-white">
          <div ref={useCases.ref} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${sectionClass(useCases.isVisible)}`}>
            <div className="text-center mb-8 sm:mb-16">
              <h2 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-2 sm:mb-4">Purpose-Built for Oil & Gas</h2>
              <p className="text-sm sm:text-xl text-gray-600 max-w-3xl mx-auto">
                Complete solutions for every type of facility inspection and compliance need
              </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
              {[
                { icon: Shield, color: 'blue', title: 'SPCC Inspections', desc: 'Spill Prevention Control and Countermeasure inspections with customizable checklists and photo documentation' },
                { icon: CheckCircle, color: 'green', title: 'Well Site Inspections', desc: 'Production facility monitoring, wellhead inspections, and equipment condition assessments' },
                { icon: Zap, color: 'orange', title: 'Tank Farm Audits', desc: 'Storage tank inspections, secondary containment checks, and capacity monitoring' },
                { icon: MapPin, color: 'teal', title: 'Pipeline Integrity', desc: 'Right-of-way monitoring, leak detection surveys, and pipeline integrity assessments' },
                { icon: FileText, color: 'red', title: 'Environmental Monitoring', desc: 'Stormwater compliance, air quality checks, and environmental impact assessments' },
                { icon: TrendingUp, color: 'yellow', title: 'Safety & OSHA Compliance', desc: 'Workplace safety audits, equipment safety checks, and regulatory compliance verification' },
              ].map((uc) => {
                const Icon = uc.icon;
                return (
                  <div key={uc.title} className={`card-hover bg-gradient-to-br from-${uc.color}-50 to-white p-3 sm:p-6 rounded-xl border border-${uc.color}-100 shadow-sm`}>
                    <Icon className={`w-7 h-7 sm:w-10 sm:h-10 text-${uc.color}-600 mb-3`} />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">{uc.title}</h3>
                    <p className="text-gray-600">{uc.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ══════════ ENTERPRISE TECH ══════════ */}
        <section className="py-10 sm:py-20 bg-gradient-to-br from-gray-900 to-gray-800 text-white">
          <div ref={techFeatures.ref} className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${sectionClass(techFeatures.isVisible)}`}>
            <div className="text-center mb-8 sm:mb-16">
              <h2 className="text-2xl sm:text-4xl font-bold mb-2 sm:mb-4">Enterprise-Grade Technology</h2>
              <p className="text-sm sm:text-xl text-gray-300 max-w-3xl mx-auto">
                Built on modern infrastructure for reliability and performance
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-8">
              {[
                { icon: Route, color: 'blue', title: 'OSRM Routing', desc: 'Accurate driving times and distances using real road networks' },
                { icon: Smartphone, color: 'green', title: 'Native iOS & Android', desc: 'Real native apps on App Store and Google Play — not just a mobile website' },
                { icon: Globe, color: 'orange', title: 'Real-Time GPS', desc: 'Track inspector locations with live position updates' },
                { icon: Shield, color: 'teal', title: 'Secure Cloud', desc: 'Enterprise-grade security with row-level access control' },
                { icon: Mic, color: 'purple', title: 'Voice Commands', desc: 'Hands-free voice input with speech-to-field mapping and voice-triggered camera' },
                { icon: WifiOff, color: 'cyan', title: 'Works Offline', desc: 'Full offline support with smart sync when connectivity returns' },
                { icon: Camera, color: 'red', title: 'Smart Photos', desc: 'Context-aware photo capture — auto-captions and field assignment from voice' },
                { icon: Layers, color: 'yellow', title: 'Custom Survey Types', desc: 'Create any survey with any fields — 12+ field types, drag-to-reorder' },
                { icon: FileText, color: 'indigo', title: 'Digital Signatures', desc: 'Capture inspector signatures directly on any device' },
                { icon: Monitor, color: 'blue', title: 'Dark Mode', desc: 'Full dark mode support for comfortable viewing anywhere' },
                { icon: BarChart3, color: 'green', title: 'Export & Backup', desc: 'CSV and PDF exports — keep local backups of all your data for safekeeping' },
                { icon: Fingerprint, color: 'orange', title: 'Haptic Feedback', desc: 'Native haptics on photo capture and voice commands — you feel it work' },
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <div key={t.title} className="text-center card-hover p-2">
                    <div className={`bg-${t.color}-600/20 w-12 h-12 sm:w-16 sm:h-16 rounded-lg flex items-center justify-center mx-auto mb-3 sm:mb-4 border border-${t.color}-500`}>
                      <Icon className={`w-6 h-6 sm:w-8 sm:h-8 text-${t.color}-400`} />
                    </div>
                    <h3 className="text-sm sm:text-lg font-semibold mb-1 sm:mb-2 text-white">{t.title}</h3>
                    <p className="text-gray-400 text-sm">{t.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ══════════ FAQ ══════════ */}
        <section className="py-10 sm:py-20 bg-white">
          <div ref={faq.ref} className={`max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 ${sectionClass(faq.isVisible)}`}>
            <div className="text-center mb-8 sm:mb-16">
              <h2 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-2 sm:mb-4">Frequently Asked Questions</h2>
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
                  a: "Yes. All data is stored in secure Supabase infrastructure with enterprise-grade encryption. We implement row-level security policies, role-based access control, and regular backups. Plus, your company can export full local backups of all data at any time — CSV exports of facilities, inspections, survey results, and reports. You always own your data and can keep your own copies for safekeeping."
                },
                {
                  q: "Can I customize inspection forms?",
                  a: "Absolutely. You can create unlimited custom survey types with 12+ field types — text, numbers, dates, dropdowns, multi-select, checkboxes, photos, signatures, locations, and ratings. Each survey type gets its own fields, and the entire app filters to show only relevant data when you switch between survey types. It works like custom fields in a CRM, but built for field inspections."
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
                  a: "Yes — Survey-Route is built offline-first. Routes, map tiles, and inspection data are cached locally using IndexedDB and service workers. You can complete full inspections without cell service, and everything syncs automatically with smart conflict resolution when connectivity returns. This is critical for remote oil fields and rural sites."
                },
                {
                  q: "What is Hands-Free Mode?",
                  a: "Hands-Free Mode lets inspectors complete surveys using just their voice. Continuous speech recognition fills in fields automatically, and voice commands like 'take a picture' trigger the camera instantly. Photos are auto-captioned from what you were just saying and mapped to the correct field. It's configurable per survey type — you choose which fields accept voice input and which accept photos. Perfect for wearing safety gear, gloves, or working in harsh conditions."
                },
                {
                  q: "Is there a native mobile app?",
                  a: "Yes! Survey-Route is available as a native app on both iOS (App Store) and Android (Google Play). The native app gives you access to the device camera with haptic feedback, push notifications, and a smoother experience than a mobile website. It also works as a full web app in any browser."
                }
              ].map((item, index) => (
                <div key={index} className="card-hover bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => toggleFaq(index)}
                    className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-100 transition-colors"
                  >
                    <span className="font-semibold text-gray-900 pr-4">{item.q}</span>
                    {openFaq === index ? (
                      <ChevronUp className="w-5 h-5 text-blue-600 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    )}
                  </button>
                  {openFaq === index && (
                    <div className="px-6 py-4 bg-white border-t border-gray-200">
                      <p className="text-gray-700 leading-relaxed">{item.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══════════ FINAL CTA ══════════ */}
        <section className="py-10 sm:py-20 bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 relative overflow-hidden">
          <div className="absolute inset-0 bg-white/5" />
          {/* Topo pattern on CTA */}
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: topoPatternSvg, backgroundSize: '300px 300px' }} />
          <div ref={finalCta.ref} className={`max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative ${sectionClass(finalCta.isVisible)}`}>
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
                className="w-full sm:w-auto px-8 py-4 bg-white text-blue-600 text-lg rounded-xl hover:bg-gray-50 transition-all font-semibold shadow-xl hover:shadow-2xl hover:scale-[1.02] active:scale-[0.98]"
              >
                Request Access - Free 14-Day Trial
              </button>
              <button
                onClick={() => navigate('/login')}
                className="w-full sm:w-auto px-8 py-4 bg-blue-500 text-white text-lg rounded-xl hover:bg-blue-400 transition-all font-semibold border-2 border-white/20"
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

      {/* ══════════ STICKY MOBILE CTA ══════════ */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-white/95 backdrop-blur-md border-t border-gray-200 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] transition-transform duration-300 ${showMobileCta ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <button
          onClick={() => navigate('/request-access')}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-base shadow-lg hover:bg-blue-700 transition-colors active:scale-[0.98]"
        >
          Get Started Free
        </button>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-8 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-blue-600 p-2 rounded-lg">
                  <Route className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-white">Survey Hub</p>
                  <p className="text-xs text-gray-400">by BEAR DATA</p>
                </div>
              </div>
              <p className="text-gray-400 text-sm">
                Intelligent route planning and digital inspections for field teams.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4 text-white">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Use Cases</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Documentation</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4 text-white">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Support</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4 text-white">Get Started</h4>
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
