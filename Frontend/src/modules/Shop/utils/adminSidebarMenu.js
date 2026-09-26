const BOTH = ["quick", "shop"]
const QUICK = ["quick"]
const SHOP = ["shop"]

/**
 * One menu for both admin panels. Paths are relative to the panel base
 * (/admin/quick or /admin/shop); `panels` on an item, or failing that on its
 * section, says which panel shows it. Untagged entries appear in both.
 */
const adminSidebarMenuTemplate = [
  {
    type: "link",
    label: "Dashboard",
    path: "",
    icon: "LayoutDashboard",
  },
  {
    type: "link",
    label: "Point of Sale",
    panels: QUICK,
    path: "/point-of-sale",
    icon: "CreditCard",
  },
  {
    type: "section",
    label: "CATALOG MANAGEMENT",
    items: [
      {
        type: "link",
        label: "Product Approval",
        path: "/product-approval",
        icon: "CheckCircle2",
      },
      { type: "link", label: "Product Reviews", path: "/product-reviews", icon: "Star", panels: BOTH },
      { type: "link", label: "Low Stock", path: "/low-stock", icon: "AlertTriangle", panels: BOTH },
      {
        type: "expandable",
        label: "Products",
        icon: "Utensils",
        subItems: [
          { label: "Seller Products List", path: "/products" },
        ],
      },
      {
        type: "link",
        label: "Categories",
        icon: "FolderTree",
        path: "/categories",
      },
      {
        type: "link",
        label: "Attributes & Sets",
        panels: SHOP,
        icon: "FolderTree",
        path: "/attributes",
      },
    ],
  },
  {
    type: "section",
    label: "SELLER MANAGEMENT",
    items: [
      {
        type: "link",
        label: "Zone Setup",
        panels: QUICK,
        path: "/zone-setup",
        icon: "MapPin",
      },
      {
        type: "expandable",
        label: "Sellers",
        icon: "UtensilsCrossed",
        subItems: [
          { label: "Sellers List", path: "/sellers" },
          { label: "New Seller Requests", path: "/sellers/joining-request" },
          { label: "Unregistered Sellers", path: "/sellers/unregistered" },
          { label: "Seller Reviews", path: "/sellers/reviews" },
          { label: "Seller Complaints", path: "/sellers/complaints" },
          { label: "Seller Settings", path: "/sellers/settings" },
          { label: "Subscription Settings", path: "/sellers/subscription-settings" },
          { label: "Subscription Billing", path: "/sellers/subscription-history" },
        ],
      },
    ],
  },
  {
    type: "section",
    label: "ORDER MANAGEMENT",
    items: [
      {
        type: "expandable",
        label: "Orders",
        icon: "FileText",
        subItems: [
          { label: "All", path: "/orders/all" },
          { label: "Pending", path: "/orders/pending" },
          { label: "Processing", path: "/orders/processing" },
          { label: "Out For Delivery", path: "/orders/out-for-delivery", panels: QUICK },
          { label: "Delivered", path: "/orders/delivered" },
          { label: "Cancelled", path: "/orders/canceled" },
          { label: "Seller cancelled", path: "/orders/seller-cancelled" },
          { label: "Payment Failed", path: "/orders/payment-failed" },
          { label: "Refunded", path: "/orders/refunded" },
          { label: "Offline Payments", path: "/orders/offline-payments" },
          { label: "User Carts", path: "/orders/user-carts" },
        ],
      },
      {
        type: "link",
        label: "Order Detect Delivery",
        panels: QUICK,
        path: "/order-detect-delivery",
        icon: "Truck",
      },
      { type: "link", label: "Courier Shipments", panels: SHOP, path: "/shipments", icon: "Truck" },
      { type: "link", label: "Returns", panels: SHOP, path: "/returns", icon: "Package" },
      { type: "link", label: "NDR Queue", panels: SHOP, path: "/shipments/ndr", icon: "AlertTriangle" },
      { type: "link", label: "RTO Queue", panels: SHOP, path: "/shipments/rto", icon: "RotateCcw" },
      { type: "link", label: "COD Remittances", panels: SHOP, path: "/cod-remittances", icon: "Banknote" },
      { type: "link", label: "Checkouts", path: "/checkouts", icon: "Layers" },
    ],
  },
  {
    type: "section",
    label: "PROMOTIONS MANAGEMENT",
    items: [
      {
        type: "link",
        label: "Seller Coupons & Offers",
        path: "/coupons",
        icon: "Gift",
      },
    ],
  },
  {
    type: "section",
    label: "COINS & REWARDS",
    items: [
      { type: "link", label: "Platform Coins", path: "/coins", icon: "Award" },
      { type: "link", label: "Spin Wheel", path: "/spin-campaigns", icon: "Disc3" },
      { type: "link", label: "Push Campaigns", path: "/push-campaigns", icon: "BellRing" },
      { type: "link", label: "First-order Claims", path: "/first-order-claims", icon: "Gift", panels: BOTH },
      { type: "link", label: "Referral Settings", path: "/referral-settings", icon: "Gift" },
    ],
  },
  {
    type: "section",
    label: "CUSTOMER MANAGEMENT",
    items: [
      {
        type: "link",
        label: "Customers",
        path: "/customers",
        icon: "Users",
      },
      {
        type: "link",
        label: "Support Tickets (User & Seller)",
        path: "/support-tickets",
        icon: "MessageSquare",
      },
    ],
  },
  {
    type: "section",
    label: "DELIVERY MANAGEMENT",
    panels: QUICK,
    items: [
      { type: "link", label: "Delivery & Platform Fee", path: "/fee-settings", icon: "DollarSign" },
      { type: "link", label: "Delivery Withdrawal", path: "/delivery-withdrawal", icon: "Wallet" },
      { type: "link", label: "Delivery boy Wallet", path: "/delivery-boy-wallet", icon: "PiggyBank" },
      { type: "link", label: "Delivery Emergency Help", path: "/delivery-emergency-help", icon: "Phone" },
      { type: "link", label: "Delivery Support Tickets", path: "/delivery-support-tickets", icon: "MessageSquare" },
      { type: "link", label: "Order Reassignment Requests", path: "/delivery-order-reassignment-requests", icon: "AlertTriangle" },
      {
        type: "expandable",
        label: "Deliveryman",
        icon: "Package",
        subItems: [
          { label: "New Join Request", path: "/delivery-partners/join-request" },
          { label: "Deliveryman List", path: "/delivery-partners" },
          { label: "Live Tracking", path: "/delivery-partners/live-tracking" },
          { label: "Deliveryman Reviews", path: "/delivery-partners/reviews" },
          { label: "Bonus", path: "/delivery-partners/bonus" },
          { label: "Earning Addon", path: "/delivery-partners/earning-addon" },
          { label: "Earning Addon History", path: "/delivery-partners/earning-addon-history" },
          { label: "Delivery Earning", path: "/delivery-partners/earnings" },
        ],
      },
    ],
  },
  {
    type: "section",
    label: "HELP & SUPPORT",
    items: [
      { type: "link", label: "User Feedback", path: "/contact-messages", icon: "Mail" },
      { type: "link", label: "Safety Emergency Reports", panels: QUICK, path: "/safety-emergency-reports", icon: "AlertTriangle" },
    ],
  },
  {
    type: "section",
    label: "AI ASSISTANT",
    items: [
      { type: "link", label: "AI Settings", path: "/ai/settings", icon: "Zap" },
      { type: "link", label: "Conversations", path: "/ai/conversations", icon: "MessageSquare" },
      { type: "link", label: "AI Usage", path: "/ai/usage", icon: "Receipt" },
    ],
  },
  {
    type: "section",
    label: "REPORT MANAGEMENT",
    items: [
      { type: "link", label: "Transaction Report", path: "/transaction-report", icon: "FileText" },
      { type: "link", label: "Delivery SLA", path: "/reports/delivery-sla", icon: "Timer" },
      { type: "link", label: "Commission Report", path: "/reports/commission", icon: "Percent" },
      { type: "link", label: "Coin Liability", path: "/reports/coin-liability", icon: "Coins" },
      { type: "link", label: "Order Report", path: "/order-report/regular", icon: "FileText" },
      { type: "link", label: "Tax Report", path: "/tax-report", icon: "Receipt" },
      {
        type: "expandable",
        label: "Seller Report",
        icon: "FileText",
        subItems: [{ label: "Seller Report", path: "/seller-report" }],
      },
      {
        type: "expandable",
        label: "Customer Report",
        icon: "FileText",
        subItems: [{ label: "Feedback Experience", path: "/customer-report/feedback-experience" }],
      },
    ],
  },
  {
    type: "section",
    label: "TRANSACTION MANAGEMENT",
    items: [
      { type: "link", label: "Seller Withdraws", path: "/seller-withdraws", icon: "CreditCard" },
      { type: "link", label: "Payment Reconciliation", path: "/payments/reconciliation", icon: "Scale" },
    ],
  },
  {
    type: "section",
    label: "BANNER SETTINGS",
    items: [
      { type: "link", label: "Landing Page Management", path: "/hero-banner-management", icon: "Image" },
      // The Quick phone home's themes, featured cards and campaigns (QUICK_MOBILE_SPEC.md).
      { type: "link", label: "Quick Home Layout", path: "/quick-home-layout", icon: "LayoutGrid", panels: QUICK },
      { type: "link", label: "Promotional Banners", path: "/promotional-banner", icon: "Megaphone" },
// { type: "link", label: "General Banners", path: "/banners", icon: "Image" },
    ],
  },
  {
    type: "section",
    label: "SYSTEM SETTINGS",
    items: [
      { type: "link", label: "Broadcast Notification", path: "/broadcast-notification", icon: "Bell" },
      { type: "link", label: "Business Setup", path: "/business-setup", icon: "Settings" },
    ],
  },
  {
    type: "section",
    label: "SUPER POWERS",
    items: [
      { type: "link", label: "Feature Settings", path: "/feature-settings", icon: "Settings" },
      { type: "link", label: "Power Scanning", path: "/power-scanning", icon: "Zap" },
    ],
  },
  {
    type: "section",
    label: "ADMIN ACCESS",
    items: [
      { type: "link", label: "Sub Admin List", path: "/employees", icon: "UserCog" },
    ],
  },
  {
    type: "section",
    label: "PAGES & SOCIAL MEDIA",
    items: [
      { type: "link", label: "About Us", path: "/pages-social-media/about", icon: "Globe" },
      { type: "link", label: "Terms & Conditions", path: "/pages-social-media/terms", icon: "FileText" },
      { type: "link", label: "Privacy Policy", path: "/pages-social-media/privacy", icon: "Lock" },
      { type: "link", label: "Support", path: "/pages-social-media/support", icon: "Headset" },
      { type: "link", label: "Refund Policy", path: "/pages-social-media/refund", icon: "Receipt" },
      { type: "link", label: "Shipping Policy", path: "/pages-social-media/shipping", icon: "Truck" },
      { type: "link", label: "Cancellation Policy", path: "/pages-social-media/cancellation", icon: "X" },
    ],
  },
];

