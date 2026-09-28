import { useEffect, useState } from "react"
import { authAPI, orderAPI, userAPI } from "@food/api"

/** True while a customer is signed in on this device (the platform sign-in). */
export const isSignedIn = () => {
  try {
    return Boolean(localStorage.getItem("user_accessToken"))
  } catch {
    return false
  }
}

/**
 * What the super app's home and account screens show about the customer: their
 * platform profile, the one wallet every service shares, and what is on its
 * way from any service. Each part loads on its own, so one slow service never
 * blanks the others; a signed-out visitor loads nothing.
 */
export function useAccount({ withOngoing = false } = {}) {
  const signedIn = isSignedIn()
  const [user, setUser] = useState(null)
  const [balance, setBalance] = useState(null)
  const [ongoing, setOngoing] = useState([])
  const [loading, setLoading] = useState(signedIn)

  useEffect(() => {
    if (!signedIn) return undefined
    let alive = true
    const jobs = [
      authAPI.getCurrentUser().then((res) => {
        const u = res?.data?.data?.user || res?.data?.user || null
        if (alive) setUser(u)
      }),
      userAPI.getWallet().then((res) => {
        const w = res?.data?.data?.wallet || res?.data?.wallet
        if (alive && w) setBalance(Number(w.balance) || 0)
      }),
    ]
    if (withOngoing) {
      jobs.push(
        orderAPI.getAllMyOrders({ state: "ongoing", limit: 5 }).then((res) => {
          const items = res?.data?.data?.items
          if (alive) setOngoing(Array.isArray(items) ? items : [])
        }),
      )
    }
    Promise.allSettled(jobs).finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [signedIn, withOngoing])

  return { signedIn, user, balance, ongoing, loading }
}
