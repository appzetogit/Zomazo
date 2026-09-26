import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Coins as CoinsIcon, Loader2, Lock, Clock } from "lucide-react"
import AnimatedPage from "@store/components/user/AnimatedPage"
import { coinsAPI } from "@store/api"
import useAppBackNavigation from "@store/hooks/useAppBackNavigation"

const PAGE_SIZE = 20

const SOURCE_LABEL = {
  refund: "Refund",
  admin: "Added by support",
  campaign: "Promotion",
  spin: "Spin reward",
  referral: "Referral reward",
  reversal: "Returned",
}

function entryLabel(entry) {
  switch (entry.type) {
    case "credit":
      return SOURCE_LABEL[entry.source] || "Coins added"
    case "debit":
      return "Used on an order"
    case "reversal":
      return "Returned from an order"
    case "expire":
      return "Expired"
    case "adjust":
      return "Removed by support"
    default:
      return "Coins"
  }
}

const signedOf = (entry) => {
  if (Number.isFinite(Number(entry.signedAmount))) return Number(entry.signedAmount)
  const n = Math.abs(Number(entry.amount) || 0)
  return ["debit", "expire", "adjust"].includes(entry.type) ? -n : n
}

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""

const dataOf = (res) => res?.data?.data ?? res?.data ?? null

export default function Coins() {
  const goBack = useAppBackNavigation()
  const [balance, setBalance] = useState(null)
  const [expiring, setExpiring] = useState({ lots: [], total: 0 })
  const [entries, setEntries] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingPage, setLoadingPage] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true
    Promise.all([coinsAPI.getBalance(), coinsAPI.getExpiring(30)])
      .then(([b, e]) => {
        if (!alive) return
        setBalance(dataOf(b))
        setExpiring(dataOf(e) || { lots: [], total: 0 })
      })
      .catch(() => alive && setError("Could not load your coins. Please try again."))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const loadPage = useCallback(async (p) => {
    setLoadingPage(true)
    try {
      const data = dataOf(await coinsAPI.getLedger({ page: p, limit: PAGE_SIZE }))
      setEntries(Array.isArray(data?.entries) ? data.entries : [])
      setTotalPages(Math.max(1, Number(data?.totalPages) || Math.ceil((Number(data?.total) || 0) / PAGE_SIZE) || 1))
      setPage(p)
    } catch {
      setError("Could not load your coin history.")
    } finally {
      setLoadingPage(false)
    }
  }, [])

  useEffect(() => {
    loadPage(1)
  }, [loadPage])

  const coins = Number(balance?.coins) || 0
  const usable = Number(balance?.usable) || 0
  const locked = Math.max(0, coins - usable)

  return (
    <AnimatedPage className="min-h-screen bg-white dark:bg-[#0a0a0a]">
      <div className="bg-white dark:bg-[#1a1a1a] sticky top-0 z-10 border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-3xl mx-auto flex items-center gap-3 px-4 py-4">
          <button
            onClick={goBack}
            aria-label="Back"
            className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
          >
            <ArrowLeft className="h-5 w-5 text-gray-700 dark:text-white" />
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Coins</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <section className="rounded-2xl p-5 bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow">
              <div className="flex items-center gap-2 text-sm opacity-90">
                <CoinsIcon className="h-4 w-4" /> Your coins
              </div>
              <p className="text-4xl font-bold mt-1">{coins}</p>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="bg-white/15 rounded-xl p-3">
                  <p className="text-xs opacity-90">Usable</p>
                  <p className="text-xl font-semibold">{usable}</p>
                  {Number(balance?.usableValue) > 0 && (
                    <p className="text-[11px] opacity-90">Worth {"₹"}{Number(balance.usableValue).toFixed(0)}</p>
                  )}
                </div>
                <div className="bg-white/15 rounded-xl p-3">
                  <p className="text-xs opacity-90 flex items-center gap-1">
                    <Lock className="h-3 w-3" /> Locked
                  </p>
                  <p className="text-xl font-semibold">{locked}</p>
                </div>
              </div>
              <p className="text-[11px] mt-3 opacity-90">
                Only 80% of the coins from each credit can be spent; the rest stay locked. Coins can pay for part of an order.
              </p>
              {balance && balance.isEnabled === false && (
                <p className="text-xs mt-2 font-semibold">Coins can't be used on orders right now.</p>
              )}
            </section>

            <section>
              <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" /> Expiring in the next 30 days
              </h2>
              {expiring.lots?.length ? (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-100 dark:border-gray-800">
                  {expiring.lots.map((lot) => (
                    <li key={lot.lotId} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{lot.coins} coins</p>
                        <p className="text-xs text-gray-500">
                          {SOURCE_LABEL[lot.source] || "Coins"}
                          {lot.locked > 0 ? ` · ${lot.usable} usable, ${lot.locked} locked` : ""}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                        Expires {formatDate(lot.expiresAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No coins expire in the next 30 days.</p>
              )}
            </section>

            <section>
              <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">History</h2>
              {loadingPage ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                </div>
              ) : entries.length ? (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-100 dark:border-gray-800">
                  {entries.map((entry) => {
                    const n = signedOf(entry)
                    return (
                      <li key={entry._id} className="flex items-center justify-between px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white">{entryLabel(entry)}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {formatDate(entry.createdAt)}
                            {entry.note ? ` · ${entry.note}` : ""}
                          </p>
                        </div>
                        <span className={`font-semibold ${n >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                          {n >= 0 ? `+${n}` : `−${Math.abs(n)}`}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No coin activity yet.</p>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-sm">
                  <button
                    type="button"
                    disabled={page <= 1 || loadingPage}
                    onClick={() => loadPage(page - 1)}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-gray-500">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages || loadingPage}
                    onClick={() => loadPage(page + 1)}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AnimatedPage>
  )
}
