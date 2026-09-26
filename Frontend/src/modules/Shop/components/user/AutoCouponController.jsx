import useAutoCouponEngine from "@store/hooks/useAutoCouponEngine"
import AutoCouponCelebration from "@store/components/user/AutoCouponCelebration"

export default function AutoCouponController() {
  useAutoCouponEngine({ enabled: true })
  return <AutoCouponCelebration />
}
