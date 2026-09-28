import { Suspense, lazy, useEffect, useState } from "react";
import { Routes, Route, Navigate, Outlet } from "@shop/router";
import { useAdminBase } from "./useAdminPanel";
import ProtectedRoute from "./ProtectedRoute";
import AdminLayout from "./AdminLayout";
import Loader from "@shop/components/Loader";
import { getCurrentUser } from "@shop/utils/auth";
import { canAccessFeatureSettings, canAccessSuperPowers } from "@shop/utils/adminPermissions";
import { adminAPI } from "@shop/api";

const AdminHome = lazy(() => import("@shop/pages/admin/AdminHome"));
const PointOfSale = lazy(() => import("@shop/pages/admin/PointOfSale"));
const AdminProfile = lazy(() => import("@shop/pages/admin/AdminProfile"));
const AdminSettings = lazy(() => import("@shop/pages/admin/AdminSettings"));
const ProductApproval = lazy(() => import("@shop/pages/admin/seller/ProductApproval"));
const OrdersPage = lazy(() => import("@shop/pages/admin/orders/OrdersPage"));
const UserCarts = lazy(() => import("@shop/pages/admin/orders/UserCarts"));
const OrderDetectDelivery = lazy(() => import("@shop/pages/admin/OrderDetectDelivery"));
const Category = lazy(() => import("@shop/pages/admin/categories/Category"));
const FeeSettings = lazy(() => import("@shop/pages/admin/fee-settings/FeeSettings"));
const ReferralSettings = lazy(() => import("@shop/pages/admin/referral-settings/ReferralSettings"));
// Seller Management
const ZoneSetup = lazy(() => import("@shop/pages/admin/seller/ZoneSetup"));
const AddZone = lazy(() => import("@shop/pages/admin/seller/AddZone"));
const ViewZone = lazy(() => import("@shop/pages/admin/seller/ViewZone"));
const AllZonesMap = lazy(() => import("@shop/pages/admin/seller/AllZonesMap"));
const DeliveryBoyViewMap = lazy(() => import("@shop/pages/admin/seller/DeliveryBoyViewMap"));
const SellersList = lazy(() => import("@shop/pages/admin/seller/SellersList"));
const AddSeller = lazy(() => import("@shop/pages/admin/seller/AddSeller"));
const JoiningRequest = lazy(() => import("@shop/pages/admin/seller/JoiningRequest"));
const UnregisteredSellers = lazy(() => import("@shop/pages/admin/seller/UnregisteredSellers"));
const SellerCommission = lazy(() => import("@shop/pages/admin/seller/SellerCommission"));
const SellerComplaints = lazy(() => import("@shop/pages/admin/seller/SellerComplaints"));
const SellerReviews = lazy(() => import("@shop/pages/admin/seller/SellerReviews"));
const SellersBulkImport = lazy(() => import("@shop/pages/admin/seller/SellersBulkImport"));
const SellersBulkExport = lazy(() => import("@shop/pages/admin/seller/SellersBulkExport"));
const SubscriptionSettings = lazy(() => import("@shop/pages/admin/seller/SubscriptionSettings"));
const SubscriptionHistory = lazy(() => import("@shop/pages/admin/seller/SubscriptionHistory"));
const SellerSettings = lazy(() => import("@shop/pages/admin/seller/SellerSettings"));
// Food Management
const ProductsList = lazy(() => import("@shop/pages/admin/products/ProductsList"));
// Promotions Management
const Coupons = lazy(() => import("@shop/pages/admin/Coupons"));
const Cashback = lazy(() => import("@shop/pages/admin/Cashback"));
const Banners = lazy(() => import("@shop/pages/admin/Banners"));
const PromotionalBanner = lazy(() => import("@shop/pages/admin/PromotionalBanner"));
const NewAdvertisement = lazy(() => import("@shop/pages/admin/advertisement/NewAdvertisement"));
const AdRequests = lazy(() => import("@shop/pages/admin/advertisement/AdRequests"));
const AdsList = lazy(() => import("@shop/pages/admin/advertisement/AdsList"));

