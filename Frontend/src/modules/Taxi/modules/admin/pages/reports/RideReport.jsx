import React, { useCallback, useEffect, useState } from 'react';
import { Download, ChevronRight, ArrowLeft, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { adminService } from '../../services/adminService';
import { triggerFileDownload } from '../../../../shared/utils/downloadHelper';

/*
 * Every ride, filtered and on screen, with the same filters as the file.
 *
 * The other taxi reports are download-only forms; rides are what an operator
 * checks most often ("what happened to this ride?"), so this one shows a page of
 * results and totals first and offers the file second.
 */

const STATUSES = ['all', 'searching', 'accepted', 'ongoing', 'completed', 'cancelled'];
const listOf = (response) => {
  const items = response?.data?.results || response?.data || response?.results || [];
  return Array.isArray(items) ? items : [];
};
const money = (value) => `₹${Number(value || 0).toFixed(2)}`;

const RideReport = () => {
  const [filters, setFilters] = useState({
    date_option: 'this_month',
    from_date: '',
    to_date: '',
    status: 'all',
    vehicle_type_id: '',
    service_location_id: '',
    zone_id: '',
    payment_type: '',
  });
  const [page, setPage] = useState(1);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [cities, setCities] = useState([]);
  const [zones, setZones] = useState([]);

  useEffect(() => {
    // Filter options are a convenience: a failed list leaves that filter empty
    // rather than blocking the report.
    adminService.getVehicleTypes().then((r) => setVehicleTypes(listOf(r))).catch(() => setVehicleTypes([]));
    adminService.getServiceLocations().then((r) => setCities(listOf(r))).catch(() => setCities([]));
    adminService.getZones().then((r) => setZones(listOf(r))).catch(() => setZones([]));
  }, []);

  const rangeIncomplete = filters.date_option === 'range' && (!filters.from_date || !filters.to_date);

  const load = useCallback(async (targetPage) => {
    if (rangeIncomplete) return;
    setLoading(true);
    setError('');
    try {
      const response = await adminService.getRideReport({ ...filters, page: targetPage, limit: 20 });
      setReport(response?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not load the ride report.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [filters, rangeIncomplete]);

  useEffect(() => {
    load(page);
  }, [load, page]);

  const updateFilter = (key, value) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleDownload = async (format) => {
    setDownloading(format);
    try {
      const response = await adminService.downloadRideReport({ ...filters, file_format: format });
      triggerFileDownload(response, `ride_report_${Date.now()}`, format);
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to generate report.');
    } finally {
      setDownloading('');
    }
  };

  // Zones belong to a city; once a city is picked only its zones make sense.
  const zoneOptions = filters.service_location_id
    ? zones.filter((z) => String(z?.service_location_id?._id || z?.service_location_id || '') === filters.service_location_id)
    : zones;

  const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none shadow-sm';
  const labelClass = 'block text-[12px] font-bold text-gray-600 mb-1.5';
  const rows = report?.results || [];
  const summary = report?.summary;
  const paginator = report?.paginator;

  return (
    <div className="min-h-screen bg-[#F9FAFB] p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-3 font-medium">
          <span>Report</span>
          <ChevronRight size={14} className="opacity-50" />
          <span className="text-gray-600 font-semibold italic">Ride Report</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-5">
          <h1 className="text-2xl font-bold text-[#334155] tracking-tight uppercase">Ride Report</h1>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleDownload('csv')}
              disabled={!!downloading || rangeIncomplete}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
            >
              <Download size={16} /> {downloading === 'csv' ? 'Preparing…' : 'CSV'}
            </button>
            <button
              onClick={() => handleDownload('excel')}
              disabled={!!downloading || rangeIncomplete}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-50 shadow-sm"
            >
              <Download size={16} /> {downloading === 'excel' ? 'Preparing…' : 'Excel'}
            </button>
            <button
              onClick={() => window.history.back()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 shadow-sm"
            >
              <ArrowLeft size={16} strokeWidth={2.5} /> Back
            </button>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-gray-100 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className={labelClass}>Date</label>
            <select value={filters.date_option} onChange={(e) => updateFilter('date_option', e.target.value)} className={inputClass}>
              <option value="">All time</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="this_year">This Year</option>
              <option value="range">Date Range</option>
            </select>
          </div>
          {filters.date_option === 'range' ? (
            <>
              <div>
                <label className={labelClass}>From</label>
                <input type="date" value={filters.from_date} onChange={(e) => updateFilter('from_date', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>To</label>
                <input type="date" value={filters.to_date} onChange={(e) => updateFilter('to_date', e.target.value)} className={inputClass} />
              </div>
            </>
          ) : null}
          <div>
            <label className={labelClass}>Status</label>
            <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)} className={inputClass}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Vehicle Type</label>
            <select value={filters.vehicle_type_id} onChange={(e) => updateFilter('vehicle_type_id', e.target.value)} className={inputClass}>
              <option value="">All vehicle types</option>
              {vehicleTypes.map((v) => (
                <option key={String(v?._id || v?.id)} value={String(v?._id || v?.id || '')}>{v?.name || v?.type_name || 'Vehicle'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>City</label>
            <select
              value={filters.service_location_id}
              onChange={(e) => {
                setPage(1);
                setFilters((prev) => ({ ...prev, service_location_id: e.target.value, zone_id: '' }));
              }}
              className={inputClass}
            >
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={String(c?._id || c?.id)} value={String(c?._id || c?.id || '')}>{c?.name || c?.service_location_name || 'City'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Zone (pickup inside)</label>
            <select value={filters.zone_id} onChange={(e) => updateFilter('zone_id', e.target.value)} className={inputClass}>
              <option value="">All zones</option>
              {zoneOptions.map((z) => (
                <option key={String(z?._id || z?.id)} value={String(z?._id || z?.id || '')}>{z?.name || 'Zone'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Payment</label>
            <select value={filters.payment_type} onChange={(e) => updateFilter('payment_type', e.target.value)} className={inputClass}>
              <option value="">All payments</option>
              <option value="cash">Cash</option>
              <option value="online">Online</option>
            </select>
          </div>
        </div>
      </motion.div>

      {summary ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            ['Rides', summary.rides],
            ['Fare', money(summary.fare)],
            ['Commission', money(summary.commission)],
            ['Distance', `${Number(summary.distance_km || 0).toFixed(1)} km`],
          ].map(([label, value]) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
              <p className="mt-1 text-xl font-bold text-gray-800">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {rangeIncomplete ? (
          <p className="p-6 text-sm text-gray-500">Pick both dates to see the rides in that range.</p>
        ) : error ? (
          <div className="p-6 flex items-center justify-between gap-3">
            <p className="text-sm text-rose-600">{error}</p>
            <button onClick={() => load(page)} className="flex items-center gap-1 text-sm font-bold text-indigo-600">
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  {['Ride', 'Date', 'User', 'Driver', 'Vehicle', 'Pickup / Drop', 'Distance', 'Fare', 'Commission', 'Payment', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-bold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && !rows.length ? (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">No rides match these filters.</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.ride_id} className={loading ? 'opacity-60' : ''}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500" title={r.ride_id}>…{r.ride_id.slice(-8)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{r.date ? new Date(r.date).toLocaleString() : ''}</td>
                    <td className="px-4 py-3"><div className="font-semibold text-gray-800">{r.user || '—'}</div><div className="text-xs text-gray-400">{r.user_phone}</div></td>
                    <td className="px-4 py-3"><div className="font-semibold text-gray-800">{r.driver}</div><div className="text-xs text-gray-400">{r.driver_phone}</div></td>
                    <td className="px-4 py-3 whitespace-nowrap">{r.vehicle || '—'}<div className="text-xs text-gray-400">{r.city}</div></td>
                    <td className="px-4 py-3 min-w-[220px] max-w-[320px]">
                      <div className="truncate" title={r.pickup}>{r.pickup || '—'}</div>
                      <div className="truncate text-xs text-gray-400" title={r.drop}>{r.drop || '—'}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{Number(r.distance_km || 0).toFixed(1)} km</td>
                    <td className="px-4 py-3 whitespace-nowrap font-semibold">{money(r.fare)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{money(r.commission)}</td>
                    <td className="px-4 py-3 capitalize">{r.payment_method || '—'}</td>
                    <td className="px-4 py-3 capitalize">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {paginator && paginator.last_page > 1 ? (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm">
            <span className="text-gray-500">Page {paginator.current_page} of {paginator.last_page}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Previous</button>
              <button disabled={page >= paginator.last_page || loading} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Next</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default RideReport;
