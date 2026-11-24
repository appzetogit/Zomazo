import React, { useState, useEffect } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { motion } from "framer-motion"
import { ArrowLeft, FileText, Shield, Receipt, Truck, X, Loader2, UserX } from "lucide-react"
import api from "@food/api"
import { API_ENDPOINTS } from "@food/api/config"
import { withBrand } from "@/shared/superapp/Brand"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"

// The support address from Business Setup, if it is a real one.
const supportEmail = () => {
  const email = String(getCachedSettings()?.email || "").trim()
  return /^[^s@]+@[^s@]+.[^s@]+$/.test(email) ? email : ""
}

// Account deletion is not an admin-written page: app stores (Google Play) need a
// public page that says how to delete an account and its data, so it is here.
// "Quick Drop" is swapped for this site's brand by withBrand, like the fallbacks.
const accountDeletionContent = () => {
  const email = supportEmail()
  const ask = email
    ? `email <a href="mailto:${email}?subject=Delete%20my%20account">${email}</a> from any device, with the subject "Delete my account" and the mobile number you signed up with, or write to us from the <a href="/support">Help &amp; Support</a> page`
    : `write to us from the <a href="/support">Help &amp; Support</a> page with the subject "Delete my account" and the mobile number you signed up with`
  return `
<h1>Delete your account</h1>
<p>You can delete your Quick Drop account and its personal data at any time. One account covers every service in the app (food, groceries, shopping, medicines, rides and parcels, home services), so deleting it removes it from all of them.</p>

<h3>In the app</h3>
<ol>
<li>Open the Quick Drop app or website and sign in with your mobile number.</li>
<li>Go to <strong>Profile</strong>.</li>
<li>Tap <strong>Delete Account</strong> and confirm.</li>
</ol>
<p>Restaurants, sellers, delivery partners, drivers and service professionals will find <strong>Delete Account</strong> in the profile or settings menu of their partner app. Partner accounts with open orders, unpaid dues or a pending payout are closed once those are settled.</p>

<h3>Without the app</h3>
<p>If you can no longer sign in, ${ask}. We verify that the number is yours with a one-time code, then delete the account within 30 days and confirm by SMS or email.</p>

<h3>What is deleted</h3>
<ul>
<li>Your profile: name, email, photo, date of birth and gender.</li>
<li>Saved addresses, location history, favourites and cart.</li>
<li>Uploaded prescriptions and support photos.</li>
<li>Notification tokens and marketing preferences.</li>
<li>For partners: identity and vehicle documents and bank or UPI details, once the legal retention period ends.</li>
</ul>

<h3>What we keep, and for how long</h3>
<ul>
<li>Invoices, payment and refund records: kept as tax and accounting laws require (generally up to 8 years), linked to an anonymised account.</li>
<li>Records needed to resolve an open order, refund, dispute or a fraud or safety investigation: kept until it is closed.</li>
</ul>
<p>Use any wallet balance before deleting: wallet balance, cashback and rewards cannot be recovered after deletion.</p>

<h3>Deleting only some data</h3>
<p>You can delete saved addresses and change your profile in the app at any time, and turn off location, notifications and promotional messages in settings, without deleting your account. To ask us to delete other specific data, contact us the same way as above.</p>
`
}

const DEFAULT_TERMS_CONTENT = `
<h1>Terms of Service</h1>
<p>Last Updated: June 12, 2026</p>

<h3>1. Acceptance of Terms</h3>
<p>By downloading, installing, or using the Quick Drop mobile application or website (collectively, the "Services"), you agree to be bound by these Terms of Service. If you do not agree, please do not access or use the Services.</p>

<h3>2. Description of Services</h3>
<p>Quick Drop provides a unified platform connecting users with third-party service providers, including ride-hailing drivers and food delivery partners. Quick Drop acts as a technology platform and does not itself provide transportation or food preparation services.</p>

<h3>3. User Accounts</h3>
<p>To use our Services, you must register using your phone number and confirm via a 4-digit verification code (OTP). You agree to provide accurate, current, and complete information during the registration process and keep your account details secure.</p>

<h3>4. Payments and Billing</h3>
<p>Fares and food orders are calculated based on distance, demand, and standard tariffs. You can pay digitally via UPI, card, net banking, or cash. All payments are securely encrypted. Refund eligibility is governed by our Refund Policy.</p>

<h3>5. User Conduct and Restrictions</h3>
<p>You agree not to use the Services for any illegal activities, harassment, or unauthorized access. Quick Drop reserves the right to terminate accounts that violate community safety guidelines or engage in fraudulent actions.</p>

<h3>6. Limitation of Liability</h3>
<p>Quick Drop is not liable for direct, indirect, incidental, or consequential damages resulting from your use of the Services or interactions with third-party providers.</p>
`

