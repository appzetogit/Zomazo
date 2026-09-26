import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ChevronRight,
  Wallet,
  Tag,
  User,
  Package,
  Heart,
  Home,
  CreditCard,
  Star,
  RefreshCw,
  Bell,
  HelpCircle,
  Settings as SettingsIcon,
  LogOut,
  Moon,
  Sun,
  Check,
  MapPin,
  Share2,
  Coins,
} from "lucide-react";

import AnimatedPage from "@store/components/user/AnimatedPage";
import { resolveMediaUrl } from "@store/utils/common";
import { Card, CardContent } from "@store/components/ui/card";
import { Button } from "@store/components/ui/button";
import { useProfile } from "@store/context/ProfileContext";
import { useLocationSelector } from "@store/components/user/UserLayout";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@store/components/ui/avatar";
import { useCompanyName } from "@store/hooks/useCompanyName";
import OptimizedImage from "@store/components/OptimizedImage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@store/components/ui/dialog";
import { userAPI } from "@store/api";
import { clearModuleAuth } from "@store/utils/auth";
import { logoutUserSession } from "@store/utils/moduleLogout";
import { toast } from "sonner";
const debugLog = (...args) => { };
const debugError = (...args) => { };
const USER_SESSION_PREFERENCE_KEYS = ["userVegMode"];

import { registerWebPushForCurrentModule } from "@store/utils/firebaseMessaging";
import DeleteAccountModal from "@store/components/DeleteAccountModal";
import MarketingPushToggle from "@store/components/user/MarketingPushToggle";

