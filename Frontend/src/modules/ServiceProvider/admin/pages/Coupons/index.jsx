import React, { useCallback, useEffect, useState } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiX, FiTag, FiSearch, FiPause, FiPlay, FiInfo } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import {
  getCoupons,
  createCoupon,
  updateCoupon,
  toggleCouponStatus,
  deleteCoupon,
} from '../../services/couponService';

/*
 * Services coupons. Customers enter a code at booking; the server checks it
 * (dates, minimum, total and per-customer limits) and takes the discount off
 * the booking and later off the bill. The platform funds the discount --
 * partners are paid on the service's base price.
 */

const EMPTY = {
  couponCode: '',
  title: '',
  description: '',
  discountType: 'percentage',
  discountValue: '',
  maxDiscount: '',
  minOrderValue: '',
  usageLimit: '',
  perUserLimit: 1,
  customerScope: 'all',
  startDate: '',
  endDate: '',
  status: 'active',
  showInCart: true,
};

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const describe = (c) => (c.discountType === 'flat-price'
  ? `${rupees(c.discountValue)} off`
  : `${c.discountValue}% off${Number(c.maxDiscount) > 0 ? ` up to ${rupees(c.maxDiscount)}` : ''}`);

const stateOf = (c) => {
  const now = new Date();
  if (c.status !== 'active') return { label: c.status === 'inactive' ? 'Off' : 'Paused', tone: 'bg-amber-100 text-amber-700' };
  if (c.endDate && new Date(c.endDate) <= now) return { label: 'Expired', tone: 'bg-gray-100 text-gray-500' };
  if (c.startDate && new Date(c.startDate) > now) return { label: 'Scheduled', tone: 'bg-sky-100 text-sky-700' };
  if (c.usageLimit != null && c.usedCount >= c.usageLimit) return { label: 'Used up', tone: 'bg-gray-100 text-gray-600' };
  return { label: 'Live', tone: 'bg-green-100 text-green-700' };
};

