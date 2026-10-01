import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiDollarSign, FiSearch, FiLoader, FiArrowUpRight, FiCheckCircle, FiX } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import CardShell from '../UserCategories/components/CardShell';
import adminWorkerService from '@sp/services/adminWorkerService';

const WorkerPayments = () => {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // The worker whose money movements are open, and what was loaded for them.
  const [history, setHistory] = useState(null);

  const openHistory = async (worker) => {
    setHistory({ worker, loading: true, data: null });
    try {
      const response = await adminWorkerService.getWorkerEarnings(worker._id || worker.id);
      setHistory({ worker, loading: false, data: response?.data || null });
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Could not load the history');
      setHistory(null);
    }
  };

  const loadPayments = async () => {
    try {
      setLoading(true);
      const response = await adminWorkerService.getWorkerPayments();
      if (response.success) {
        setWorkers(response.data);
      }
    } catch (error) {
      console.error('Error loading worker payments:', error);
      toast.error('Failed to load worker payments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayments();
  }, []);

  const filteredWorkers = workers.filter(w =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    w.phone.includes(searchQuery)
  );

  return (
    <div className="space-y-6">
      <CardShell
        icon={FiDollarSign}
      >
        {/* Search */}
        <div className="mb-6 max-w-md">
          <div className="relative">
            <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
              <FiSearch className="w-5 h-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search worker by name or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Payments Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <FiLoader className="w-8 h-8 text-gray-400 animate-spin mr-3" />
              <span className="text-gray-600">Loading payment data...</span>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b-2 border-gray-200">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Worker</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Service</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Wallet Balance</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Total Earnings</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkers.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-4 py-8 text-center text-gray-500">No payment records found</td>
                  </tr>
                ) : (
                  filteredWorkers.map((worker) => (
                    <tr key={worker._id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-gray-900">{worker.name}</span>
                          <span className="text-xs text-gray-500">{worker.phone}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">{worker.serviceCategory}</td>
                      <td className="px-4 py-4">
                        <span className={`font-bold ${worker.wallet?.balance > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                          ₹{(worker.wallet?.balance || 0).toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">₹{(worker.wallet?.totalEarnings || 0).toLocaleString()}</td>
                      <td className="px-4 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${worker.approvalStatus === 'approved' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                          {worker.approvalStatus.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <button
                          className="flex items-center gap-1 text-primary-600 font-semibold hover:underline"
                          onClick={() => openHistory(worker)}
                        >
                          View History <FiArrowUpRight className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </CardShell>

      {history && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-gray-900">{history.worker.name}: payment history</h3>
                {history.data && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    Balance ₹{history.data.wallet.balance.toLocaleString()} · Lifetime earnings ₹{history.data.wallet.totalEarnings.toLocaleString()} · Dues ₹{history.data.wallet.dues.toLocaleString()}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setHistory(null)} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100" aria-label="Close">
                <FiX className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
              {history.loading ? (
                <div className="flex justify-center py-10"><FiLoader className="h-6 w-6 animate-spin text-gray-400" /></div>
              ) : !history.data?.transactions?.length ? (
                <p className="py-10 text-center text-sm text-gray-500">No transactions yet.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase text-gray-500">
                      <th className="py-2">Date</th>
                      <th className="py-2">What</th>
                      <th className="py-2">Status</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {history.data.transactions.map((t) => (
                      <tr key={t._id}>
                        <td className="py-2 text-gray-600">{new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td className="py-2 text-gray-800">{t.description || t.type.replace(/_/g, ' ')}</td>
                        <td className="py-2 text-gray-600">{t.status}</td>
                        <td className="py-2 text-right font-semibold text-gray-900">₹{(Number(t.amount) || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkerPayments;

