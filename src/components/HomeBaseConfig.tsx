import { useState, useEffect } from 'react';
import { Home, Search, MapPin, Save } from 'lucide-react';
import { geocodeAddress } from '../services/osrm';
import { supabase, HomeBase } from '../lib/supabase';

interface HomeBaseConfigProps {
  userId: string;
  accountId: string;
  onSaved?: () => void;
}

export default function HomeBaseConfig({ userId, accountId, onSaved }: HomeBaseConfigProps) {
  const [address, setAddress] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [geocodedLocation, setGeocodedLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentHomeBase, setCurrentHomeBase] = useState<HomeBase | null>(null);

  useEffect(() => {
    loadHomeBase();
  }, [userId]);

  const loadHomeBase = async () => {
    try {
      const { data, error } = await supabase
        .from('home_base')
        .select('*')
        .eq('account_id', accountId)
        .eq('team_number', 1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setCurrentHomeBase(data);
        setAddress(data.address);
        setGeocodedLocation({
          latitude: Number(data.latitude),
          longitude: Number(data.longitude),
        });
      }
    } catch (err) {
      console.error('Error loading home base:', err);
    }
  };

  const handleGeocode = async () => {
    if (!address.trim()) {
      setError('Please enter an address');
      return;
    }

    setIsGeocoding(true);
    setError(null);

    try {
      const location = await geocodeAddress(address);

      if (!location) {
        setError('Could not find location. Please try a more specific address.');
        setGeocodedLocation(null);
      } else {
        setGeocodedLocation(location);
        setError(null);
      }
    } catch (err) {
      setError('Failed to geocode address');
      console.error('Geocoding error:', err);
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleSave = async () => {
    if (!geocodedLocation) {
      setError('Please geocode the address first');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (currentHomeBase) {
        const { error } = await supabase
          .from('home_base')
          .update({
            address,
            latitude: geocodedLocation.latitude,
            longitude: geocodedLocation.longitude,
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', accountId)
          .eq('team_number', 1);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('home_base').insert({
          user_id: userId,
          account_id: accountId,
          address,
          latitude: geocodedLocation.latitude,
          longitude: geocodedLocation.longitude,
          team_number: 1,
          team_label: 'Team 1',
        });

        if (error) throw error;
      }

      await loadHomeBase();
      if (onSaved) onSaved();
    } catch (err: any) {
      const errorMsg = err.message || JSON.stringify(err);
      setError(`Failed to save home base: ${errorMsg}`);
      console.error('Save error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center gap-2 mb-4">
        <Home className="w-5 h-5 text-blue-600" />
        <h2 className="text-xl font-semibold text-gray-800">Home Base Configuration</h2>
      </div>

      {currentHomeBase && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-green-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-800">Current Home Base</p>
              <p className="text-sm text-green-700">{currentHomeBase.address}</p>
              <p className="text-xs text-green-600 mt-1">
                {Number(currentHomeBase.latitude).toFixed(6)}, {Number(currentHomeBase.longitude).toFixed(6)}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
            Home Address
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Enter your home address"
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleGeocode();
              }
            }}
          />
        </div>

        <button
          onClick={handleGeocode}
          disabled={isGeocoding || !address.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          <Search className="w-4 h-4" />
          {isGeocoding ? 'Searching...' : 'Find Location'}
        </button>

        {geocodedLocation && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm font-medium text-blue-800">Location Found</p>
            <p className="text-sm text-blue-700 mt-1">
              Latitude: {geocodedLocation.latitude.toFixed(6)}
              <br />
              Longitude: {geocodedLocation.longitude.toFixed(6)}
            </p>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={isSaving || !geocodedLocation}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'Saving...' : 'Save Home Base'}
        </button>
      </div>
    </div>
  );
}