// Help & Support
const ContactMessages = lazy(() => import("@shop/pages/admin/ContactMessages"));
const SafetyEmergencyReports = lazy(() => import("@shop/pages/admin/SafetyEmergencyReports"));
// Customer Management
const Customers = lazy(() => import("@shop/pages/admin/Customers"));
const SupportTickets = lazy(() => import("@shop/pages/admin/SupportTickets"));
const AddFund = lazy(() => import("@shop/pages/admin/wallet/AddFund"));
const Bonus = lazy(() => import("@shop/pages/admin/wallet/Bonus"));
const CoinsManagement = lazy(() => import("@shop/pages/admin/coins/CoinsManagement"));
const AttributesPage = lazy(() => import("@shop/pages/admin/attributes/AttributesPage"));
const ProductReviewModeration = lazy(() => import("@shop/pages/admin/products/ProductReviewModeration"));
const LowStock = lazy(() => import("@shop/pages/admin/products/LowStock"));
const FirstOrderClaims = lazy(() => import("@shop/pages/admin/campaigns/FirstOrderClaims"));
const PushCampaigns = lazy(() => import("@shop/pages/admin/campaigns/PushCampaigns"));
const AiSettings = lazy(() => import("@shop/pages/admin/ai/AiSettings"));
const AiConversations = lazy(() => import("@shop/pages/admin/ai/AiConversations"));
const AiUsage = lazy(() => import("@shop/pages/admin/ai/AiUsage"));
const NdrQueue = lazy(() => import("@shop/pages/admin/shipments/NdrQueue"));
const RtoQueue = lazy(() => import("@shop/pages/admin/shipments/RtoQueue"));
const CodRemittances = lazy(() => import("@shop/pages/admin/cod/CodRemittances"));
const CodRemittanceDetail = lazy(() => import("@shop/pages/admin/cod/CodRemittanceDetail"));
const Checkouts = lazy(() => import("@shop/pages/admin/checkouts/Checkouts"));
const CheckoutDetail = lazy(() => import("@shop/pages/admin/checkouts/CheckoutDetail"));
const Shipments = lazy(() => import("@shop/pages/admin/shipments/Shipments"));
const Returns = lazy(() => import("@shop/pages/admin/returns/Returns"));
const SpinCampaigns = lazy(() => import("@shop/pages/admin/spin/SpinCampaigns"));
const PaymentReconciliation = lazy(() => import("@shop/pages/admin/payments/PaymentReconciliation"));
const DeliverySlaReport = lazy(() => import("@shop/pages/admin/reports/DeliverySlaReport"));
const CommissionReport = lazy(() => import("@shop/pages/admin/reports/CommissionReport"));
const CoinLiabilityReport = lazy(() => import("@shop/pages/admin/reports/CoinLiabilityReport"));
const SubscribedMailList = lazy(() => import("@shop/pages/admin/SubscribedMailList"));
// Deliveryman Management
const DeliveryBoyCommission = lazy(() => import("@shop/pages/admin/DeliveryBoyCommission"));
const DeliveryCashLimit = lazy(() => import("@shop/pages/admin/DeliveryCashLimit"));
const CashLimitSettlement = lazy(() => import("@shop/pages/admin/CashLimitSettlement"));
const DeliveryWithdrawal = lazy(() => import("@shop/pages/admin/DeliveryWithdrawal"));
const DeliveryBoyWallet = lazy(() => import("@shop/pages/admin/DeliveryBoyWallet"));
const DeliveryEmergencyHelp = lazy(() => import("@shop/pages/admin/DeliveryEmergencyHelp"));
const DeliverySupportTickets = lazy(() => import("@shop/pages/admin/DeliverySupportTickets"));
const OrderReassignmentRequests = lazy(() => import("@shop/pages/admin/OrderReassignmentRequests"));
const JoinRequest = lazy(() => import("@shop/pages/admin/delivery-partners/JoinRequest"));
const AddDeliveryman = lazy(() => import("@shop/pages/admin/delivery-partners/AddDeliveryman"));
const DeliverymanList = lazy(() => import("@shop/pages/admin/delivery-partners/DeliverymanList"));
const DeliveryLiveTracking = lazy(() => import("@shop/pages/admin/delivery-partners/DeliveryLiveTracking"));
const DeliverymanReviews = lazy(() => import("@shop/pages/admin/delivery-partners/DeliverymanReviews"));
const DeliverymanBonus = lazy(() => import("@shop/pages/admin/delivery-partners/DeliverymanBonus"));
const EarningAddon = lazy(() => import("@shop/pages/admin/delivery-partners/EarningAddon"));
const EarningAddonHistory = lazy(() => import("@shop/pages/admin/delivery-partners/EarningAddonHistory"));
const DeliveryEarnings = lazy(() => import("@shop/pages/admin/delivery-partners/DeliveryEarnings"));
// Disbursement Management
// Report Management
const TransactionReport = lazy(() => import("@shop/pages/admin/reports/TransactionReport"));
const DisbursementReportSellers = lazy(() => import("@shop/pages/admin/reports/DisbursementReportSellers"));
const DisbursementReportDeliverymen = lazy(() => import("@shop/pages/admin/reports/DisbursementReportDeliverymen"));
const RegularOrderReport = lazy(() => import("@shop/pages/admin/reports/RegularOrderReport"));
const SellerReport = lazy(() => import("@shop/pages/admin/reports/SellerReport"));
const FeedbackExperienceReport = lazy(() => import("@shop/pages/admin/reports/FeedbackExperienceReport"));
const TaxReport = lazy(() => import("@shop/pages/admin/reports/TaxReport"));
// Transaction Management
const SellerWithdraws = lazy(() => import("@shop/pages/admin/transactions/SellerWithdraws"));
// Employee Management
const EmployeeRole = lazy(() => import("@shop/pages/admin/employees/EmployeeRole"));
const EmployeeList = lazy(() => import("@shop/pages/admin/employees/EmployeeList"));
// Business Settings
const BusinessSetup = lazy(() => import("@shop/pages/admin/settings/BusinessSetup"));
const FeatureSettings = lazy(() => import("@shop/pages/admin/settings/FeatureSettings"));
const PowerScanning = lazy(() => import("@shop/pages/admin/settings/PowerScanning"));
const EmailTemplate = lazy(() => import("@shop/pages/admin/settings/EmailTemplate"));
const ThemeSettings = lazy(() => import("@shop/pages/admin/settings/ThemeSettings"));
const Gallery = lazy(() => import("@shop/pages/admin/settings/Gallery"));
const LoginSetup = lazy(() => import("@shop/pages/admin/settings/LoginSetup"));
const TermsAndCondition = lazy(() => import("@shop/pages/admin/settings/TermsAndCondition"));
const PrivacyPolicy = lazy(() => import("@shop/pages/admin/settings/PrivacyPolicy"));
const AboutUs = lazy(() => import("@shop/pages/admin/settings/AboutUs"));
const RefundPolicy = lazy(() => import("@shop/pages/admin/settings/RefundPolicy"));
const ShippingPolicy = lazy(() => import("@shop/pages/admin/settings/ShippingPolicy"));
const CancellationPolicy = lazy(() => import("@shop/pages/admin/settings/CancellationPolicy"));
const ReactRegistration = lazy(() => import("@shop/pages/admin/settings/ReactRegistration"));
const SupportCMS = lazy(() => import("@shop/pages/admin/settings/SupportCMS"));