export default function Profile() {
  const { userProfile, vegMode, setVegMode, getDefaultAddress, addresses } =
    useProfile();
  const { openLocationSelector } = useLocationSelector();
  const navigate = useNavigate();
  const companyName = useCompanyName();
  const defaultAddress = getDefaultAddress?.();
  const savedAddressSummary = defaultAddress
    ? [
      defaultAddress.street,
      defaultAddress.additionalDetails,
      defaultAddress.city,
      defaultAddress.state,
      defaultAddress.zipCode,
    ]
      .filter(Boolean)
      .join(", ")
    : "No address saved. Tap to save Home, Work, or Other.";

  // Popup states
  const [vegModeOpen, setVegModeOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [referralReward, setReferralReward] = useState(0);
  const [walletBalance, setWalletBalance] = useState(0);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Trigger web push registration when profile mounts to ensure FCM token is saved
  useEffect(() => {
    registerWebPushForCurrentModule().catch(console.error);
  }, []);

  const handleVegModeUpdate = (nextValue) => {
    setVegMode(nextValue);
    localStorage.setItem("userVegMode", String(nextValue));
  };

  // Settings states
  const [appearance, setAppearance] = useState(() => {
    // Load theme from localStorage or default to 'light'
    return localStorage.getItem("appTheme") || "light";
  });

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    if (appearance === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    // Save to localStorage
    localStorage.setItem("appTheme", appearance);
  }, [appearance]);

  // Get first letter of name for avatar
  const avatarInitial =
    userProfile?.name?.charAt(0)?.toUpperCase() ||
    userProfile?.phone?.charAt(1)?.toUpperCase() ||
    "U";
  const displayName = userProfile?.name || userProfile?.phone || "User";
  // Only show email if it exists and is valid, otherwise show phone or "Not available"
  const hasValidEmail =
    userProfile?.email &&
    userProfile.email.trim() !== "" &&
    userProfile.email.includes("@");
  const displayEmail = hasValidEmail
    ? userProfile.email
    : userProfile?.phone || "Not available";

  // Calculate profile completion percentage
  const calculateProfileCompletion = () => {
    if (!userProfile) return 0;

    // Helper function to check if date field is filled (handles Date objects, date strings, ISO strings)
    const isDateFilled = (dateField) => {
      if (!dateField) return false;

      // Check if it's a Date object
      if (dateField instanceof Date) {
        return !isNaN(dateField.getTime());
      }

      // Check if it's a string
      if (typeof dateField === "string") {
        const trimmed = dateField.trim();
        if (trimmed === "" || trimmed === "null" || trimmed === "undefined")
          return false;

        // Try to parse as date (handles various formats: YYYY-MM-DD, ISO strings, etc.)
        const date = new Date(trimmed);
        if (!isNaN(date.getTime())) {
          // Valid date
          return true;
        }
      }

      return false;
    };

    // Check name - must have value
    const hasName = !!(
      userProfile.name &&
      typeof userProfile.name === "string" &&
      userProfile.name.trim() !== ""
    );

    // Check contact - phone OR email (at least one)
    const hasPhone = !!(
      userProfile.phone &&
      typeof userProfile.phone === "string" &&
      userProfile.phone.trim() !== ""
    );
    const hasContact = hasPhone || hasValidEmail;

    // Check profile image - must have URL string
    const hasImage = !!(
      userProfile.profileImage &&
      typeof userProfile.profileImage === "string" &&
      userProfile.profileImage.trim() !== "" &&
      userProfile.profileImage !== "null" &&
      userProfile.profileImage !== "undefined"
    );

    // Check date of birth
    const hasDateOfBirth = isDateFilled(userProfile.dateOfBirth);

    // Check gender - must be valid value
    const validGenders = ["male", "female", "other", "prefer-not-to-say"];
    const hasGender = !!(
      userProfile.gender &&
      typeof userProfile.gender === "string" &&
      userProfile.gender.trim() !== "" &&
      validGenders.includes(userProfile.gender.trim().toLowerCase())
    );

    // Required fields only (anniversary is NOT counted - it's optional)
    // Only these 5 fields count towards 100%
    const requiredFields = {
      name: hasName,
      contact: hasContact,
      profileImage: hasImage,
      dateOfBirth: hasDateOfBirth,
      gender: hasGender,
    };

    const totalRequiredFields = 5; // Fixed: name, contact, profileImage, dateOfBirth, gender
    const completedRequiredFields =
      Object.values(requiredFields).filter(Boolean).length;

    // Calculate percentage based ONLY on required fields (anniversary NOT included)
    const percentage = Math.round(
      (completedRequiredFields / totalRequiredFields) * 100,
    );

    // Always log for debugging (remove in production if needed)
    debugLog("?? Profile completion check:", {
      requiredFields,
      completedRequiredFields,
      totalRequiredFields,
      percentage,
      fieldStatus: {
        name: hasName ? "?" : "?",
        contact: hasContact ? "?" : "?",
        profileImage: hasImage ? "?" : "?",
        dateOfBirth: hasDateOfBirth ? "?" : "?",
        gender: hasGender ? "?" : "?",
      },
      rawData: {
        name: userProfile.name || "missing",
        phone: userProfile.phone || "missing",
        email: userProfile.email || "missing",
        profileImage: userProfile.profileImage ? "exists" : "missing",
        dateOfBirth: userProfile.dateOfBirth
          ? String(userProfile.dateOfBirth)
          : "missing",
        gender: userProfile.gender || "missing",
      },
    });

    return percentage;
  };

  const profileCompletion = calculateProfileCompletion();
  const isComplete = profileCompletion === 100;
  useEffect(() => {
    let mounted = true;
    userAPI
      .getReferralStats()
      .then((res) => {
        const reward = res?.data?.data?.stats?.rewardAmount;
        if (mounted) setReferralReward(Number(reward) || 0);
      })
      .catch(() => { });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    userAPI
      .getWallet()
      .then((res) => {
        const w = res?.data?.data?.wallet || res?.data?.wallet;
        const bal = Number(w?.balance);
        if (mounted) setWalletBalance(Number.isFinite(bal) ? bal : 0);
      })
      .catch(() => { });
    return () => {
      mounted = false;
    };
  }, []);

  const refId =
    userProfile?._id || userProfile?.id || userProfile?.referralCode || "";
  const referralLink = refId
    ? `${window.location.origin}/auth/login?ref=${encodeURIComponent(String(refId))}`
    : "";

  const handleShareReferral = async () => {
    if (!referralLink) return;
    const rewardText = referralReward > 0 ? `\u20B9${referralReward}` : "rewards";
    const shareText = `Join ${companyName} and earn ${rewardText}.`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${companyName} referral`,
          text: shareText,
          url: referralLink,
        });
      } else {
        const fallbackUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralLink}`)}`;
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      debugError("Failed to share referral:", error);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    if (isLoggingOut) return; // Prevent multiple clicks

    setIsLoggingOut(true);

    try {
      await logoutUserSession({ navigate });
    } catch (err) {
      debugError("Error during logout:", err);
      clearModuleAuth("user");
      localStorage.removeItem("accessToken");
      localStorage.removeItem("user_authenticated");
      localStorage.removeItem("user_user");
      localStorage.removeItem("user");
      localStorage.removeItem("cart");
      localStorage.removeItem("cart_quick");
      USER_SESSION_PREFERENCE_KEYS.forEach((key) => localStorage.removeItem(key));
      window.dispatchEvent(new Event("userAuthChanged"));
      navigate("/auth/login", { replace: true });
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleConfirmDelete = async () => {
    try {
      await userAPI.deleteCurrentUserAccount();
      toast.success("Account deleted successfully");
      
      clearModuleAuth("user");
      localStorage.removeItem("accessToken");
      localStorage.removeItem("user_authenticated");
      localStorage.removeItem("user_user");
      localStorage.removeItem("user");
      localStorage.removeItem("cart");
      localStorage.removeItem("cart_quick");
      USER_SESSION_PREFERENCE_KEYS.forEach((key) => localStorage.removeItem(key));
      
      window.dispatchEvent(new Event("userAuthChanged"));
      navigate("/auth/login", { replace: true });
    } catch (error) {
      console.error("Failed to delete account:", error);
      toast.error(error?.response?.data?.message || "Failed to delete account. Please try again.");
    }
  };

  const handleLogoutClick = () => {
    if (isLoggingOut) return;
    setLogoutConfirmOpen(true);
  };

  return (
    <AnimatedPage className="min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a]">
      <div className="max-w-xl mx-auto px-4 py-4 pb-24">
        {/* Header Bar */}
        <div className="flex items-center justify-between mb-4">
          <Link to="/" className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Account</h1>
          <div className="w-8" />
        </div>

        {/* Profile Card (Matching Screen 7) */}
        <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100 dark:border-gray-800 flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <Avatar className="h-14 w-14 rounded-full border-2 border-orange-100 dark:border-orange-950/40 shrink-0">
              {userProfile?.profileImage && (
                <AvatarImage
                  src={resolveMediaUrl(userProfile.profileImage) || undefined}
                  alt={displayName}
                />
              )}
              <AvatarFallback className="bg-gradient-to-br from-orange-400 to-orange-600 text-white text-xl font-bold">
                {avatarInitial}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">
                {displayName}
              </h2>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
                {userProfile?.phone || displayEmail}
              </p>
            </div>
          </div>

          <Link
            to="/profile/edit"
            className="shrink-0 text-xs sm:text-sm font-semibold text-orange-500 hover:text-orange-600 dark:text-orange-400 px-3 py-1.5 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors"
          >
            Edit Profile
          </Link>
        </div>

        {/* 4 Quick-Action Cards (Matching Screen 7) */}
        <div className="grid grid-cols-4 gap-2.5 sm:gap-3.5 mb-5">
          <Link
            to="/orders"
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white dark:bg-[#1a1a1a] border border-gray-100 dark:border-gray-800 shadow-sm hover:border-orange-300 dark:hover:border-orange-700 hover:shadow-md transition-all text-center group"
          >
            <div className="h-11 w-11 rounded-xl bg-orange-50 dark:bg-orange-950/40 flex items-center justify-center mb-1.5 text-orange-500 group-hover:scale-110 transition-transform">
              <Package className="h-5 w-5" />
            </div>
            <span className="text-[11px] sm:text-xs font-semibold text-gray-800 dark:text-gray-200">
              My Orders
            </span>
          </Link>

          <Link
            to="/profile/favorites"
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white dark:bg-[#1a1a1a] border border-gray-100 dark:border-gray-800 shadow-sm hover:border-orange-300 dark:hover:border-orange-700 hover:shadow-md transition-all text-center group"
          >
            <div className="h-11 w-11 rounded-xl bg-orange-50 dark:bg-orange-950/40 flex items-center justify-center mb-1.5 text-orange-500 group-hover:scale-110 transition-transform">
              <Heart className="h-5 w-5" />
            </div>
            <span className="text-[11px] sm:text-xs font-semibold text-gray-800 dark:text-gray-200">
              Wishlist
            </span>
          </Link>

          <button
            type="button"
            onClick={openLocationSelector}
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white dark:bg-[#1a1a1a] border border-gray-100 dark:border-gray-800 shadow-sm hover:border-orange-300 dark:hover:border-orange-700 hover:shadow-md transition-all text-center group"
          >
            <div className="h-11 w-11 rounded-xl bg-orange-50 dark:bg-orange-950/40 flex items-center justify-center mb-1.5 text-orange-500 group-hover:scale-110 transition-transform">
              <MapPin className="h-5 w-5" />
            </div>
            <span className="text-[11px] sm:text-xs font-semibold text-gray-800 dark:text-gray-200">
              Addresses
            </span>
          </button>

          <Link
            to="/user/wallet"
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white dark:bg-[#1a1a1a] border border-gray-100 dark:border-gray-800 shadow-sm hover:border-orange-300 dark:hover:border-orange-700 hover:shadow-md transition-all text-center group"
          >
            <div className="h-11 w-11 rounded-xl bg-orange-50 dark:bg-orange-950/40 flex items-center justify-center mb-1.5 text-orange-500 group-hover:scale-110 transition-transform">
              <Wallet className="h-5 w-5" />
            </div>
            <span className="text-[11px] sm:text-xs font-semibold text-gray-800 dark:text-gray-200">
              Wallet
            </span>
          </Link>
        </div>

        {/* Menu List (Matching Screen 7) */}
        <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800/80 overflow-hidden mb-4">
          <button
            type="button"
            onClick={openLocationSelector}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-[#202020] transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <Home className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              <div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  My Addresses
                </span>
                {addresses?.length > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {addresses.length} saved address{addresses.length > 1 ? "es" : ""}
                  </p>
                )}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </button>

          <Link
            to="/profile/payments"
            className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-[#202020] transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <CreditCard className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                Payment Methods
              </span>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </Link>

          <Link
            to="/coins"
            className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-[#202020] transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <Coins className="h-5 w-5 text-amber-500" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                Coins &amp; Rewards
              </span>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </Link>

          <Link
            to="/user/profile/activity"
            className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-[#202020] transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <Star className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                My Reviews
              </span>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </Link>

          <Link
            to="/orders"
            className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-[#202020] transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <RefreshCw className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                Returns &amp; Exchanges
              </span>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </Link>

          <Link
            to="/notifications"
            className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-[#202020] transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <Bell className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                Notifications
              </span>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </Link>

          <Link
            to="/profile/support"
            className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-[#202020] transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <HelpCircle className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                Help &amp; Support
              </span>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </Link>

          <button
            type="button"
            onClick={() => setAppearanceOpen(true)}
            className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-[#202020] transition-colors text-left"
          >
            <div className="flex items-center gap-3.5">
              <SettingsIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              <div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  Settings
                </span>
                <p className="text-xs text-gray-400 capitalize">
                  Appearance: {appearance}
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </button>

          <button
            type="button"
            onClick={handleLogoutClick}
            className="w-full flex items-center justify-between p-4 hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-colors text-left group"
          >
            <div className="flex items-center gap-3.5 text-red-500 group-hover:text-red-600">
              <LogOut className="h-5 w-5" />
              <span className="text-sm font-bold">
                Log Out
              </span>
            </div>
            <ChevronRight className="h-4 w-4 text-red-400" />
          </button>
        </div>

        {/* Marketing toggle & extra settings */}
        <div className="space-y-3">
          <MarketingPushToggle />
          <button
            type="button"
            onClick={() => setDeleteModalOpen(true)}
            className="w-full text-center text-xs text-gray-400 hover:text-red-500 py-2 transition-colors"
          >
            Delete Account
          </button>
        </div>
      </div>


{/* Logout Confirmation Popup */}
      {logoutConfirmOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1a1a1a] p-5 shadow-2xl border border-gray-200 dark:border-gray-800">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Log out?
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Are you sure you want to log out?
            </p>
            <div className="mt-5 flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1 rounded-xl"
                onClick={() => setLogoutConfirmOpen(false)}
                disabled={isLoggingOut}
              >
                No
              </Button>
              <Button
                type="button"
                className="flex-1 rounded-xl bg-wh-brand hover:bg-[#D6005E] text-wh-text"
                onClick={() => {
                  setLogoutConfirmOpen(false);
                  handleLogout();
                }}
                disabled={isLoggingOut}
              >
                Yes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Appearance Popup */}
      <Dialog open={appearanceOpen} onOpenChange={setAppearanceOpen}>
        <DialogContent className="max-w-sm md:max-w-md lg:max-w-lg w-[calc(100%-2rem)] rounded-2xl p-0 overflow-hidden bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800">
          <DialogHeader className="p-5 pb-3">
            <DialogTitle className="text-lg font-bold text-gray-900 dark:text-white">
              Appearance
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500 dark:text-gray-400">
              Choose your preferred theme
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-5 pb-5">
            <button
              onClick={() => {
                setAppearance("light");
                setAppearanceOpen(false);
              }}
              className={`w-full p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${appearance === "light"
                  ? "border-blue-600 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                }`}>
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${appearance === "light"
                    ? "border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500"
                    : "border-gray-300 dark:border-gray-600"
                  }`}>
                {appearance === "light" && (
                  <Check className="h-3 w-3 text-white" />
                )}
              </div>
              <Sun className="h-5 w-5 text-yellow-500 dark:text-yellow-400 flex-shrink-0" />
              <div className="text-left">
                <p className="font-medium text-gray-900 dark:text-white text-sm">
                  Light
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Default light theme
                </p>
              </div>
            </button>
            <button
              onClick={() => {
                setAppearance("dark");
                setAppearanceOpen(false);
              }}
              className={`w-full p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${appearance === "dark"
                  ? "border-blue-600 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                }`}>
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${appearance === "dark"
                    ? "border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500"
                    : "border-gray-300 dark:border-gray-600"
                  }`}>
                {appearance === "dark" && (
                  <Check className="h-3 w-3 text-white" />
                )}
              </div>
              <Moon className="h-5 w-5 text-gray-600 dark:text-gray-300 flex-shrink-0" />
              <div className="text-left">
                <p className="font-medium text-gray-900 dark:text-white text-sm">
                  Dark
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Dark theme
                </p>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>
 
      <DeleteAccountModal 
        isOpen={deleteModalOpen} 
        onClose={() => setDeleteModalOpen(false)} 
        onConfirm={handleConfirmDelete} 
        walletAmount={walletBalance} 
        moduleName="user" 
      />
    </AnimatedPage>
  );
}
