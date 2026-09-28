import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Textarea } from "@food/components/ui/textarea"
import { Card, CardContent } from "@food/components/ui/card"
import { orderAPI, restaurantAPI, supportAPI, helpDeskAPI } from "@food/api"
import { toast } from "sonner"
import { ArrowLeft, Building2, HelpCircle, ShoppingBag, ChevronRight } from "lucide-react"

/**
 * The super app's help centre. A ticket can be about any order, ride or
 * booking from every service (listed from the cross-service order feed and
 * filed with the service that owns it -- see core/support/customerSupport),
 * about a restaurant, or about the account. "My tickets" lists them all.
 */
export default function Support() {
  const [step, setStep] = useState("pick")
  const [type, setType] = useState("")
  const [orders, setOrders] = useState([])
  const [restaurants, setRestaurants] = useState([])
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [selectedRestaurant, setSelectedRestaurant] = useState(null)
  const [issueType, setIssueType] = useState("")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [tickets, setTickets] = useState([])
  const [loadingTickets, setLoadingTickets] = useState(false)
  const [orderSearch, setOrderSearch] = useState("")
  const [restaurantSearch, setRestaurantSearch] = useState("")

  const loadTickets = async () => {
    setLoadingTickets(true)
    try {
      const res = await helpDeskAPI.getTickets()
      setTickets(res?.data?.data?.tickets || [])
    } catch (_) {
      // The list stays as it was; raising a ticket still works.
    } finally {
      setLoadingTickets(false)
    }
  }

  useEffect(() => {
    loadTickets()
  }, [])

  // Worded to fit a food or grocery order, a ride, a booking or a parcel alike.
  const orderIssues = ["Missing or wrong item", "Late or never arrived", "Payment or refund", "Poor service", "Safety concern", "Something else"]
  const restaurantIssues = ["Bad service", "Wrong info", "Other"]

  const fetchOrders = async () => {
    try {
      // Every service's orders, rides and bookings, newest first.
      const res = await orderAPI.getAllMyOrders({ limit: 50 })
      setOrders(res?.data?.data?.items || [])
    } catch {
      toast.error("Failed to load orders")
    }
  }

  const fetchRestaurants = async () => {
    try {
      const res = await restaurantAPI.getRestaurants({ limit: 20, page: 1 })
      const list = res?.data?.data?.restaurants || res?.data?.restaurants || []
      setRestaurants(list)
    } catch {
      toast.error("Failed to load restaurants")
    }
  }

  const handlePick = (t) => {
    setType(t)
    setOrderSearch("")
    setRestaurantSearch("")
    if (t === "order") {
      fetchOrders()
      setStep("choose_order")
    } else if (t === "restaurant") {
      fetchRestaurants()
      setStep("choose_restaurant")
    } else {
      setStep("other_form")
    }
  }

  // Restaurant complaints stay on food's own ticket desk; everything else goes
  // to the help centre, which files it with the right service.
  const submitTicket = async (payload, { viaFood = false } = {}) => {
    setSubmitting(true)
    try {
      const res = viaFood ? await supportAPI.createTicket(payload) : await helpDeskAPI.createTicket(payload)
      const data = res?.data
      if (!data?.success) throw new Error(data?.message || "Failed")
      toast.success("Ticket created")
      loadTickets()
      setStep("pick")
      setType("")
      setSelectedOrder(null)
      setSelectedRestaurant(null)
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
    if (s === "in_progress") return "bg-blue-100 text-blue-700"
    if (s === "open") return "bg-amber-100 text-amber-700"
    return "bg-slate-100 text-slate-700"
  }

  const getOrderLabel = (order) => {
    const dateLabel = order?.createdAt ? new Date(order.createdAt).toLocaleDateString() : "No date"
    const amount = Number(order?.amount) > 0 ? ` • ₹${order.amount}` : ""
    return `${order?.serviceLabel || "Order"} • ${order?.title || "Order"} • #${order?.number || ""} • ${dateLabel}${amount}`
  }

  const getRestaurantLabel = (restaurant) => {
    const name = restaurant?.restaurantName || restaurant?.name || "Restaurant"
    const location = restaurant?.city || restaurant?.area || ""
    return `${name}${location ? ` • ${location}` : ""}`
  }

  const filteredOrders = orders.filter((order) => {
    const q = orderSearch.trim().toLowerCase()
    if (!q) return true
    return getOrderLabel(order).toLowerCase().includes(q)
  })

  const filteredRestaurants = restaurants.filter((restaurant) => {
    const q = restaurantSearch.trim().toLowerCase()
    if (!q) return true
    const name = String(restaurant?.restaurantName || restaurant?.name || "").toLowerCase()
    const city = String(restaurant?.city || restaurant?.area || "").toLowerCase()
    const id = String(restaurant?._id || restaurant?.id || "").toLowerCase()
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

  const handleRestaurantSearchChange = (value) => {
    setRestaurantSearch(value)
    const normalized = value.trim().toLowerCase()
    if (!normalized) return
    const selected = filteredRestaurants.find((r) => getRestaurantLabel(r).toLowerCase() === normalized)
    if (selected) {
      setSelectedRestaurant(selected)
      setStep("restaurant_issue")
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
              <div key={t.key} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-white dark:bg-[#171717]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      #{t.code} • {t.serviceLabel} • {t.subject}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">{new Date(t.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${statusClasses(t.status)}`}>
                    {String(t.status || "").replace("_", " ")}
                  </span>
                </div>
                {t.orderRef ? <p className="text-xs text-slate-500 mt-1">About #{t.orderRef}</p> : null}
                {t.reply ? (
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">Reply: {t.reply}</p>
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
          <Link to="/account" aria-label="Back to your account">
            <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
              <ArrowLeft className="h-5 w-5 text-black dark:text-white" />
            </Button>
          </Link>
        </div>

        <Card className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm border border-slate-200 dark:border-gray-800 mb-3">
          <CardContent className="p-4">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Help & Support</h1>
            <p className="text-sm text-slate-500 mt-1">Food, rides, groceries, services or the Shop: raise a ticket about anything and track it here.</p>
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
                  <p className="text-xs text-slate-500 mt-1">An order, ride or booking from any service</p>
                </button>

                <button onClick={() => handlePick("restaurant")} className="w-full border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="flex items-center justify-between">
                    <Building2 className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                  <p className="mt-3 font-semibold text-slate-900 dark:text-white">Restaurant Issue</p>
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
                        <option key={o.key} value={getOrderLabel(o)}>
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
                  <Button onClick={() => submitTicket({ service: selectedOrder.service, orderId: selectedOrder.id, issueType, description })} disabled={!issueType || submitting}>
                    {submitting ? "Submitting..." : "Submit Ticket"}
                  </Button>
                  <Button variant="outline" onClick={() => setStep("pick")}>Cancel</Button>
                </div>
              </div>
            )}

            {step === "choose_restaurant" && (
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 dark:text-white">Select a restaurant</h3>
                {restaurants.length > 0 ? (
                  <div className="space-y-2">
                    <Input
                      list="support-restaurant-options"
                      value={restaurantSearch}
                      onChange={(e) => handleRestaurantSearchChange(e.target.value)}
                      placeholder="Select/search restaurant"
                    />
                    <datalist id="support-restaurant-options">
                      {filteredRestaurants.map((r) => (
                        <option key={r._id || r.id} value={getRestaurantLabel(r)}>
                          {getRestaurantLabel(r)}
                        </option>
                      ))}
                    </datalist>
                    {filteredRestaurants.length === 0 ? <p className="text-sm text-slate-500">No matching restaurants found</p> : null}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No restaurants found</p>
                )}
                <Button variant="outline" onClick={() => setStep("pick")}>Back</Button>
              </div>
            )}

            {step === "restaurant_issue" && selectedRestaurant && (
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 dark:text-white">Issue type</h3>
                <div className="grid grid-cols-2 gap-2">
                  {restaurantIssues.map((it) => (
                    <Button key={it} variant={issueType === it ? "default" : "outline"} onClick={() => setIssueType(it)}>{it}</Button>
                  ))}
                </div>
                <Textarea placeholder="Describe the issue (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
                <div className="flex gap-2">
                  <Button onClick={() => submitTicket({ type: "restaurant", restaurantId: selectedRestaurant._id || selectedRestaurant.id, issueType, description }, { viaFood: true })} disabled={!issueType || submitting}>
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
                  <Button onClick={() => submitTicket({ service: "other", issueType: subject || "Other", description })} disabled={!subject || submitting}>
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
