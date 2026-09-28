import { Navigate, useParams } from "react-router-dom"
import AddCouponPage from "./AddCouponPage"

export default function EditCouponPage() {
  const { id } = useParams()

  // If no id, just go back to coupon list
  if (!id) return <Navigate to="/restaurant/coupon" replace />

  return <AddCouponPage key={id} mode="edit" couponId={id} />
}