const isInPanel = (entry, panel, inherited = BOTH) => (entry.panels || inherited).includes(panel)

const withBase = (path, base) => (typeof path === "string" ? `${base}${path}` : path)

/** The sidebar for one panel, with every path made absolute under /admin/<panel>. */
export function getAdminSidebarMenu(panel = "quick") {
  const base = `/admin/${panel}`
  const mapItem = (item, inherited) => {
    if (!isInPanel(item, panel, inherited)) return null
    const panels = item.panels || inherited
    const next = { ...item, path: withBase(item.path, base) }
    if (Array.isArray(item.subItems)) {
      next.subItems = item.subItems
        .filter((sub) => isInPanel(sub, panel, panels))
        .map((sub) => ({ ...sub, path: withBase(sub.path, base) }))
      if (next.subItems.length === 0) return null
    }
    if (Array.isArray(item.items)) {
      next.items = item.items.map((child) => mapItem(child, panels)).filter(Boolean)
      if (next.items.length === 0) return null
    }
    return next
  }
  return adminSidebarMenuTemplate.map((entry) => mapItem(entry, BOTH)).filter(Boolean)
}

/** Every entry across both panels (for label lookups that must not depend on the panel). */
export const adminSidebarMenu = [...getAdminSidebarMenu("quick"), ...getAdminSidebarMenu("shop")]
