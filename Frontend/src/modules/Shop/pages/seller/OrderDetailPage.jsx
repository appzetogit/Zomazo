import { useState, useEffect } from "react"
import { useParams } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { 
  ArrowLeft, 
  Clock, 
  MapPin, 
  User, 
  Phone, 
  Package, 
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Printer,
  Copy,
  Navigation,
  History,
  Wallet,
  X,
  Truck,
  ExternalLink,
} from "lucide-react"
import { sellerAPI } from "@store/api"
import { toast } from "sonner"
import useSellerBackNavigation from "@store/hooks/useSellerBackNavigation"
import { getTimelineStatusLabel, getTimelineRoleLabel } from "@store/utils/orderStatus"
import { getSellerCookingNote } from "@store/utils/orderCookingNote"

const formatMoney = (value) => `₹${Number(value || 0).toFixed(2)}`
const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function OrderDetailPage({
  orderId: propOrderId = null,
  isSidebar = false,
  onClose = null,
}) {
  const { id: paramId } = useParams()
  const goBack = useSellerBackNavigation()
  const id = propOrderId || paramId
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [generatingShipment, setGeneratingShipment] = useState(false)
  const [trackingData, setTrackingData] = useState(null)
  const [loadingTracking, setLoadingTracking] = useState(false)

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await sellerAPI.getOrderById(id)
        
        // Backend returns { success: true, data: { order: { ... } } }
        const orderData = response.data?.data?.order || response.data?.order || response.data?.data
        
        if (orderData) {
          setOrder(orderData)
        } else {
          setError("Order details not found in response")
        }
      } catch (err) {
        console.error("Error fetching order:", err)
        setError(err.response?.data?.message || "Failed to fetch order details")
      } finally {
        setLoading(false)
      }
    }

    if (id) {
      fetchOrder()
    }
  }, [id])

  const handleClose = () => {
    if (isSidebar && typeof onClose === "function") {
      onClose()
      return
    }
    goBack()
  }

  const handleCopyId = (e) => {
    if (e) e.stopPropagation()
    const orderId = order?.orderId || order?.order_id || id
    navigator.clipboard.writeText(orderId)
    toast.success("Order ID copied")
  }

  const handleGenerateShipment = async () => {
    try {
      setGeneratingShipment(true)
      const res = await sellerAPI.createOrderShipment(order.orderId || order._id || id)
      const updatedOrder = res.data?.data?.order || res.data?.order || res.data?.data
      const shipment = res.data?.data?.shipment || updatedOrder?.shipment
      if (updatedOrder || shipment) {
        setOrder((prev) => ({
          ...prev,
          ...(updatedOrder || {}),
          shipment: shipment || prev?.shipment,
        }))
        toast.success("Courier shipment & AWB generated successfully!")
      }
    } catch (err) {
      console.error("Error generating shipment:", err)
      toast.error(err.response?.data?.message || "Failed to generate courier shipment")
    } finally {
      setGeneratingShipment(false)
    }
  }

  const handleTrackShipment = async () => {
    try {
      setLoadingTracking(true)
      const res = await sellerAPI.trackOrderShipment(order.orderId || order._id || id)
      const tracking = res.data?.data?.tracking || res.data?.tracking
      setTrackingData(tracking)
    } catch (err) {
      console.error("Error tracking shipment:", err)
      toast.error(err.response?.data?.message || "Failed to fetch tracking details")
    } finally {
      setLoadingTracking(false)
    }
  }

  const getStatusColor = (status) => {
    const s = String(status || "").toLowerCase()
    if (s.includes("delivered") || s === "completed") return "bg-emerald-50 text-emerald-700 border-emerald-200"
    if (s.includes("cancel") || s === "rejected") return "bg-rose-50 text-rose-700 border-rose-200"
    if (s === "preparing") return "bg-sky-50 text-sky-700 border-sky-200"
    if (s === "ready_for_pickup") return "bg-indigo-50 text-indigo-700 border-indigo-200"
    return "bg-amber-50 text-amber-700 border-amber-200"
  }

  if (loading) {
    return (
      <div className={`${isSidebar ? "h-full min-h-[400px]" : "min-h-screen"} bg-[#F8F9FB] flex items-center justify-center p-6`}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
            <div className="absolute inset-0 bg-blue-600/10 rounded-full blur-xl animate-pulse"></div>
          </div>
          <p className="text-gray-500 font-bold text-sm tracking-wide uppercase">Preparing Details</p>
        </div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className={`${isSidebar ? "h-full min-h-[400px]" : "min-h-screen"} bg-[#F8F9FB]`}>
        <header className={`bg-white px-5 py-4 border-b border-gray-100 flex items-center gap-4 ${isSidebar ? "shrink-0" : "sticky top-0 z-50"}`}>
          <button type="button" onClick={handleClose} className="p-2 hover:bg-gray-50 rounded-xl transition-colors">
            {isSidebar ? <X className="w-6 h-6 text-gray-900" /> : <ArrowLeft className="w-6 h-6 text-gray-900" />}
          </button>
          <h1 className="text-lg font-black text-gray-900">Order Details</h1>
        </header>
        <div className="p-10 flex flex-col items-center text-center gap-6">
          <div className="w-20 h-20 bg-rose-50 rounded-3xl flex items-center justify-center rotate-3">
            <AlertCircle className="w-10 h-10 text-rose-500 -rotate-3" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Order Not Found</h2>
            <p className="text-gray-500 leading-relaxed max-w-xs">{error || "The order you're looking for doesn't exist or has been removed."}</p>
          </div>
          {!isSidebar && (
            <button 
              type="button"
              onClick={handleClose}
              className="w-full max-w-xs py-4 bg-gray-900 text-white rounded-2xl font-black shadow-xl shadow-gray-200 active:scale-95 transition-transform"
            >
              Back to Orders
            </button>
          )}
        </div>
      </div>
    )
  }

  const items = order.items || []
  const status = order.orderStatus || order.status || "Created"
  const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }) : "Date not available"

  const customerName = order.customerName || order.userId?.name || order.userId?.fullName || order.deliveryAddress?.fullName || order.deliveryAddress?.name || "Customer"
  const customerPhone = order.customerPhone || order.userId?.phone || order.deliveryAddress?.phone || "No phone provided"
  const deliveryAddress = order.deliveryAddress?.formattedAddress || order.deliveryAddress?.address || 
                         (order.deliveryAddress?.street ? `${order.deliveryAddress.street}, ${order.deliveryAddress.city || ""}` : "Address not specified")
  const cookingNote = getSellerCookingNote(order)

  return (
    <div className={`${isSidebar ? "h-full flex flex-col overflow-hidden" : "min-h-screen"} bg-[#F8F9FB] ${isSidebar ? "" : "pb-[calc(5rem+env(safe-area-inset-bottom))]"}`}>
      {/* Premium Header */}
      <header className={`bg-white/80 backdrop-blur-xl px-5 py-4 border-b border-gray-100 flex items-center justify-between ${isSidebar ? "shrink-0" : "sticky top-0 z-50"}`}>
        <div className="flex items-center gap-4">
          <button type="button" onClick={handleClose} className="p-2 hover:bg-gray-50 rounded-xl transition-colors">
            {isSidebar ? <X className="w-6 h-6 text-gray-900" /> : <ArrowLeft className="w-6 h-6 text-gray-900" />}
          </button>
          <div className="flex flex-col">
            <h1 className="text-lg font-black text-gray-900 leading-none">Order Details</h1>
            <p className="text-[10px] font-bold text-gray-400 mt-1 tracking-wider uppercase">{createdAt}</p>
          </div>
        </div>
      </header>

      <div className={`p-4 space-y-4 ${isSidebar ? "flex-1 overflow-y-auto" : "max-w-2xl mx-auto"}`}>
        {/* Status Card - Mobile Friendly & Polished */}
        <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm shadow-gray-100/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-3 py-1.5 rounded-xl text-[10px] font-black tracking-[0.05em] border ${getStatusColor(status)}`}>
                {status.replace(/_/g, ' ').toUpperCase()}
              </span>
              {(order.payment?.method || order.paymentMethod) && (
                <span className="px-3 py-1.5 rounded-xl text-[10px] font-black tracking-[0.05em] bg-gray-50 text-gray-600 border border-gray-100">
                  {String(order.payment?.method || order.paymentMethod).replace(/_/g, ' ').toUpperCase()}
                </span>
              )}
            </div>
            <button 
              onClick={handleCopyId}
              className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-xl border border-gray-100 text-gray-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-100 active:scale-95 transition-all"
            >
              <span className="text-[11px] font-black font-mono text-gray-600">#{order.orderId || order.order_id || id}</span>
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Customer & Delivery Section */}
        <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm shadow-gray-100/50 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-2xl flex items-center justify-center">
                <User className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Customer</h3>
                <p className="text-base font-black text-gray-900">{customerName}</p>
              </div>
            </div>
            {customerPhone && customerPhone !== "No phone provided" && (
              <a 
                href={`tel:${customerPhone}`}
                className="w-12 h-12 bg-emerald-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-200 active:scale-90 transition-transform"
              >
                <Phone className="w-5 h-5" />
              </a>
            )}
          </div>

          <div className="pt-5 border-t border-gray-50 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-rose-50 rounded-2xl flex items-center justify-center">
                <MapPin className="w-5 h-5 text-rose-500" />
              </div>
              <div>
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Delivery Address</h3>
                <p className="text-sm font-bold text-gray-700 leading-relaxed mt-0.5">{deliveryAddress}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Courier Fulfilment & Shipping Label */}
        <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm shadow-gray-100/50 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-2xl flex items-center justify-center">
                <Truck className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h3 className="text-sm font-black text-gray-900">Courier Fulfilment</h3>
                <p className="text-[10px] font-bold text-gray-400">Standard Shipping & AWB Generation</p>
              </div>
            </div>
            {order.shipment?.awb && (
              <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-[10px] font-black uppercase tracking-wider">
                AWB Assigned
              </span>
            )}
          </div>

          {order.shipment?.awb ? (
            <div className="bg-gradient-to-br from-indigo-50/50 to-slate-50 border border-indigo-100 rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Courier Partner</p>
                  <p className="text-sm font-black text-gray-900">{order.shipment.courierName || 'MockExpress'}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">AWB Number</p>
                  <p className="text-sm font-black font-mono text-indigo-600 tracking-wide">{order.shipment.awb}</p>
                </div>
              </div>

              {order.shipment.etd && (
                <div className="flex items-center justify-between text-xs font-bold text-gray-500 pt-2 border-t border-indigo-100/60">
                  <span>Estimated Delivery</span>
                  <span className="text-gray-900 font-black">
                    {new Date(order.shipment.etd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                {order.shipment.labelUrl && (
                  <a
                    href={order.shipment.labelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-xl text-xs font-black shadow-md shadow-indigo-200 transition-all"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print Shipping Label
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleTrackShipment}
                  disabled={loadingTracking}
                  className="inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-white border border-gray-200 hover:bg-gray-50 active:scale-95 text-gray-700 rounded-xl text-xs font-black transition-all"
                >
                  {loadingTracking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}
                  Live Track
                </button>
              </div>

              {trackingData && (
                <div className="mt-3 pt-3 border-t border-indigo-100/60 space-y-2">
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
                    Status: <span className="text-indigo-600 font-black uppercase">{trackingData.currentStatus}</span>
                  </p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {trackingData.trackingEvents?.map((ev, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-[11px]">
                        <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1 shrink-0" />
                        <div className="flex-1">
                          <p className="font-bold text-gray-800">{ev.activity}</p>
                          <p className="text-[10px] text-gray-400">{ev.location} • {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-4 text-center space-y-3">
              <p className="text-xs font-bold text-gray-500">
                Pack this order and generate an automated courier AWB and printable shipping label.
              </p>
              <button
                type="button"
                onClick={handleGenerateShipment}
                disabled={generatingShipment || String(status || '').toLowerCase().includes('cancel')}
                className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 bg-gray-900 hover:bg-black active:scale-[0.98] text-white rounded-xl text-xs font-black shadow-lg shadow-gray-200 transition-all disabled:opacity-50"
              >
                {generatingShipment ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating AWB & Label...
                  </>
                ) : (
                  <>
                    <Truck className="w-4 h-4 text-indigo-400" />
                    Pack & Generate Courier Label
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Order Items */}
        <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm shadow-gray-100/50 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 rounded-2xl flex items-center justify-center">
                <Package className="w-5 h-5 text-amber-500" />
              </div>
              <h3 className="text-sm font-black text-gray-900">Order Items</h3>
            </div>
            <span className="px-3 py-1 bg-gray-100 rounded-full text-[10px] font-black text-gray-500">{items.length} Items</span>
          </div>

          <div className="space-y-5">
            {items.map((item, idx) => (
              <div key={idx} className="flex gap-4">
                <div className="w-16 h-16 bg-gray-50 rounded-2xl overflow-hidden shrink-0 border border-gray-100">
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <Package className="w-8 h-8" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex justify-between items-start gap-2">
                    <p className="text-sm font-black text-gray-900 leading-tight pr-2">{item.name}</p>
                    <p className="text-sm font-black text-gray-900 whitespace-nowrap">{formatMoney(item.price * item.quantity)}</p>
                  </div>
                  <p className="text-[11px] font-bold text-gray-400 mt-1 uppercase tracking-tighter">
                    {item.quantity} × {formatMoney(item.price)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Earnings & Deductions */}
        {order.finance && (
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm shadow-gray-100/50 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-emerald-50 rounded-2xl flex items-center justify-center">
                <Wallet className="w-5 h-5 text-emerald-600" />
              </div>
              <h3 className="text-sm font-black text-gray-900">Your Earnings</h3>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-xs font-bold text-gray-500 uppercase tracking-wider">
                <span>Item Total</span>
                <span className="text-gray-900">{formatMoney(order.finance.itemTotal)}</span>
              </div>
              {toNumber(order.finance.packagingFee) > 0 && (
                <div className="flex justify-between text-xs font-bold text-gray-500 uppercase tracking-wider">
                  <span>Packaging Fee</span>
                  <span className="text-gray-900">{formatMoney(order.finance.packagingFee)}</span>
                </div>
              )}
              {toNumber(order.finance.commission) > 0 && (
                <div className="flex justify-between text-xs font-black text-rose-600 uppercase tracking-wider">
                  <span>Platform Commission</span>
                  <span>-{formatMoney(order.finance.commission)}</span>
                </div>
              )}
              {toNumber(order.finance.sellerDiscountShare) > 0 && (
                <div className="flex justify-between text-xs font-black text-rose-600 uppercase tracking-wider">
                  <span>Your Discount Share</span>
                  <span>-{formatMoney(order.finance.sellerDiscountShare)}</span>
                </div>
              )}
              <div className="pt-4 border-t border-gray-50 flex justify-between items-center">
                <span className="text-sm font-black text-gray-900 tracking-tight">Net Payout</span>
                <span className="text-xl font-black text-emerald-600 tabular-nums tracking-tighter">{formatMoney(order.finance.netPayout)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${order.finance.isSettled ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className="text-[10px] font-black uppercase tracking-[0.05em] text-gray-500">
                  {order.finance.isSettled
                    ? `Settled${order.finance.settledAt ? ` on ${new Date(order.finance.settledAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`
                    : 'Settlement Pending'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Order Timeline */}
        {Array.isArray(order.statusHistory) && order.statusHistory.length > 0 && (
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm shadow-gray-100/50 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-violet-50 rounded-2xl flex items-center justify-center">
                <History className="w-5 h-5 text-violet-600" />
              </div>
              <h3 className="text-sm font-black text-gray-900">Order Timeline</h3>
            </div>

            <div className="space-y-0">
              {[...order.statusHistory]
                .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0))
                .map((entry, idx, arr) => {
                  const isLast = idx === arr.length - 1
                  const isCancelled = String(entry.to || '').includes('cancel')
                  return (
                    <div key={idx} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-3 h-3 rounded-full border-2 mt-1 shrink-0 ${isCancelled ? 'bg-rose-500 border-rose-200' : isLast ? 'bg-blue-600 border-blue-200' : 'bg-emerald-500 border-emerald-200'}`} />
                        {!isLast && <div className="w-0.5 flex-1 bg-gray-100 my-1" />}
                      </div>
                      <div className={`flex-1 min-w-0 ${isLast ? '' : 'pb-4'}`}>
                        <div className="flex justify-between items-start gap-2">
                          <p className={`text-xs font-black leading-tight ${isCancelled ? 'text-rose-600' : 'text-gray-900'}`}>
                            {getTimelineStatusLabel(entry.to)}
                          </p>
                          <p className="text-[10px] font-bold text-gray-400 whitespace-nowrap">
                            {entry.at
                              ? new Date(entry.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
                              : ''}
                          </p>
                        </div>
                        {getTimelineRoleLabel(entry.byRole) && (
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">
                            by {getTimelineRoleLabel(entry.byRole)}
                          </p>
                        )}
                        {entry.note && (
                          <p className="text-[11px] font-medium text-gray-500 mt-1 leading-snug">{entry.note}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        {/* Notes/Instructions if any */}
        {cookingNote ? (
          <div className="bg-blue-50/50 border border-blue-100 rounded-3xl p-5 space-y-2">
            <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Cooking Requests</h3>
            <p className="text-sm font-bold text-blue-700 italic">"{cookingNote}"</p>
          </div>
        ) : null}

        {/* Rejection/Cancellation Reason */}
        {(order.rejectionReason || order.cancellationReason) && (
          <div className="bg-rose-50 border border-rose-100 rounded-3xl p-5 space-y-2">
            <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest">
              Reason for {status.includes('REJECTED') ? 'Rejection' : 'Cancellation'}
            </p>
            <p className="text-sm font-bold text-rose-700">{order.rejectionReason || order.cancellationReason}</p>
          </div>
        )}
      </div>
      
      {/* Fixed Bottom Action */}
      {!isSidebar && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-xl border-t border-gray-100 z-50 flex gap-3">
          <button 
            type="button"
            onClick={handleClose}
            className="flex-1 bg-gray-900 text-white py-4 rounded-2xl font-black shadow-xl shadow-gray-200 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to List
          </button>
        </div>
      )}
    </div>
  )
}