const Coupons = () => {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null: closed, {}: new, coupon: edit
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCoupons(search.trim() ? { search: search.trim() } : {});
      setCoupons(Array.isArray(res?.data) ? res.data : []);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to load coupons');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const openCreate = () => {
    setForm(EMPTY);
    setEditing({});
  };

  const openEdit = (c) => {
    setForm({
      ...EMPTY,
      ...c,
      maxDiscount: c.maxDiscount ?? '',
      usageLimit: c.usageLimit ?? '',
      minOrderValue: c.minOrderValue ?? '',
      startDate: toDateInput(c.startDate),
      endDate: toDateInput(c.endDate),
    });
    setEditing(c);
  };

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const num = (v) => (v === '' || v === null || v === undefined ? '' : Number(v));
    const payload = {
      couponCode: form.couponCode.trim().toUpperCase(),
      title: form.title,
      description: form.description,
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      maxDiscount: form.discountType === 'percentage' ? num(form.maxDiscount) : '',
      minOrderValue: num(form.minOrderValue) || 0,
      usageLimit: num(form.usageLimit),
      perUserLimit: Number(form.perUserLimit) || 1,
      customerScope: form.customerScope,
      startDate: form.startDate || '',
      // The end date is inclusive in the form, so the coupon runs to the end of that day.
      endDate: form.endDate ? new Date(`${form.endDate}T23:59:59`).toISOString() : '',
      status: form.status,
      showInCart: Boolean(form.showInCart),
    };
    try {
      if (editing?._id) {
        await updateCoupon(editing._id, payload);
        toast.success('Coupon updated');
      } else {
        await createCoupon(payload);
        toast.success('Coupon created');
      }
      setEditing(null);
      load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not save the coupon');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (c) => {
    try {
      await toggleCouponStatus(c._id);
      load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not change the coupon');
    }
  };

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete coupon ${c.couponCode}?`)) return;
    try {
      const res = await deleteCoupon(c._id);
      toast.success(res?.message || 'Coupon deleted');
      load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not delete the coupon');
    }
  };

  const input = 'w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm';
  const label = 'text-sm font-bold text-gray-700';

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Coupons</h1>
          <p className="text-gray-500 text-sm">Codes customers can use when booking a service. The platform pays the discount.</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 shadow-md"
        >
          <FiPlus /> New Coupon
        </button>
      </div>

      <div className="relative max-w-sm">
        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code or title"
          className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
        </div>
      ) : coupons.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border-2 border-dashed border-gray-200">
          <FiInfo className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No coupons yet. Click "New Coupon" to create one.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                {['Code', 'Discount', 'Min booking', 'Used', 'Valid', 'State', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-bold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {coupons.map((c) => {
                const state = stateOf(c);
                return (
                  <tr key={c._id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-bold text-gray-800"><FiTag className="text-indigo-500" />{c.couponCode}</div>
                      {c.title ? <div className="text-xs text-gray-500">{c.title}</div> : null}
                      {c.customerScope === 'first-time' ? <div className="text-xs text-indigo-600">First booking only</div> : null}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{describe(c)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{Number(c.minOrderValue) > 0 ? rupees(c.minOrderValue) : '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.usedCount || 0}{c.usageLimit != null ? ` / ${c.usageLimit}` : ''}
                      <div className="text-xs text-gray-400">{c.perUserLimit || 1} per customer</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600">
                      {c.startDate ? new Date(c.startDate).toLocaleDateString() : 'Now'} – {c.endDate ? new Date(c.endDate).toLocaleDateString() : 'No end'}
                    </td>
                    <td className="px-4 py-3"><span className={`px-2 py-1 text-xs font-bold rounded-full ${state.tone}`}>{state.label}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => handleToggle(c)} title={c.status === 'active' ? 'Pause' : 'Make live'} className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg">
                          {c.status === 'active' ? <FiPause /> : <FiPlay />}
                        </button>
                        <button onClick={() => openEdit(c)} title="Edit" className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><FiEdit2 /></button>
                        <button onClick={() => handleDelete(c)} title="Delete" className="p-2 text-red-600 hover:bg-red-50 rounded-lg"><FiTrash2 /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-indigo-600 text-white sticky top-0">
              <h2 className="text-lg font-bold">{editing._id ? `Edit ${editing.couponCode}` : 'New Coupon'}</h2>
              <button onClick={() => setEditing(null)} aria-label="Close"><FiX className="w-6 h-6" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={label}>Code</label>
                  <input name="couponCode" value={form.couponCode} onChange={onChange} className={`${input} uppercase font-bold`} placeholder="FIXIT15" required pattern="[A-Za-z0-9_\-]{3,20}" />
                </div>
                <div className="space-y-1.5">
                  <label className={label}>Title</label>
                  <input name="title" value={form.title} onChange={onChange} className={input} placeholder="15% off home repairs" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className={label}>Description</label>
                <textarea name="description" value={form.description} onChange={onChange} className={`${input} min-h-[70px]`} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className={label}>Type</label>
                  <select name="discountType" value={form.discountType} onChange={onChange} className={input}>
                    <option value="percentage">Percent</option>
                    <option value="flat-price">Flat ₹</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={label}>{form.discountType === 'percentage' ? 'Percent off' : 'Amount off (₹)'}</label>
                  <input type="number" min="0.01" step="0.01" max={form.discountType === 'percentage' ? 100 : undefined} name="discountValue" value={form.discountValue} onChange={onChange} className={input} required />
                </div>
                {form.discountType === 'percentage' ? (
                  <div className="space-y-1.5">
                    <label className={label}>Up to (₹)</label>
                    <input type="number" min="0" name="maxDiscount" value={form.maxDiscount} onChange={onChange} className={input} placeholder="No cap" />
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className={label}>Min booking (₹)</label>
                  <input type="number" min="0" name="minOrderValue" value={form.minOrderValue} onChange={onChange} className={input} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <label className={label}>Total uses</label>
                  <input type="number" min="1" name="usageLimit" value={form.usageLimit} onChange={onChange} className={input} placeholder="Unlimited" />
                </div>
                <div className="space-y-1.5">
                  <label className={label}>Per customer</label>
                  <input type="number" min="1" name="perUserLimit" value={form.perUserLimit} onChange={onChange} className={input} required />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={label}>Starts</label>
                  <input type="date" name="startDate" value={form.startDate} onChange={onChange} className={input} />
                </div>
                <div className="space-y-1.5">
                  <label className={label}>Ends (inclusive)</label>
                  <input type="date" name="endDate" value={form.endDate} onChange={onChange} className={input} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={label}>Who can use it</label>
                  <select name="customerScope" value={form.customerScope} onChange={onChange} className={input}>
                    <option value="all">Every customer</option>
                    <option value="first-time">First booking only</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={label}>Status</label>
                  <select name="status" value={form.status} onChange={onChange} className={input}>
                    <option value="active">Live</option>
                    <option value="paused">Paused</option>
                    <option value="inactive">Off</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-3 py-1 text-sm font-bold text-gray-700">
                <input type="checkbox" name="showInCart" checked={Boolean(form.showInCart)} onChange={onChange} className="w-5 h-5" />
                Show to customers at checkout (a hidden code still works when typed)
              </label>
              <button type="submit" disabled={saving} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-60">
                {saving ? 'Saving…' : editing._id ? 'Save Coupon' : 'Create Coupon'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Coupons;
