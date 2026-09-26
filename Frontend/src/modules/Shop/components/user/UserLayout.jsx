import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useState, createContext, useContext, useRef, useCallback } from "react"
import { ProfileProvider } from "@store/context/ProfileContext"
import { DeliveryLocationProvider } from "@store/context/DeliveryLocationContext"
import LocationPrompt from "./LocationPrompt"
import { CartProvider } from "@store/context/CartContext"
import { getStoreModeFromPath, useStoreMode } from "@store/context/StoreModeContext"
import AutoCouponController from "@store/components/user/AutoCouponController"
import { OrdersProvider } from "@store/context/OrdersContext"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

import SearchOverlay from "./SearchOverlay"
import DesktopHeader from "./desktop/DesktopHeader"
import BottomNav from "./storefront/BottomNav"
import MobileHeader from "./mobile/MobileHeader"
import QuickMobileHeader from "./quick-mobile/QuickMobileHeader"
import ReorderIntake from "./mobile/ReorderIntake"
import { QuickLayoutProvider } from "./quick-mobile/QuickLayoutContext"
import DesktopFooter from "./desktop/DesktopFooter"
import QuickZoneStrip from "./desktop/QuickZoneStrip"
import QuickCartDock, { QuickCartUIProvider } from "./desktop/quick/QuickCartPanel"
import GeminiAssistantWidget from "./GeminiAssistantWidget"
import SpinWheelModal from "./SpinWheelModal"
import FloatingSpinWidget from "./FloatingSpinWidget"
import { useUserNotifications } from "../../hooks/useUserNotifications"
import { shouldSkipScrollResetForHome } from "@store/utils/homeScrollRestore"

// Create SearchOverlay context with default value
const SearchOverlayContext = createContext({
  isSearchOpen: false,
  searchValue: "",
  isListening: false,
  setSearchValue: () => {
    debugWarn("SearchOverlayProvider not available")
  },
  openSearch: () => {
    debugWarn("SearchOverlayProvider not available")
  },
  closeSearch: () => { },
  startVoiceSearch: () => {
    debugWarn("SearchOverlayProvider not available")
  }
})

export function useSearchOverlay() {
  const context = useContext(SearchOverlayContext)
  // Always return context, even if provider is not available (will use default values)
  return context
}

function SearchOverlayProvider({ children }) {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef(null)

  const openSearch = () => {
    setIsSearchOpen(true)
  }

  const closeSearch = () => {
    setIsSearchOpen(false)
    setSearchValue("")
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
  }

  const startVoiceSearch = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Voice search is not supported in this browser.");
      return;
    }

    // Stop existing if any
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
      setIsSearchOpen(true); 
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setSearchValue(transcript.trim());
      setIsListening(false);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    try {
      recognition.start();
    } catch (err) {
      console.error("Failed to start recognition", err);
      setIsListening(false);
    }
  }, []);

  return (
    <SearchOverlayContext.Provider value={{ isSearchOpen, searchValue, setSearchValue, isListening, openSearch, closeSearch, startVoiceSearch }}>
      {children}
      {isSearchOpen && (
        <SearchOverlay
          isOpen={isSearchOpen}
          onClose={closeSearch}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          isListening={isListening}
          startVoiceSearch={startVoiceSearch}
        />
      )}
    </SearchOverlayContext.Provider>
  )
}

// Create LocationSelector context with default value
const LocationSelectorContext = createContext({
  isLocationSelectorOpen: false,
  openLocationSelector: () => {
    debugWarn("LocationSelectorProvider not available")
  },
  closeLocationSelector: () => { }
})

/**
 * Pages that draw their own phone top bar (back, title, actions) as in the
 * mobile mockup, so the big home header stays off them.
 */
const OWN_TOP_BAR = [
  /^(\/quick)?\/category\//,
  /^(\/quick)?\/product\//,
  /^(\/quick)?\/sellers(\/|$)/,
  /^(\/quick)?\/cart(\/|$)/,
  /^(\/quick)?\/wishlist$/,
  /^\/orders(\/|$)/,
  /^\/profile(\/|$)/,
]
const hasOwnTopBar = (path) => OWN_TOP_BAR.some((re) => re.test(path))

/** The Quick home layout is only fetched where it is shown. */
function QuickLayoutGate({ enabled, children }) {
  return enabled ? <QuickLayoutProvider>{children}</QuickLayoutProvider> : children
}

export function useLocationSelector() {
  const context = useContext(LocationSelectorContext)
  if (!context) {
    throw new Error("useLocationSelector must be used within LocationSelectorProvider")
  }
  return context
}

function LocationSelectorProvider({ children }) {
  const { storePath } = useStoreMode()
  const navigate = useNavigate()
  const location = useLocation()

  const openLocationSelector = () => {
    // Navigate to the standalone address selector page
    // Provide current pathname to state so back button returns here accurately
    navigate(storePath("/cart/address-selector"), { state: { backTo: location.pathname } })
  }

  const closeLocationSelector = () => { }

  const value = {
    isLocationSelectorOpen: false,
    openLocationSelector,
    closeLocationSelector
  }

  return (
    <LocationSelectorContext.Provider value={value}>
      {children}
    </LocationSelectorContext.Provider>
  )
}