// System Settings
const ThirdParty = lazy(() => import("@shop/pages/admin/system/ThirdParty"));
const FirebaseNotification = lazy(() => import("@shop/pages/admin/system/FirebaseNotification"));
const OfflinePaymentSetup = lazy(() => import("@shop/pages/admin/system/OfflinePaymentSetup"));
const JoinUsPageSetup = lazy(() => import("@shop/pages/admin/system/JoinUsPageSetup"));
const AnalyticsScript = lazy(() => import("@shop/pages/admin/system/AnalyticsScript"));
const AISetup = lazy(() => import("@shop/pages/admin/system/AISetup"));
const AppWebSettings = lazy(() => import("@shop/pages/admin/system/AppWebSettings"));
const NotificationChannels = lazy(() => import("@shop/pages/admin/system/NotificationChannels"));
const NotificationBroadcast = lazy(() => import("@shop/pages/admin/system/NotificationBroadcast"));
const AdminNotifications = lazy(() => import("@shop/pages/admin/system/AdminNotifications"));
const LandingPageSettings = lazy(() => import("@shop/pages/admin/system/LandingPageSettings"));
const PageMetaData = lazy(() => import("@shop/pages/admin/system/PageMetaData"));
const ReactSite = lazy(() => import("@shop/pages/admin/system/ReactSite"));
const CleanDatabase = lazy(() => import("@shop/pages/admin/system/CleanDatabase"));
const AddonActivation = lazy(() => import("@shop/pages/admin/system/AddonActivation"));
const LandingPageManagement = lazy(() => import("@shop/pages/admin/system/LandingPageManagement"));
const QuickHomeLayout = lazy(() => import("@shop/pages/admin/system/QuickHomeLayout"));
const EditSeller = lazy(() => import("@shop/pages/admin/seller/EditSeller"));

