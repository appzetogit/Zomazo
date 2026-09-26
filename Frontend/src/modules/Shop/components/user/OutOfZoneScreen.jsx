import React from "react";
import { useStoreMode } from "@store/context/StoreModeContext"
import { MapPin, ChevronDown } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { brandLogoOnDark } from "@/config/brandMark";
import { useCompanyName } from "@store/hooks/useCompanyName"

const OutOfZoneScreen = ({ location }) => {
  const { storePath } = useStoreMode()
  const companyName = useCompanyName()

  const routerLocation = useLocation();

  React.useEffect(() => {
    const state = window.history.state || {};
    window.history.pushState({ ...state, __outOfZoneExitGuard: true }, "");

    const handlePopState = () => {
      // Exit away from the website when back is pressed on this screen.
      window.location.replace("about:blank");
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden fixed inset-0 z-[200]" style={{ background: "linear-gradient(160deg, var(--wh-nav, #131921) 0%, var(--wh-nav-2, #232F3E) 100%)" }}>
      <div className="absolute top-0 left-0 right-0 pt-6 pb-4 px-4 z-50 bg-transparent">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <Link
              to={storePath("/cart/address-selector")}
              state={{ from: routerLocation.pathname }}
              className="inline-flex items-center gap-2 cursor-pointer group max-w-full no-underline"
            >
              <div className="p-1.5 rounded-full group-active:scale-95 transition-all shrink-0">
                <MapPin className="h-5 w-5 text-white" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[17px] font-black text-white truncate drop-shadow-md">
                    {(() => {
                      const area =
                        location?.area ||
                        location?.subLocality ||
                        location?.mainTitle ||
                        location?.neighborhood;
                      if (area && !/^-?\d+(\.\d+)?$/.test(area.trim()))
                        return area;
                      return location?.city || "Select Location";
                    })()}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-white/90 shrink-0" />
                </div>
                <span className="text-[12px] font-bold text-white/90 truncate leading-tight drop-shadow-sm">
                  {location?.city || "Pinpoint location"}
                </span>
              </div>
            </Link>
          </div>

        </div>
      </div>

      <div className="absolute inset-x-0 top-[22vh] z-0 flex justify-center">
        <img src={brandLogoOnDark()} alt="" className="h-20 w-auto object-contain opacity-90" />
      </div>

      <div className="absolute top-[48vh] left-0 w-full -translate-y-1/2 flex flex-col items-center z-10 px-6">
        <div className="text-center">
          <h2 className="text-[26px] font-bold text-white leading-[1.2] mb-3 tracking-tight">
            Quick delivery isn't here yet
          </h2>
          <p className="text-[15px] font-medium text-white/85 leading-[1.5] max-w-[340px] mx-auto">
            Our 10-minute delivery doesn't reach this location yet. You can still
            shop everything else, delivered to your door by courier.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-[#FD920B] px-6 py-3 text-[15px] font-bold text-[#0F1111] no-underline hover:bg-wh-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Shop on {companyName}
          </Link>
        </div>
      </div>

    </div>
  );
};

export default OutOfZoneScreen;
