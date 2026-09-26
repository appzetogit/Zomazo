import useAutoCouponEngine from "@shop/hooks/useAutoCouponEngine"
import AutoCouponCelebration from "@shop/components/user/AutoCouponCelebration"

export default function AutoCouponController() {
  useAutoCouponEngine({ enabled: true })
  return <AutoCouponCelebration />
}