/** Redirect to a path inside the current panel ("" is the panel dashboard). */
function PanelRedirect({ to = "" }) {
  const base = useAdminBase();
  return <Navigate to={`${base}${to}`} replace />;
}

function FeatureSettingsRouteGuard() {
  const adminUser = getCurrentUser("admin");
  if (!canAccessFeatureSettings(adminUser)) {
    return <PanelRedirect />;
  }
  return <FeatureSettings />;
}

function SuperPowersRouteGuard({ children }) {
  const adminUser = getCurrentUser("admin");
  if (!canAccessSuperPowers(adminUser)) {
    return <PanelRedirect />;
  }
  return children;
}

function UnregisteredSellersRouteGuard() {
  const [loading, setLoading] = useState(true);
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    const parseEnabled = (value, fallback = true) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
      }
      if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
      }
      return fallback;
    };

    const load = async () => {
      try {
        const res = await adminAPI.getPublicFeatureSettings();
        const rows = Array.isArray(res?.data?.data) ? res.data.data : [];
        const feature = rows.find((row) => row.key === "root_landing_and_unregistered_control");
        if (feature) {
          setIsEnabled(parseEnabled(feature.isEnabled, true));
        }
      } catch (_error) {
        // keep safe default (enabled) on API failure
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <Loader />;
  if (!isEnabled) return <PanelRedirect to="/sellers" />;
  return <UnregisteredSellers />;
}

export default function AdminRouter() {
  // Safely enforce light mode for the Admin app to prevent User dark mode bleeding
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    return () => {
      const savedTheme = localStorage.getItem("appTheme") || "light";
      if (savedTheme === "dark") {
        document.documentElement.classList.add("dark");
      }
    };
  }, []);

  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        {/* Mounted by the platform at /admin/shop/*, so every path below is
            relative to that. Sign-in is the platform's /admin/login; the
            standalone app's own login, forgot-password and its second panel
            (/admin/quick) do not exist here. */}
        <Route
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route element={<Outlet />}>
            <Route index element={<AdminHome />} />
            <Route path="point-of-sale" element={<PointOfSale />} />
            <Route path="profile" element={<AdminProfile />} />
            <Route path="settings" element={<AdminSettings />} />
            
            {/* ORDER MANAGEMENT */}
            <Route path="orders/all" element={<OrdersPage statusKey="all" />} />
            <Route path="orders/scheduled" element={<PanelRedirect to="/orders/pending" />} />
            <Route path="orders/pending" element={<OrdersPage statusKey="pending" />} />
            <Route path="orders/accepted" element={<PanelRedirect to="/orders/processing" />} />
            <Route path="orders/processing" element={<OrdersPage statusKey="processing" />} />
            <Route path="orders/out-for-delivery" element={<OrdersPage statusKey="out-for-delivery" />} />
            <Route path="orders/delivered" element={<OrdersPage statusKey="delivered" />} />
            <Route path="orders/canceled" element={<OrdersPage statusKey="canceled" />} />
            <Route path="orders/seller-cancelled" element={<OrdersPage statusKey="seller-cancelled" />} />
            <Route path="orders/payment-failed" element={<OrdersPage statusKey="payment-failed" />} />
            <Route path="orders/refunded" element={<OrdersPage statusKey="refunded" />} />
            <Route path="orders/offline-payments" element={<OrdersPage statusKey="offline-payments" />} />
            <Route path="orders/user-carts" element={<UserCarts />} />
            <Route path="order-detect-delivery" element={<OrderDetectDelivery />} />

            {/* SELLER MANAGEMENT */}
            <Route path="zone-setup" element={<ZoneSetup />} />
            <Route path="zone-setup/map" element={<AllZonesMap />} />
            <Route path="zone-setup/delivery-boy-view" element={<DeliveryBoyViewMap />} />
            <Route path="zone-setup/add" element={<AddZone />} />
            <Route path="zone-setup/edit/:id" element={<AddZone />} />
            <Route path="zone-setup/view/:id" element={<ViewZone />} />
            <Route path="product-approval" element={<ProductApproval />} />
            {/* Canonical paths are products/ and sellers/. The products/ and
                sellers/ twins below them are kept so existing bookmarks and
                links in already-sent email keep resolving. */}
            {/* products/ and sellers/ are the canonical paths. The products/ and
                sellers/ twins beside them render the same screens and are kept
                so existing bookmarks and already-sent links keep resolving. */}
            <Route path="sellers" element={<SellersList />} />
            <Route path="sellers" element={<SellersList />} />
            <Route path="sellers/add" element={<AddSeller />} />
            <Route path="sellers/add" element={<AddSeller />} />
            <Route path="sellers/edit/:id" element={<EditSeller />} />
            <Route path="sellers/edit/:id" element={<EditSeller />} />
            <Route path="sellers/joining-request" element={<JoiningRequest />} />
            <Route path="sellers/joining-request" element={<JoiningRequest />} />
            <Route path="sellers/unregistered" element={<UnregisteredSellersRouteGuard />} />
            <Route path="sellers/unregistered" element={<UnregisteredSellersRouteGuard />} />
            <Route path="sellers/commission" element={<SellerCommission />} />
            <Route path="sellers/commission" element={<SellerCommission />} />
            <Route path="sellers/complaints" element={<SellerComplaints />} />
            <Route path="sellers/complaints" element={<SellerComplaints />} />
            <Route path="sellers/reviews" element={<SellerReviews />} />
            <Route path="sellers/reviews" element={<SellerReviews />} />
            <Route path="sellers/bulk-import" element={<SellersBulkImport />} />
            <Route path="sellers/bulk-import" element={<SellersBulkImport />} />
            <Route path="sellers/bulk-export" element={<SellersBulkExport />} />
            <Route path="sellers/bulk-export" element={<SellersBulkExport />} />
            <Route path="sellers/settings" element={<SellerSettings />} />
            <Route path="sellers/settings" element={<SellerSettings />} />
            <Route path="sellers/subscription-settings" element={<SubscriptionSettings />} />
            <Route path="sellers/subscription-settings" element={<SubscriptionSettings />} />
            <Route path="sellers/subscription-history" element={<SubscriptionHistory />} />
            <Route path="sellers/subscription-history" element={<SubscriptionHistory />} />

            {/* FOOD & CATEGORY MANAGEMENT */}
            <Route path="categories" element={<Category />} />
            <Route path="attributes" element={<AttributesPage />} />
            <Route path="coins" element={<CoinsManagement />} />
            <Route path="spin-campaigns" element={<SpinCampaigns />} />
            <Route path="product-reviews" element={<ProductReviewModeration />} />
            <Route path="low-stock" element={<LowStock />} />
            <Route path="first-order-claims" element={<FirstOrderClaims />} />
            <Route path="push-campaigns" element={<PushCampaigns />} />
            <Route path="shipments" element={<Shipments />} />
            <Route path="shipments/ndr" element={<NdrQueue />} />
            <Route path="shipments/rto" element={<RtoQueue />} />
            <Route path="cod-remittances" element={<CodRemittances />} />
            <Route path="cod-remittances/:id" element={<CodRemittanceDetail />} />
            <Route path="checkouts" element={<Checkouts />} />
            <Route path="ai/settings" element={<AiSettings />} />
            <Route path="ai/conversations" element={<AiConversations />} />
            <Route path="ai/usage" element={<AiUsage />} />
            <Route path="checkouts/:checkoutId" element={<CheckoutDetail />} />
            <Route path="returns" element={<Returns />} />
            <Route path="payments/reconciliation" element={<PaymentReconciliation />} />
            <Route path="reports/delivery-sla" element={<DeliverySlaReport />} />
            <Route path="reports/commission" element={<CommissionReport />} />
            <Route path="reports/coin-liability" element={<CoinLiabilityReport />} />
            <Route path="fee-settings" element={<FeeSettings />} />
            <Route path="referral-settings" element={<ReferralSettings />} />
            <Route path="products" element={<ProductsList />} />
            <Route path="products" element={<ProductsList />} />
            <Route path="food/list" element={<ProductsList />} />

            {/* PROMOTIONS, CUSTOMERS, DELIVERYMEN, etc. */}
            {/* Retired placeholder pages (sample tables, no data behind them): each old
                address goes to the real screen -- GST is the tax report, platform costs are
                in the transaction report, payout methods live on each partner. */}
            <Route path="campaigns/basic" element={<Navigate to="/coupons" replace />} />
            <Route path="campaigns/food" element={<Navigate to="/coupons" replace />} />
            <Route path="coupons" element={<Coupons />} />
            <Route path="cashback" element={<Cashback />} />
            <Route path="banners" element={<Banners />} />
            <Route path="promotional-banner" element={<PromotionalBanner />} />
            <Route path="advertisement" element={<AdsList />} />
            <Route path="advertisement/new" element={<NewAdvertisement />} />
            <Route path="advertisement/requests" element={<AdRequests />} />
            
            <Route path="contact-messages" element={<ContactMessages />} />
            <Route path="safety-emergency-reports" element={<SafetyEmergencyReports />} />
            
            <Route path="customers" element={<Customers />} />
            <Route path="support-tickets" element={<SupportTickets />} />
            <Route path="wallet/add-fund" element={<AddFund />} />
            <Route path="wallet/bonus" element={<Bonus />} />
            <Route path="subscribed-mail-list" element={<SubscribedMailList />} />

            <Route path="delivery-boy-commission" element={<DeliveryBoyCommission />} />
            <Route path="delivery-cash-limit" element={<DeliveryCashLimit />} />
            <Route path="cash-limit-settlement" element={<CashLimitSettlement />} />
            <Route path="delivery-withdrawal" element={<DeliveryWithdrawal />} />
            <Route path="delivery-boy-wallet" element={<DeliveryBoyWallet />} />
            <Route path="delivery-emergency-help" element={<DeliveryEmergencyHelp />} />
            <Route path="delivery-support-tickets" element={<DeliverySupportTickets />} />
            <Route path="delivery-order-reassignment-requests" element={<OrderReassignmentRequests />} />
            <Route path="delivery-partners" element={<DeliverymanList />} />
            <Route path="delivery-partners/add" element={<AddDeliveryman />} />
            <Route path="delivery-partners/live-tracking" element={<DeliveryLiveTracking />} />
            <Route path="delivery-partners/join-request" element={<JoinRequest />} />
            <Route path="delivery-partners/reviews" element={<DeliverymanReviews />} />
            <Route path="delivery-partners/bonus" element={<DeliverymanBonus />} />
            <Route path="delivery-partners/earning-addon" element={<EarningAddon />} />
            <Route path="delivery-partners/earning-addon-history" element={<EarningAddonHistory />} />
            <Route path="delivery-partners/earnings" element={<DeliveryEarnings />} />

            {/* REPORTS & SETTINGS */}
            <Route path="transaction-report" element={<TransactionReport />} />
            <Route path="expense-report" element={<Navigate to="/transaction-report" replace />} />
            <Route path="disbursement-report/sellers" element={<DisbursementReportSellers />} />
            <Route path="disbursement-report/deliverymen" element={<DisbursementReportDeliverymen />} />
            <Route path="order-report/regular" element={<RegularOrderReport />} />
            <Route path="order-report/campaign" element={<Navigate to="/order-report/regular" replace />} />
            <Route path="seller-report" element={<SellerReport />} />
            <Route path="customer-report/feedback-experience" element={<FeedbackExperienceReport />} />
            <Route path="tax-report" element={<TaxReport />} />
            <Route path="seller-vat-report" element={<Navigate to="/tax-report" replace />} />
            
            <Route path="seller-withdraws" element={<SellerWithdraws />} />
            <Route path="withdraw-method" element={<Navigate to="/seller-withdraws" replace />} />
            
            <Route path="employee-role" element={<EmployeeRole />} />
            <Route path="employees" element={<EmployeeList />} />

            {/* SYSTEM & BUSINESS SETTINGS */}
            <Route path="business-setup" element={<BusinessSetup />} />
            <Route path="feature-settings" element={<FeatureSettingsRouteGuard />} />
            <Route path="power-scanning" element={<SuperPowersRouteGuard><PowerScanning /></SuperPowersRouteGuard>} />
            <Route path="email-template" element={<EmailTemplate />} />
            <Route path="theme-settings" element={<ThemeSettings />} />
            <Route path="gallery" element={<Gallery />} />
            <Route path="login-setup" element={<LoginSetup />} />
            
            {/* PAGES & SOCIAL MEDIA */}
            <Route path="pages-social-media/terms" element={<TermsAndCondition />} />
            <Route path="pages-social-media/privacy" element={<PrivacyPolicy />} />
            <Route path="pages-social-media/support" element={<SupportCMS />} />
            <Route path="pages-social-media/about" element={<AboutUs />} />
            <Route path="pages-social-media/refund" element={<RefundPolicy />} />
            <Route path="pages-social-media/shipping" element={<ShippingPolicy />} />
            <Route path="pages-social-media/cancellation" element={<CancellationPolicy />} />
            <Route path="pages-social-media/react-registration" element={<ReactRegistration />} />

            <Route path="3rd-party-configurations/firebase" element={<FirebaseNotification />} />
            <Route path="3rd-party-configurations/offline-payment" element={<OfflinePaymentSetup />} />
            <Route path="3rd-party-configurations/join-us" element={<JoinUsPageSetup />} />
            <Route path="3rd-party-configurations/analytics" element={<AnalyticsScript />} />
            <Route path="3rd-party-configurations/ai" element={<AISetup />} />
            <Route path="app-web-settings" element={<AppWebSettings />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="broadcast-notification" element={<NotificationBroadcast />} />
            <Route path="notification-channels" element={<NotificationChannels />} />
            <Route path="landing-page-settings/admin" element={<LandingPageSettings type="admin" />} />
            <Route path="landing-page-settings/react" element={<LandingPageSettings type="react" />} />
            <Route path="page-meta-data" element={<PageMetaData />} />
            <Route path="react-site" element={<ReactSite />} />
            <Route path="clean-database" element={<CleanDatabase />} />
            <Route path="addon-activation" element={<AddonActivation />} />
            <Route path="hero-banner-management" element={<LandingPageManagement />} />
            <Route path="quick-home-layout" element={<QuickHomeLayout />} />
          </Route>
        </Route>

        {/* Unknown Shop admin routes go to the Shop dashboard */}
        <Route path="*" element={<Navigate to="/admin/shop" replace />} />
      </Routes>
    </Suspense>
  );
}
