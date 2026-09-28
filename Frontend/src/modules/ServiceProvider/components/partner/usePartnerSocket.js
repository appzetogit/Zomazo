import { useEffect, useRef, useState } from "react"
import { io } from "socket.io-client"

/*
 * Live events for a signed-in vendor or worker.
 *
 * The shared SocketContext picks its role from the URL (/vendor, /worker) and then
 * navigates to the standalone app's paths, neither of which exists inside master,
 * so the partner apps open their own connection here instead. Same server, same
 * contract: the /sp namespace on master's Socket.IO instance, authenticated with
 * the access token, which puts the socket in `vendor_<id>` or `worker_<id>` on the
 * server (sockets/index.js) -- no room joins needed from this side.
 *
 * `handlers` maps event names to callbacks; they are read through a ref so a
 * re-render does not reconnect.
 */
const resolveSocketUrl = () => {
  const base = import.meta.env.VITE_SP_API_BASE_URL || "/api/v1/sp"
  let origin = window.location.origin
  try {
    origin = new URL(base, window.location.origin).origin
  } catch {
    // relative base: same origin as the page
  }
  return `${origin}/sp`
}

export default function usePartnerSocket(tokenKey, handlers) {
  const [connected, setConnected] = useState(false)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const eventNames = Object.keys(handlers).sort().join(",")

  useEffect(() => {
    const token = localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey)
    if (!token) return undefined

    const socket = io(resolveSocketUrl(), {
      auth: { token },
      path: "/socket.io/",
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })

    socket.on("connect", () => setConnected(true))
    socket.on("disconnect", () => setConnected(false))
    socket.on("connect_error", () => setConnected(false))

    const names = eventNames ? eventNames.split(",") : []
    for (const name of names) {
      socket.on(name, (payload) => handlersRef.current[name]?.(payload))
    }

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [tokenKey, eventNames])

  return connected
}