export default function TermsPage({ defaultTab = "terms" }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryParams = new URLSearchParams(location.search)
  const role = queryParams.get("role") // e.g., 'restaurant' or 'delivery'
  const tabParam = queryParams.get("tab")

  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(tabParam || defaultTab)
  const [pageContent, setPageContent] = useState("")
  const [pageTitle, setPageTitle] = useState("Terms & Conditions")

  useEffect(() => {
    const currentTabParam = new URLSearchParams(location.search).get("tab")
    if (currentTabParam && currentTabParam !== activeTab) {
      setActiveTab(currentTabParam)
    }
  }, [location.search])

  // Legal menu items
  const menuItems = [
    { id: "terms", label: "Terms of Service", icon: FileText, endpoint: "/food/pages/terms" },
    { id: "privacy", label: "Privacy Policy", icon: Shield, endpoint: "/food/pages/privacy" },
    { id: "refund", label: "Refund Policy", icon: Receipt, endpoint: "/food/pages/refund" },
    { id: "shipping", label: "Shipping Policy", icon: Truck, endpoint: "/food/pages/shipping" },
    { id: "cancellation", label: "Cancellation Policy", icon: X, endpoint: "/food/pages/cancellation" },
    { id: "delete-account", label: "Account Deletion", icon: UserX, content: accountDeletionContent }
  ]

  useEffect(() => {
    fetchContent(activeTab)
  }, [activeTab])

  const fetchContent = async (tabId) => {
    try {
      setLoading(true)
      const currentItem = menuItems.find(item => item.id === tabId)
      if (!currentItem) return
      if (currentItem.content) {
        await loadBusinessSettings().catch(() => null)
        setPageTitle(currentItem.label)
        setPageContent(currentItem.content())
        return
      }

      let fetchEndpoint = currentItem.endpoint;
      // Append _role to endpoint if a specific role is provided (e.g., terms_restaurant)
      if (role && (tabId === 'terms' || tabId === 'privacy')) {
          fetchEndpoint += `_${role}`;
      }

      const response = await api.get(fetchEndpoint)
      if (response.data?.success && response.data?.data?.content) {
        setPageTitle(response.data.data.title || currentItem.label)
        setPageContent(response.data.data.content)
      } else {
        // Fallback content if empty or endpoint failed
        setPageTitle(currentItem.label)
        setPageContent(getFallbackContent(tabId))
      }
    } catch (error) {
      console.warn(`Failed to fetch legal page for tab: ${tabId}. Using fallback content.`, error)
      const currentItem = menuItems.find(item => item.id === tabId)
      setPageTitle(currentItem?.label || "Legal Document")
      setPageContent(getFallbackContent(tabId))
    } finally {
      setLoading(false)
    }
  }

  const getFallbackContent = (tabId) => {
    switch (tabId) {
      case "privacy":
        return `
          <h1>Privacy Policy</h1>
          <p>Last Updated: June 12, 2026</p>
          <h3>1. Information We Collect</h3>
          <p>We collect your phone number, name, device information, and real-time location data (GPS) to provide services, connect you with drivers, and track food deliveries.</p>
          <h3>2. How We Use Your Data</h3>
          <p>We use your information to facilitate rides, deliver meals, secure accounts, prevent fraud, and send service updates. We do not sell your personal data to advertisers.</p>
          <h3>3. Sharing of Information</h3>
          <p>Your name and phone number are shared with drivers/delivery partners solely for matching and completing orders. We may disclose data if required by law or to protect user safety.</p>
        `
      case "refund":
        return `
          <h1>Refund Policy</h1>
          <p>Last Updated: June 12, 2026</p>
          <h3>1. Refund Eligibility</h3>
          <p>Refunds are processed for cancelled rides (if cancelled prior to driver arrival) and food orders that could not be completed. Failed transactions are automatically reversed by your payment bank.</p>
          <h3>2. Processing Timeline</h3>
          <p>UPI and digital wallet refunds reflect instantly. Credit/Debit card refunds reflect in your account within 3 to 5 business days depending on bank processing schedules.</p>
        `
      case "shipping":
        return `
          <h1>Shipping Policy</h1>
          <p>Last Updated: June 12, 2026</p>
          <h3>1. Delivery Areas and Fees</h3>
          <p>We deliver food and pick up rides within designated zone boundaries. Delivery fee values depend on distance and order total, displayed transparently at checkout.</p>
          <h3>2. Estimated Time of Arrival (ETA)</h3>
          <p>ETAs are dynamic calculations based on preparation time, distance, and road traffic. Delays due to weather or traffic will be notified in-app.</p>
        `
      case "cancellation":
        return `
          <h1>Cancellation Policy</h1>
          <p>Last Updated: June 12, 2026</p>
          <h3>1. Ride Cancellations</h3>
          <p>You may cancel your ride free of charge within 2 minutes of booking. A nominal fee is charged if cancelled after the driver has reached your pickup location.</p>
          <h3>2. Food Order Cancellations</h3>
          <p>Food orders can only be cancelled before the restaurant accepts the order. Once the kitchen starts food preparation, cancellations are not eligible for a refund.</p>
        `
      case "terms":
      default:
        return DEFAULT_TERMS_CONTENT
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#1A1A1A] via-[#2A2A2A] to-[#1A1A1A] text-white py-10 px-6 relative overflow-hidden shadow-sm">
        <div className="absolute top-0 right-0 w-72 h-72 bg-[#F38F24]/5 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="max-w-6xl mx-auto relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <button 
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-3 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-[#F38F24]" />
              Back to Home
            </button>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">
              Legal & Policies
            </h1>
          </div>
          <div className="text-xs text-gray-400 uppercase tracking-widest font-semibold">
            Unified Ecosystem Compliance
          </div>
        </div>
      </div>

      {/* Main Split Layout */}
      <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 flex flex-col md:flex-row gap-8">
        
        {/* Sidebar tabs navigation */}
        <div className="w-full md:w-64 shrink-0 flex flex-col gap-2.5">
          <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase mb-1 px-3">
            Documents
          </h3>
          <div className="flex flex-row md:flex-col gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
            {menuItems.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.id

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id)
                    navigate(`?tab=${item.id}${role ? `&role=${role}` : ''}`, { replace: true })
                  }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all whitespace-nowrap shrink-0 ${
                    isActive
                      ? "bg-white border-l-4 border-l-[#F38F24] text-[#F38F24] shadow-sm font-black"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[#F38F24]' : 'text-slate-400'}`} />
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Content Panel */}
        <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm p-6 md:p-10">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-[#F38F24]" />
              <p className="mt-4 text-slate-500 font-medium">Loading document...</p>
            </div>
          ) : (
            <div>
              <div 
                className="prose prose-slate max-w-none
                  prose-headings:text-slate-900 prose-headings:font-black prose-headings:tracking-tight
                  prose-h1:text-2xl prose-h1:mb-6 prose-h1:pb-3 prose-h1:border-b prose-h1:border-slate-100
                  prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-2
                  prose-p:text-slate-600 prose-p:text-sm prose-p:leading-relaxed prose-p:mb-4
                  prose-strong:text-slate-800
                  text-sm leading-relaxed text-slate-600
                  [&_h1]:text-2xl [&_h1]:font-black [&_h1]:text-slate-900 [&_h1]:mb-2 [&_h1]:pb-3 [&_h1]:border-b [&_h1]:border-slate-100
                  [&_h2]:text-xl [&_h2]:font-black [&_h2]:text-slate-900 [&_h2]:mt-8 [&_h2]:mb-2
                  [&_h3]:text-lg [&_h3]:font-black [&_h3]:text-slate-900 [&_h3]:mt-8 [&_h3]:mb-2
                  [&_p]:mb-3 [&_strong]:text-slate-800 [&_a]:text-[#F38F24] [&_a]:underline
                  [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-4 [&_li]:mb-1.5"
                dangerouslySetInnerHTML={{ __html: withBrand(pageContent) }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
