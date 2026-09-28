import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { ArrowLeft } from "lucide-react"
import { isQcSeller } from "@food/utils/sellerVertical"

export default function ManageOutlets() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()

  // Every entry opens the screen that edits that part of the outlet's profile.
  // Stores (quick commerce) are served by zones rather than a delivery radius.
  const options = [
    { label: "Timings", route: "/restaurant/outlet-timings" },
    { label: "Contacts", route: "/restaurant/phone" },
    { label: "FSSAI Food License", route: "/restaurant/fssai" },
    { label: "Bank account details", route: "/restaurant/update-bank-details" },
    { label: "Profile picture", route: "/restaurant/outlet-info" },
    { label: "Name, address, location", route: "/restaurant/outlet-info" },
    { label: "Ratings, reviews", route: "/restaurant/ratings-reviews" },
    { label: "Delivery area", route: isQcSeller() ? "/restaurant/zone-setup" : "/restaurant/delivery-radius" },
  ]

  return (
    <div className="min-h-screen bg-neutral-50/60 flex flex-col pb-28 text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-3.5 flex items-center gap-3 border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto w-full flex items-center gap-3">
          <button
            onClick={goBack}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">Manage Outlet Settings</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Update profile credentials, timings, address and compliance documents</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-3xl mx-auto w-full flex-1 px-4 sm:px-6 py-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/70">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">Configuration Shortcuts</p>
          </div>

          {/* Options List */}
          <div className="divide-y divide-gray-100">
            {options.map((option) => (
              <button
                key={option.label}
                onClick={() => navigate(option.route)}
                className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-gray-50 transition-colors group"
              >
                <span className="text-sm font-semibold text-gray-900 group-hover:text-black">{option.label}</span>
                <span className="text-gray-400 group-hover:text-gray-900 transition-colors">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
