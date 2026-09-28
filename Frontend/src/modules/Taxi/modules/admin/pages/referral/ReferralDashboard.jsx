import React, { useEffect, useState } from 'react';
import {
  Users,
  UserCheck,
  Zap,
  IndianRupee,
  ArrowUpRight,
  ChevronRight,
  TrendingUp,
  PieChart as PieIcon,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { getUnifiedAdminToken } from '../../services/adminSession';

const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white rounded-[32px] p-8 border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full group">
    <div className="flex items-start justify-between">
      <div className={`p-4 rounded-2xl ${color} bg-opacity-10 group-hover:scale-110 transition-transform duration-500`}>
        <Icon size={24} className={`${color.replace('bg-', 'text-')}`} />
      </div>
    </div>
    <div className="mt-8">
      <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest leading-none mb-3">{title}</p>
      <h3 className="text-4xl font-black text-gray-950 tracking-tighter leading-none">{value}</h3>
    </div>
  </div>
);

const ReferralDashboard = () => {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const token = getUnifiedAdminToken() || '';
        const res = await fetch(globalThis.__LEGACY_BACKEND_ORIGIN__ + '/api/v1/taxi/admin/referral/dashboard', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.success) {
          setData(json.data);
        }
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50/30 p-8">
        <div className="flex flex-col items-center gap-6">
          <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
          <p className="text-[14px] font-black text-gray-400 uppercase tracking-widest animate-pulse">Syncing Viral Growth Metrics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12 p-2 animate-in fade-in zoom-in-95 duration-700 font-sans text-gray-950">
      {/* HEADER */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-6xl font-black tracking-tighter text-gray-950 mb-3 uppercase leading-none">Referral<span className="text-indigo-600">.</span></h1>
          <div className="flex items-center gap-3 text-[12px] font-black text-gray-400">
            <span className="bg-gray-100 text-gray-950 px-3 py-1 rounded-full uppercase tracking-widest text-[10px]">Referral Dashboard</span>
            <ChevronRight size={14} />
            <span className="uppercase tracking-widest text-[10px]">Analytics Overview</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
           <div className="bg-white px-6 py-3 rounded-full border border-gray-100 shadow-sm flex items-center gap-3">
              <Activity size={18} className="text-indigo-600" />
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Live Status:</span>
              <span className="text-[11px] font-black uppercase tracking-widest text-emerald-500">Active</span>
           </div>
        </div>
      </div>

      {/* STATS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Drivers" 
          value={data?.total_drivers || "0"} 
          icon={Users} 
          color="bg-indigo-600" 
        />
        <StatCard 
          title="Total Users" 
          value={data?.total_users || "0"} 
          icon={UserCheck} 
          color="bg-rose-500" 
        />
        <StatCard 
          title="Active Referrals" 
          value={data?.active_referrals || "0"} 
          icon={Zap} 
          color="bg-amber-400" 
        />
        <StatCard 
          title="Referral Earnings" 
          value={data?.referral_earning ? `₹${data.referral_earning}` : "₹ 0"} 
          icon={IndianRupee} 
          color="bg-emerald-500" 
        />
      </div>

      {/* The charts that stood here drew fixed shapes and numbers, not this
          platform's data; only the totals above come from the server. */}
    </div>
  );
};

export default ReferralDashboard;


