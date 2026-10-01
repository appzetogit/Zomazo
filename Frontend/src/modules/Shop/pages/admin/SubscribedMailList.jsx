import AdminMailList from "@/shared/spotlight/AdminMailList"

// The platform newsletter list, opened on the Shop's subscribers (Backend core/mailingList).
export default function SubscribedMailList() {
  return <AdminMailList defaultSource="shop" />
}
