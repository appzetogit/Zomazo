import { useCallback, useEffect, useState } from "react"
import { Button, Empty, Shell, Spinner, Tabs } from "../../components/partner/ui"
import JobRow, { ACTIVE } from "../components/JobRow"
import { workerNav } from "../nav"
import useWorkerLive from "../useWorkerLive"
import { workerApi } from "../workerApi"

/*
 * GET /workers/jobs filters on one exact status, so "Active" is the unfiltered
 * list narrowed here, and History asks for completed jobs page by page.
 */
const TABS = [
  { value: "active", label: "Active" },
  { value: "completed", label: "History" },
  { value: "cancelled", label: "Cancelled" },
]

export default function Jobs() {
  const [tab, setTab] = useState("active")
  const [items, setItems] = useState(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)

  const load = useCallback(
    async (p = 1) => {
      try {
        const res =
          tab === "active" ? await workerApi.jobs({ limit: 50 }) : await workerApi.jobs({ status: tab, page: p, limit: 20 })
        let list = res?.data || []
        if (tab === "active") list = list.filter((j) => ACTIVE.includes(j.status))
        setItems((prev) => (p === 1 ? list : [...(prev || []), ...list]))
        setPage(p)
        setPages(tab === "active" ? 1 : res?.pagination?.pages || 1)
      } catch {
        if (p === 1) setItems([])
      }
    },
    [tab]
  )

  useEffect(() => {
    setItems(null)
    load(1)
  }, [load])

  const { requests } = useWorkerLive(() => load(1))

  return (
    <Shell title="Jobs" nav={workerNav(requests.length)}>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {!items ? (
        <Spinner />
      ) : items.length ? (
        <div className="space-y-2">
          {items.map((j) => (
            <JobRow key={j._id} job={j} />
          ))}
          {page < pages && (
            <Button variant="secondary" className="w-full" onClick={() => load(page + 1)}>
              Load more
            </Button>
          )}
        </div>
      ) : (
        <Empty title={tab === "active" ? "No active jobs" : "Nothing here yet"} />
      )}
    </Shell>
  )
}
