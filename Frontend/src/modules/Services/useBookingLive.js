import { useEffect, useRef, useState } from "react"
import { io } from "socket.io-client"
import { SP_SOCKET_URL } from "./helpers"

/*
 * Server events that mean "this booking changed; read it again". The SP
 * controllers emit them to the customer's room (user_<spUserId>), which the
 * socket joins on connect -- the server bridges the platform token to the SP
 * account, as the REST middleware does.
 */
const CHANGE_EVENTS = ["booking_updated", "booking_accepted", "booking_search_failed", "payment_success", "notification"]

/**
 * Live updates for one booking: calls `onChange` when the server says the
 * booking moved, and returns the professional's last shared location.
 *
 * The socket is a nicety, not the source of truth -- the page also polls while
 * the booking is active, so a blocked websocket or a missed event only costs a
 * few seconds.
 */
export default function useBookingLive(bookingId, onChange, { track = false } = {}) {
  const [location, setLocation] = useState(null)
  const [connected, setConnected] = useState(false)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    const token = localStorage.getItem("user_accessToken")
    if (!bookingId || !token) return undefined

    const socket = io(SP_SOCKET_URL, {
      auth: { token },
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })

    const onEvent = (payload) => {
      const id = payload?.bookingId || payload?.relatedId || payload?._id
      // An event about another booking of the customer's is not this page's business.
      if (id && String(id) !== String(bookingId)) return
      changeRef.current?.()
    }

    socket.on("connect", () => {
      setConnected(true)
      // Joins the booking's room, where the professional's position is broadcast.
      if (track) socket.emit("join_tracking", bookingId)
    })
    socket.on("disconnect", () => setConnected(false))
    CHANGE_EVENTS.forEach((e) => socket.on(e, onEvent))
    socket.on("live_location_update", (p) => {
      const lat = Number(p?.lat)
      const lng = Number(p?.lng)
      if (Number.isFinite(lat) && Number.isFinite(lng)) setLocation({ lat, lng, at: Date.now() })
    })

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [bookingId, track])

  return { location, connected }
}
