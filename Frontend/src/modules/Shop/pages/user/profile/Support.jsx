import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import AnimatedPage from "@store/components/user/AnimatedPage"
import { Button } from "@store/components/ui/button"
import { Input } from "@store/components/ui/input"
import { Textarea } from "@store/components/ui/textarea"
import { Card, CardContent } from "@store/components/ui/card"
import { orderAPI, sellerAPI, supportAPI, authAPI } from "@store/api"
import { toast } from "sonner"
import { ArrowLeft, Building2, HelpCircle, ShoppingBag, ChevronRight } from "lucide-react"

export default function Support() {
  const [step, setStep] = useState("pick")
  const [type, setType] = useState("")
  const [orders, setOrders] = useState([])
  const [sellers, setSellers] = useState([])
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [selectedSeller, setSelectedSeller] = useState(null)
  const [issueType, setIssueType] = useState("")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [tickets, setTickets] = useState([])
  const [loadingTickets, setLoadingTickets] = useState(false)
  const [orderSearch, setOrderSearch] = useState("")
  const [sellerSearch, setSellerSearch] = useState("")

  useEffect(() => {
    setLoadingTickets(true)
    authAPI
      .getCurrentUser()
      .catch(() => null)
      .finally(async () => {
        try {
          const res = await supportAPI.getMyTickets()
          const list = res?.data?.data?.tickets || res?.data?.tickets || []
          setTickets(list)
        } catch (_) {}
        setLoadingTickets(false)
      })
  }, [])

  const orderIssues = ["Item missing", "Wrong item", "Not delivered", "Payment issue"]
  const sellerIssues = ["Bad service", "Wrong info", "Other"]

  const fetchOrders = async () => {
    try {
      const res = await orderAPI.getOrders({ limit: 10, page: 1 })
      const list = res?.data?.data?.orders || res?.data?.orders || []
      setOrders(list)
    } catch {
      toast.error("Failed to load orders")
    }
  }

  const fetchSellers = async () => {
    try {
      const res = await sellerAPI.getSellers({ limit: 20, page: 1 })
      const list = res?.data?.data?.sellers || res?.data?.sellers || []
      setSellers(list)
    } catch {
      toast.error("Failed to load sellers")
    }
  }

  const handlePick = (t) => {
    setType(t)
    setOrderSearch("")
    setSellerSearch("")
    if (t === "order") {
      fetchOrders()
      setStep("choose_order")
    } else if (t === "seller") {
      fetchSellers()
      setStep("choose_seller")
    } else {
      setStep("other_form")
    }
  }

  const submitTicket = async (payload) => {
    setSubmitting(true)
    try {
      const res = await supportAPI.createTicket(payload)
      const data = res?.data
      if (!data?.success) throw new Error(data?.message || "Failed")
      toast.success("Ticket created")
      setTickets((prev) => [data?.data?.ticket, ...prev])
      setStep("pick")
      setType("")
      setSelectedOrder(null)
      setSelectedSeller(null)
      setIssueType("")
      setSubject("")
      setDescription("")
    } catch (e) {
      const message =
        e?.response?.data?.message ||
        e?.message ||
        "Failed to create ticket"
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const statusClasses = (status) => {
    const s = String(status || "").toLowerCase()
    if (s === "resolved" || s === "closed") return "bg-green-100 text-green-700"
    if (s === "open") return "bg-amber-100 text-amber-700"
    return "bg-slate-100 text-slate-700"
  }

  const getOrderLabel = (order) => {
    const sellerName = order?.sellerName || order?.seller?.sellerName || "Seller"
    const dateValue = order?.createdAt || order?.date
    const dateLabel = dateValue ? new Date(dateValue).toLocaleDateString() : "No date"
    const amount = order?.pricing?.total ?? order?.total ?? 0
    return `${sellerName} • ${dateLabel} • ₹${amount}`
  }

  const getSellerLabel = (seller) => {
    const name = seller?.sellerName || seller?.name || "Seller"
    const location = seller?.city || seller?.area || ""
    return `${name}${location ? ` • ${location}` : ""}`
  }

  const filteredOrders = orders.filter((order) => {
    const q = orderSearch.trim().toLowerCase()
    if (!q) return true
    const sellerName = (order?.sellerName || order?.seller?.sellerName || "").toLowerCase()
    const orderId = String(order?._id || order?.id || "").toLowerCase()
    return sellerName.includes(q) || orderId.includes(q)
  })

  const filteredSellers = sellers.filter((seller) => {
    const q = sellerSearch.trim().toLowerCase()
    if (!q) return true
    const name = String(seller?.sellerName || seller?.name || "").toLowerCase()
    const city = String(seller?.city || seller?.area || "").toLowerCase()
    const id = String(seller?._id || seller?.id || "").toLowerCase()
    return name.includes(q) || city.includes(q) || id.includes(q)
  })

  const handleOrderSearchChange = (value) => {
    setOrderSearch(value)
    const normalized = value.trim().toLowerCase()
    if (!normalized) return
    const selected = filteredOrders.find((o) => getOrderLabel(o).toLowerCase() === normalized)
    if (selected) {
      setSelectedOrder(selected)
      setStep("order_issue")
    }
  }

  const handleSellerSearchChange = (value) => {
    setSellerSearch(value)
    const normalized = value.trim().toLowerCase()
    if (!normalized) return
    const selected = filteredSellers.find((r) => getSellerLabel(r).toLowerCase() === normalized)
    if (selected) {
      setSelectedSeller(selected)
      setStep("seller_issue")
    }
  }

  const TicketList = () => (
    <Card className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm border border-slate-200 dark:border-gray-800">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">My Tickets</h3>
          <span className="text-xs font-medium px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            {tickets.length}
          </span>
        </div>

        {loadingTickets ? (
          <p className="text-sm text-slate-500">Loading tickets...</p>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-slate-500">No tickets yet</p>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => (
              <div key={t._id || t.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-white dark:bg-[#171717]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      #{String(t._id || t.id).slice(-6)} • {t.type} • {t.issueType}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">{new Date(t.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${statusClasses(t.status)}`}>
                    {t.status}
                  </span>
                </div>
                {t.adminResponse ? (
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">Reply: {t.adminResponse}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <AnimatedPage className="min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a]">
      <div className="max-w-md md:max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-4 sm:py-6 md:py-8 pb-20">
        <div className="mb-4">
          <Link to="/user/profile">
            <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
              <ArrowLeft className="h-5 w-5 text-black dark:text-white" />
            </Button>
          </Link>
        </div>

        <Card className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm border border-slate-200 dark:border-gray-800 mb-3">
          <CardContent className="p-4">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Help & Support</h1>
            <p className="text-sm text-slate-500 mt-1">Raise a support ticket and track updates in one place.</p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm border border-slate-200 dark:border-gray-800 mb-3">
          <CardContent className="p-4 space-y-4">
            {step === "pick" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button onClick={() => handlePick("order")} className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="flex items-center justify-between">
                    <ShoppingBag className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                  <p className="mt-3 font-semibold text-slate-900 dark:text-white">Order Issue</p>
                  <p className="text-xs text-slate-500 mt-1">Missing item, wrong item, delivery issue</p>
                </button>

                <button onClick={() => handlePick("seller")} className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="flex items-center justify-between">
                    <Building2 className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                  <p className="mt-3 font-semibold text-slate-900 dark:text-white">Seller Issue</p>
                  <p className="text-xs text-slate-500 mt-1">Service, listing info, behavior report</p>
                </button>

                <button onClick={() => handlePick("other")} className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="flex items-center justify-between">
                    <HelpCircle className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                  <p className="mt-3 font-semibold text-slate-900 dark:text-white">Other Issue</p>
                  <p className="text-xs text-slate-500 mt-1">Account, app, payment or general query</p>
                </button>
              </div>
            )}

            {step === "choose_order" && (
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 dark:text-white">Select an order</h3>
                {orders.length > 0 ? (
                  <div className="space-y-2">
                    <Input
                      list="support-order-options"
                      value={orderSearch}
                      onChange={(e) => handleOrderSearchChange(e.target.value)}
                      placeholder="Select/search order"
                    />
                    <datalist id="support-order-options">
                      {filteredOrders.map((o) => (
                        <option key={o._id || o.id} value={getOrderLabel(o)}>
                          {getOrderLabel(o)}
                        </option>
                      ))}
                    </datalist>
                    {filteredOrders.length === 0 ? <p className="text-sm text-slate-500">No matching orders found</p> : null}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No recent orders found</p>
                )}
                <Button variant="outline" onClick={() => setStep("pick")}>Back</Button>
              </div>
            )}

            {step === "order_issue" && selectedOrder && (
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 dark:text-white">Issue type</h3>
                <div className="grid grid-cols-2 gap-2">
                  {orderIssues.map((it) => (
                    <Button key={it} variant={issueType === it ? "default" : "outline"} onClick={() => setIssueType(it)}>{it}</Button>
                  ))}
                </div>
                <Textarea placeholder="Describe the issue (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
                <div className="flex gap-2">
                  <Button onClick={() => submitTicket({ type: "order", orderId: selectedOrder._id || selectedOrder.id, issueType, description })} disabled={!issueType || submitting}>
                    {submitting ? "Submitting..." : "Submit Ticket"}
                  </Button>
                  <Button variant="outline" onClick={() => setStep("pick")}>Cancel</Button>
                </div>
              </div>
            )}

            {step === "choose_seller" && (
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 dark:text-white">Select a seller</h3>
                {sellers.length > 0 ? (
                  <div className="space-y-2">
                    <Input
                      list="support-seller-options"
                      value={sellerSearch}
                      onChange={(e) => handleSellerSearchChange(e.target.value)}
                      placeholder="Select/search seller"
                    />
                    <datalist id="support-seller-options">
                      {filteredSellers.map((r) => (
                        <option key={r._id || r.id} value={getSellerLabel(r)}>
                          {getSellerLabel(r)}
                        </option>
                      ))}
                    </datalist>
                    {filteredSellers.length === 0 ? <p className="text-sm text-slate-500">No matching sellers found</p> : null}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No sellers found</p>
                )}
                <Button variant="outline" onClick={() => setStep("pick")}>Back</Button>
              </div>
            )}

            {step === "seller_issue" && selectedSeller && (
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 dark:text-white">Issue type</h3>
                <div className="grid grid-cols-2 gap-2">
                  {sellerIssues.map((it) => (
                    <Button key={it} variant={issueType === it ? "default" : "outline"} onClick={() => setIssueType(it)}>{it}</Button>
                  ))}
                </div>
                <Textarea placeholder="Describe the issue (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
                <div className="flex gap-2">
                  <Button onClick={() => submitTicket({ type: "seller", sellerId: selectedSeller._id || selectedSeller.id, issueType, description })} disabled={!issueType || submitting}>
                    {submitting ? "Submitting..." : "Submit Ticket"}
                  </Button>
                  <Button variant="outline" onClick={() => setStep("pick")}>Cancel</Button>
                </div>
              </div>
            )}

            {step === "other_form" && (
              <div className="space-y-3">
                <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                <Textarea placeholder="Describe your issue" value={description} onChange={(e) => setDescription(e.target.value)} />
                <div className="flex gap-2">
                  <Button onClick={() => submitTicket({ type: "other", issueType: subject || "Other", description })} disabled={!subject || submitting}>
                    {submitting ? "Submitting..." : "Submit Ticket"}
                  </Button>
                  <Button variant="outline" onClick={() => setStep("pick")}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <TicketList />
      </div>
    </AnimatedPage>
  )
}
