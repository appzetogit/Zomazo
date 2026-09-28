import { Navigate } from "react-router-dom"

/**
 * The Shop's notifications live in the super app's one customer inbox, next to
 * food, rides, quick and services (Backend core/notifications/customerInbox.js
 * files every Shop push there). This page once kept its own list in
 * localStorage, seeded with sample entries that never happened.
 */
export default function Notifications() {
  return <Navigate to="/food/user/notifications" replace />
}
