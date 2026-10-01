import Cashback from "@food/pages/admin/Cashback"

// The platform's cashback offers are one list for every service
// (core/promotions); the Shop admin opens it with the Shop picked for new offers.
export default function ShopCashback() {
  return <Cashback defaultServices={["ecommerce"]} />
}