export default function UserLayout() {
  const location = useLocation()
  const [isSpinWheelOpen, setIsSpinWheelOpen] = useState(false)

  // Anything can open the wheel — the Quick rewards banner, say — without a
  // route of its own: dispatch "wh:open-spin".
  useEffect(() => {
    const open = () => setIsSpinWheelOpen(true)
    window.addEventListener("wh:open-spin", open)
    return () => window.removeEventListener("wh:open-spin", open)
  }, [])

  useEffect(() => {
    // Reset scroll to top whenever location changes (pathname, search, or hash).
    // Skip when Home has a pending scroll position to restore (in-app back uses PUSH).
    if (shouldSkipScrollResetForHome(location.pathname)) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname, location.search, location.hash])

  useUserNotifications()

  // Note: Authentication checks and redirects are handled by ProtectedRoute components
  // UserLayout should not interfere with authentication redirects

  // Show bottom navigation only on home page and profile page
  const normalizedPath =
    location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname

  const storeMode = getStoreModeFromPath(normalizedPath)

  // The storefront shell: header/footer on every storefront page except sign-in screens.
  const showDesktopShell = !/(^|\/)auth(\/|$)/.test(normalizedPath)
  // On phones the floating spin wheel and assistant would cover Quick's cart bar
  // and the pinned Add to Cart / checkout bars.
  const hideFloatingOnPhone =
    storeMode === "quick" || /\/product\/|\/cart(\/|$)|^\/orders|\/wishlist$|^\/profile\/favorites|\/sellers(\/|$)/.test(normalizedPath)

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#f5f5f5] dark:bg-[#0a0a0a] transition-colors duration-200">
      <CartProvider key={storeMode} mode={storeMode}>
        <AutoCouponController />
        <ProfileProvider>
          <DeliveryLocationProvider>
          <OrdersProvider>
            <SearchOverlayProvider>
              <LocationSelectorProvider>
                {/* Quick desktop cart panel state, shared by the header button and the dock */}
                <QuickCartUIProvider>
                {/* One responsive header, Quick ETA strip and footer for every
                    width (DESKTOP_THEME.md). On Quick, phones get the ETA-first
                    header instead (QUICK_MOBILE_SPEC.md). */}
                <QuickLayoutGate enabled={storeMode === "quick"}>
                  {showDesktopShell && (
                    <DesktopHeader
                      onOpenSpin={() => setIsSpinWheelOpen(true)}
                      desktopOnly
                    />
                  )}
                  {/* Phones: the big header on home and search; other pages draw their own top bar. */}
                  {/* Quick keeps its ETA-first header; Shop gets the orange one. */}
                  {showDesktopShell && !hasOwnTopBar(normalizedPath) && (storeMode === "quick" ? <QuickMobileHeader /> : <MobileHeader />)}
                  {showDesktopShell && storeMode === "quick" && (
                    <div className="hidden lg:block">
                      <QuickZoneStrip />
                    </div>
                  )}
                  {/* Room for the phone's tab bar, which floats over the page. */}
                  {/* clip, not hidden: hidden makes <main> a scroll container and
                      every sticky bar inside a page stops sticking. */}
                  <main className="w-full min-w-0 max-w-full overflow-x-clip pb-[57px] md:pb-0">
                    <Outlet />
                  </main>
                  <ReorderIntake />
                  {showDesktopShell && <DesktopFooter />}
                  {showDesktopShell && <BottomNav />}
                </QuickLayoutGate>

                {/* Floating Daily Spin trigger: bottom-left with rich animations (desktop & mobile) */}
                {/* On Quick phones the cart bar owns the bottom of the screen; the
                    rewards banner leads to Spin & Win instead. */}
                {showDesktopShell && (
                  <div className={hideFloatingOnPhone ? "hidden lg:block" : ""}>
                    <FloatingSpinWidget onOpenSpin={() => setIsSpinWheelOpen(true)} />
                  </div>
                )}

                {/* Engagement Modals & Widgets */}
                <SpinWheelModal
                  isOpen={isSpinWheelOpen}
                  onClose={() => setIsSpinWheelOpen(false)}
                />
                {showDesktopShell && (
                  <div className={hideFloatingOnPhone ? "hidden lg:block" : ""}>
                    <GeminiAssistantWidget />
                  </div>
                )}

                {/* Quick (lg+) slide-in cart panel and bottom bar (QUICK_UI_SPEC.md) */}
                {showDesktopShell && storeMode === "quick" && !/\/cart(\/|$)/.test(normalizedPath) && <QuickCartDock />}
                </QuickCartUIProvider>
              </LocationSelectorProvider>
            </SearchOverlayProvider>
          </OrdersProvider>
          </DeliveryLocationProvider>
        </ProfileProvider>
      </CartProvider>
    </div>
  )
}
