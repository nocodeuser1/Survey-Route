import { useState } from 'react';
import { X, Calendar, DollarSign } from 'lucide-react';

interface SoldFacilitiesModalProps {
    count: number;
    onClose: () => void;
    onConfirm: (soldDate: string) => void;
    isSubmitting: boolean;
}

export default function SoldFacilitiesModal({ count, onClose, onConfirm, isSubmitting }: SoldFacilitiesModalProps) {
    const [soldDate, setSoldDate] = useState(new Date().toISOString().split('T')[0]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-green-100 rounded-lg">
                            <DollarSign className="w-5 h-5 text-green-600" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900">
                            Mark as Sold
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="space-y-4">
                    <p className="text-gray-600">
                        You are about to mark <span className="font-semibold">{count} facility{count !== 1 ? 's' : ''}</span> as sold.
                        These facilities will be archived and hidden from the main map and lists, but can be restored later.
                    </p>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Sold Date
                        </label>
                        <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type="date"
                                value={soldDate}
                                onChange={(e) => setSoldDate(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                    </div>

                    <div className="flex gap-3 mt-6">
                        <button
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => onConfirm(soldDate)}
                            disabled={isSubmitting}
                            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isSubmitting ? 'Processing...' : 'Mark as Sold'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
