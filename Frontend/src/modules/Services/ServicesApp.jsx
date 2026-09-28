import { useEffect } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { BasketProvider } from "./context/BasketContext"
import { FavouritesProvider } from "./context/FavouritesContext"
import ServicesHeader from "./components/ServicesHeader"
import { BasketBar, ReplaceBasketDialog } from "./components/BasketBar"
import Home from "./pages/Home"
import Browse from "./pages/Browse"
import ServiceDetail from "./pages/ServiceDetail"
import ProviderProfile from "./pages/ProviderProfile"
import Checkout from "./pages/Checkout"
import Bookings from "./pages/Bookings"
import BookingDetail from "./pages/BookingDetail"
import Saved from "./pages/Saved"
import Referral from "./pages/Referral"

/**
 * Service booking for customers, at /services.
 *
 * Home repairs, cleaning, appliances and the like, on the Service Provider
 * backend (/api/v1/sp): browse categories and services, book one or more
 * services from a category for a date and time slot, then follow the booking
 * as a professional is dispatched, arrives and finishes -- and rate it. Also
 * professionals' profiles, saved services and refer-and-earn.
 *
 * Paths below are relative to the /services mount; links inside the module
 * are written as absolute /services/... paths.
 */
export default function ServicesApp() {
  const { pathname } = useLocation()
  // Each screen starts at the top; the router keeps the previous scroll otherwise.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <BasketProvider>
      <FavouritesProvider>
        <div className="min-h-screen bg-[#F7F7FA] text-gray-900">
          <ServicesHeader />
          <main>
            <Routes>
              <Route index element={<Home />} />
              <Route path="category/:categoryId" element={<Browse mode="category" />} />
              <Route path="search" element={<Browse mode="search" />} />
              <Route path="service/:serviceId" element={<ServiceDetail />} />
              <Route path="pro/:providerId" element={<ProviderProfile />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="bookings" element={<Bookings />} />
              <Route path="bookings/:bookingId" element={<BookingDetail />} />
              <Route path="saved" element={<Saved />} />
              <Route path="refer" element={<Referral />} />
              <Route path="*" element={<Navigate to="/services" replace />} />
            </Routes>
          </main>
          <BasketBar />
          <ReplaceBasketDialog />
        </div>
      </FavouritesProvider>
    </BasketProvider>
  )
}
