import { Navigate, Route, Routes } from "react-router-dom"
import { QuickLocationProvider } from "./context/QuickLocationContext"
import { QuickCartProvider } from "./context/QuickCartContext"
import QuickHeader from "./components/QuickHeader"
import { CartBar, ReplaceStoreDialog } from "./components/CartBar"
import Home from "./pages/Home"
import Browse from "./pages/Browse"
import StorePage from "./pages/StorePage"
import CartPage from "./pages/CartPage"
import { OrderDetail, OrdersList } from "./pages/Orders"

/**
 * Quick commerce for customers, at /quick.
 *
 * Groceries and daily essentials from stores near the customer, delivered in
 * minutes, on the existing quick-commerce backend (/api/v1/qc). The look is
 * the warehouses Quick storefront's; the data model is quick commerce's own:
 * stores near you, one store per order.
 *
 * Paths below are relative to the /quick mount; links inside the module are
 * written as absolute /quick/... paths.
 */
export default function QuickApp() {
  return (
    <QuickLocationProvider>
      <QuickCartProvider>
        <div className="wh-desktop min-h-screen bg-[#F5F5F5] pb-24 text-wh-text">
          <QuickHeader />
          <main>
            <Routes>
              <Route index element={<Home />} />
              <Route path="category/:categoryId" element={<Browse mode="category" />} />
              <Route path="search" element={<Browse mode="search" />} />
              <Route path="store/:storeId" element={<StorePage />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="orders" element={<OrdersList />} />
              <Route path="orders/:orderId" element={<OrderDetail />} />
              <Route path="*" element={<Navigate to="/quick" replace />} />
            </Routes>
          </main>
          <CartBar />
          <ReplaceStoreDialog />
        </div>
      </QuickCartProvider>
    </QuickLocationProvider>
  )
}
