import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Tag, CheckCircle2, X, ChevronRight, Ticket } from 'lucide-react';
import BottomNavbar from '../components/BottomNavbar';
import { userService } from '../services/userService';

const TRANSPORT_LABEL = { all: 'All rides', taxi: 'Rides', delivery: 'Parcel', both: 'Rides & parcel' };

const fmtDate = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** The server's promo in the shape the cards show. */
const toCard = (p) => ({
  id: String(p._id),
  code: p.code,
  percent: Number(p.discount_percentage) || 0,
  // A platform coupon can be a flat amount off; Rides' own promos never are.
  flatOff: p.discount_type === 'flat' ? Number(p.flat_discount_amount) || 0 : 0,
  maxOff: p.discount_type === 'flat' ? 0 : Number(p.maximum_discount_amount) || 0,
  minFare: Number(p.minimum_trip_amount) || 0,
  service: p.audience_type === 'new_users' ? 'First ride' : (TRANSPORT_LABEL[p.transport_type] || 'Rides'),
  expiry: fmtDate(p.to_date),
});

const SkeletonCard = () => (
  <div className="animate-pulse rounded-[20px] bg-white/70 border border-white/80 p-4 space-y-3">
    <div className="flex justify-between">
      <div className="h-4 bg-slate-200 rounded-full w-24" />
      <div className="h-4 bg-slate-100 rounded-full w-16" />
    </div>
    <div className="h-3 bg-slate-100 rounded-full w-3/4" />
    <div className="h-8 bg-slate-100 rounded-[10px] w-full" />
  </div>
);

/**
 * The rider's live promo codes, from the server. A code is applied at booking
 * (Select vehicle checks it against the fare and location), so here it is
 * copied, not applied. This page used to show made-up codes.
 */
const PromoCodes = () => {
  const navigate = useNavigate();
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [appliedCode, setAppliedCode] = useState(null);
  const [toast, setToast] = useState(null);
  const [errorBanner, setErrorBanner] = useState(null);

  useEffect(() => {
    let alive = true;
    userService.getAvailablePromos({ limit: 50 })
      .then((res) => {
        const list = res?.data?.data ?? res?.data ?? [];
        if (alive) setPromos(Array.isArray(list) ? list.map(toCard) : []);
      })
      .catch(() => alive && setErrorBanner('Could not load promo codes. Please try again.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setAppliedCode(code);
      showToast(`"${code}" copied. Apply it when you book.`, 'success');
    } catch {
      showToast('Could not copy. Note the code and apply it when you book.', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#F8FAFC_0%,#F3F4F6_38%,#EEF2F7_100%)] max-w-lg mx-auto font-sans pb-28 relative overflow-hidden">
      <div className="absolute -top-16 right-[-40px] h-44 w-44 rounded-full bg-yellow-100/60 blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="bg-white/90 backdrop-blur-md px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-white/80 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-[12px] border border-white/80 bg-white/90 flex items-center justify-center shadow-sm active:scale-95 transition-all">
            <ArrowLeft size={18} className="text-slate-900" strokeWidth={2.5} />
          </button>
          <div className="flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.26em] text-slate-400">Discounts</p>
            <h1 className="text-[19px] font-black tracking-tight text-slate-900">Promo Codes</h1>
          </div>
          <Tag size={20} className="text-yellow-500" strokeWidth={2} />
        </div>
      </header>

      <div className="px-5 pt-4 space-y-4">
        {/* Error banner */}
        <AnimatePresence>
          {errorBanner && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-[16px] px-4 py-3">
              <X size={14} className="text-red-500 shrink-0" strokeWidth={2.5} />
              <p className="text-[12px] font-black text-red-600 flex-1">{errorBanner}</p>
              <button onClick={() => setErrorBanner(null)}>
                <X size={13} className="text-red-400" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Section label */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.26em] text-slate-400">Available Offers</p>
          <h2 className="mt-0.5 text-[16px] font-black tracking-tight text-slate-900">Copy a code, apply it when you book</h2>
        </div>

        {/* Promo cards */}
        {loading && Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}

        {!loading && promos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="w-16 h-16 bg-white/80 border border-white/80 rounded-3xl flex items-center justify-center">
              <Ticket size={28} className="text-slate-300" strokeWidth={1.5} />
            </div>
            <p className="text-[14px] font-black text-slate-500">No promo codes available right now</p>
          </div>
        )}

        {!loading && promos.map((promo, i) => {
          const isApplied = appliedCode === promo.code;
          return (
            <motion.div key={promo.id}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className={`rounded-[20px] border p-4 transition-all ${
                isApplied ? 'bg-emerald-50/80 border-emerald-200 shadow-[0_4px_14px_rgba(16,185,129,0.10)]' : 'bg-white/90 border-white/80 shadow-[0_4px_14px_rgba(15,23,42,0.06)]'
              }`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] font-black text-slate-900 tracking-wider">{promo.code}</span>
                    {isApplied && <CheckCircle2 size={16} className="text-emerald-500" strokeWidth={2.5} />}
                  </div>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5">{promo.service}{promo.minFare ? ` · Min fare ₹${promo.minFare}` : ''}{promo.maxOff ? ` · Up to ₹${promo.maxOff}` : ''}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[18px] font-black text-slate-900">
                    {promo.flatOff ? `₹${promo.flatOff}` : `${promo.percent}%`}
                    <span className="text-[11px] font-bold text-slate-400 ml-1">off</span>
                  </p>
                  {promo.expiry ? <p className="text-[9px] font-bold text-slate-400">Expires {promo.expiry}</p> : null}
                </div>
              </div>
              <motion.button whileTap={{ scale: 0.97 }}
                onClick={() => copyCode(promo.code)}
                className={`w-full py-2.5 rounded-[12px] text-[12px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                  isApplied
                    ? 'bg-emerald-100 text-emerald-700 cursor-default'
                    : 'bg-slate-900 text-white shadow-sm active:bg-black'
                }`}>
                {isApplied ? (
                  <><CheckCircle2 size={13} strokeWidth={2.5} /> Copied</>
                ) : 'Copy Code'}
              </motion.button>
            </motion.div>
          );
        })}
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl text-[12px] font-black shadow-2xl z-50 whitespace-nowrap ${
              toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
            }`}>
            {toast.type === 'success' ? '✓ ' : '✗ '}{toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNavbar />
    </div>
  );
};

export default PromoCodes;
