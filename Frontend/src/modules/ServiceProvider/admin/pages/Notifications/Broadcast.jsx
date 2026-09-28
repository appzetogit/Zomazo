import React, { useCallback, useEffect, useState } from 'react';
import { FiSend, FiRefreshCw, FiTrash2, FiUsers, FiBriefcase, FiUser } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import api from '@sp/services/api';

/*
 * Push broadcast to the Services apps. Each chosen account gets an inbox entry
 * and a push on every device it is signed in on. Sending carries on after this
 * screen gets its answer, so the history below fills in its counts as it goes.
 */

const AUDIENCES = [
  { key: 'customers', label: 'Customers', icon: FiUsers },
  { key: 'vendors', label: 'Vendors', hint: 'approved only', icon: FiBriefcase },
  { key: 'workers', label: 'Workers', hint: 'approved only', icon: FiUser },
];

const STATUS_TONE = {
  sending: 'bg-sky-100 text-sky-700',
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const Broadcast = () => {
  const [form, setForm] = useState({ title: '', message: '', link: '' });
  const [audiences, setAudiences] = useState(['customers']);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get('/admin/notifications/broadcast', { params: { limit: 30 } });
      setHistory(res.data?.data?.items || []);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load past broadcasts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // While anything is still going out, check back every few seconds.
  useEffect(() => {
    if (!history.some((b) => b.status === 'sending')) return undefined;
    const t = setTimeout(loadHistory, 4000);
    return () => clearTimeout(t);
  }, [history, loadHistory]);

  const toggleAudience = (key) => {
    setAudiences((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!audiences.length) {
      toast.error('Choose who to send it to');
      return;
    }
    const who = audiences.map((a) => AUDIENCES.find((x) => x.key === a)?.label).join(', ');
    if (!window.confirm(`Send "${form.title}" to all ${who}? This cannot be undone.`)) return;
    setSending(true);
    try {
      await api.post('/admin/notifications/broadcast', { ...form, audiences });
      toast.success('Broadcast is being sent');
      setForm({ title: '', message: '', link: '' });
      loadHistory();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not send the broadcast');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this broadcast from the history? It stays delivered.')) return;
    try {
      await api.delete(`/admin/notifications/broadcast/${id}`);
      setHistory((prev) => prev.filter((b) => b._id !== id));
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not remove it');
    }
  };

  const input = 'w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm';

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Broadcast</h1>
        <p className="text-gray-500 text-sm">Send a push notification to Services customers, vendors or workers.</p>
      </div>

      <form onSubmit={handleSend} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4 max-w-2xl">
        <div className="space-y-1.5">
          <label className="text-sm font-bold text-gray-700">Send to</label>
          <div className="flex flex-wrap gap-2">
            {AUDIENCES.map(({ key, label, hint, icon: Icon }) => {
              const on = audiences.includes(key);
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => toggleAudience(key)}
                  aria-pressed={on}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                >
                  <Icon /> {label}
                  {hint ? <span className={`text-xs font-normal ${on ? 'text-indigo-100' : 'text-gray-400'}`}>({hint})</span> : null}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-bold text-gray-700">Title</label>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            maxLength={120}
            className={input}
            placeholder="Weekend offer on AC servicing"
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-bold text-gray-700">Message</label>
          <textarea
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            maxLength={1000}
            className={`${input} min-h-[100px]`}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-bold text-gray-700">Open on tap <span className="font-normal text-gray-400">(optional path in the app)</span></label>
          <input
            value={form.link}
            onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
            className={input}
            placeholder="/user/services"
          />
        </div>
        <button
          type="submit"
          disabled={sending}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-60"
        >
          <FiSend /> {sending ? 'Sending…' : 'Send broadcast'}
        </button>
      </form>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">Sent</h2>
          <button onClick={loadHistory} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Refresh"><FiRefreshCw /></button>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-gray-400">Loading…</p>
        ) : history.length === 0 ? (
          <p className="p-5 text-sm text-gray-400">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {history.map((b) => (
              <li key={b._id} className="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800 truncate">{b.title}</span>
                    <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${STATUS_TONE[b.status] || 'bg-gray-100 text-gray-600'}`}>{b.status}</span>
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-2">{b.message}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(b.createdAt).toLocaleString()} · {(b.audiences || []).join(', ')} · {b.recipients} accounts · {b.delivered}/{b.devices} devices
                    {b.failedDevices ? ` · ${b.failedDevices} failed` : ''}
                  </p>
                  {b.error ? <p className="text-xs text-red-600 mt-1">{b.error}</p> : null}
                </div>
                <button onClick={() => handleDelete(b._id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg" aria-label="Remove from history"><FiTrash2 /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Broadcast;
