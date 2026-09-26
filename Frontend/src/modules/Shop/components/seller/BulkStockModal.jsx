import React, { useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  X,
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowUpDown,
  RefreshCw,
} from "lucide-react"
import { toast } from "sonner"
import { sellerAPI } from "@store/api"
import { CHANNELS, CHANNEL_INFO, channelStock, channelThreshold, toStockValue } from "./channels"
import StockByChannelEditor from "./StockByChannelEditor"

export default function BulkStockModal({ isOpen, onClose, categories = [], onStockUpdated }) {
  const [activeTab, setActiveTab] = useState("edit") // 'edit' | 'export' | 'import'
  const [file, setFile] = useState(null)
  const [parsedRows, setParsedRows] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)
  const fileInputRef = useRef(null)

  // 1. Export CSV
  const handleExportCSV = () => {
    try {
      const headers = [
        "Item ID",
        "Variant ID",
        "Product Name",
        "Variant Name",
        "SKU",
        "Category",
        "Price",
        "Quick Stock",
        "Shop Stock",
        "Quick Low Stock",
        "Shop Low Stock",
      ]

      const rows = []

      categories.forEach((cat) => {
        ;(cat.items || []).forEach((item) => {
          if (Array.isArray(item.variants) && item.variants.length > 0) {
            item.variants.forEach((v) => {
              rows.push([
                item.id || item._id,
                v._id || v.id || "",
                `"${(item.name || "").replace(/"/g, '""')}"`,
                `"${(v.name || "").replace(/"/g, '""')}"`,
                `"${v.sku || item.sku || ""}"`,
                `"${(cat.name || "").replace(/"/g, '""')}"`,
                v.price ?? item.price ?? 0,
                ...CHANNELS.map((c) => channelStock(v, c) ?? ""),
                ...CHANNELS.map((c) => channelThreshold(v, c) ?? ""),
              ])
            })
          } else {
            rows.push([
              item.id || item._id,
              "",
              `"${(item.name || "").replace(/"/g, '""')}"`,
              "",
              `"${item.sku || ""}"`,
              `"${(cat.name || "").replace(/"/g, '""')}"`,
              item.price ?? 0,
              ...CHANNELS.map((c) => channelStock(item, c) ?? ""),
              ...CHANNELS.map((c) => channelThreshold(item, c) ?? ""),
            ])
          }
        })
      })

      const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n")
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.setAttribute("href", url)
      link.setAttribute("download", `inventory-stock-${new Date().toISOString().slice(0, 10)}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success("Inventory stock exported successfully!")
    } catch (err) {
      console.error("Export error:", err)
      toast.error("Failed to export stock CSV")
    }
  }

  // 2. Parse CSV File
  const handleFileChange = (e) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    if (!selected.name.endsWith(".csv")) {
      return toast.error("Please select a valid CSV file (.csv)")
    }

    setFile(selected)
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result
        if (!text) return

        const lines = text.split(/\r\n|\n/).filter((l) => l.trim().length > 0)
        if (lines.length < 2) {
          return toast.error("CSV file contains no data rows")
        }

        // Header parsing
        const rawHeaders = lines[0].split(",").map((h) => h.replace(/^["\uFEFF]+|["\s]+$/g, "").trim().toLowerCase())
        const itemIdIdx = rawHeaders.findIndex((h) => h.includes("item id") || h === "id")
        const variantIdIdx = rawHeaders.findIndex((h) => h.includes("variant id"))
        const nameIdx = rawHeaders.findIndex((h) => h.includes("name") || h.includes("product"))
        const skuIdx = rawHeaders.findIndex((h) => h.includes("sku"))
        const stockIdx = {
          quick: rawHeaders.findIndex((h) => h === "quick stock"),
          shop: rawHeaders.findIndex((h) => h === "shop stock"),
        }

        if (itemIdIdx === -1 || (stockIdx.quick === -1 && stockIdx.shop === -1)) {
          return toast.error("CSV must contain 'Item ID' and a 'Quick Stock' or 'Shop Stock' column")
        }

        const entries = []
        for (let i = 1; i < lines.length; i++) {
          // Simple CSV split accounting for quoted values
          const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(",")
          if (!row || row.length <= itemIdIdx) continue

          const clean = (val) => (val || "").replace(/^["\s]+|["\s]+$/g, "").trim()
          const itemId = clean(row[itemIdIdx])
          const variantId = variantIdIdx !== -1 ? clean(row[variantIdIdx]) : ""
          const name = nameIdx !== -1 ? clean(row[nameIdx]) : "Item"
          const sku = skuIdx !== -1 ? clean(row[skuIdx]) : ""
          if (!itemId) continue
          // One entry per channel column that has a number; blank cells are left untouched.
          for (const channel of CHANNELS) {
            if (stockIdx[channel] === -1) continue
            const qty = toStockValue(clean(row[stockIdx[channel]]))
            if (qty === null) continue
            entries.push({ itemId, variantId: variantId || undefined, name, sku, channel, qty })
          }
        }

        setParsedRows(entries)
        toast.info(`Loaded ${entries.length} items from CSV`)
      } catch (err) {
        console.error("Parse error:", err)
        toast.error("Failed to parse CSV file")
      }
    }
    reader.readAsText(selected)
  }

  // 3. Submit Bulk Stock Updates
  const handleApplyImport = async () => {
    if (!parsedRows.length) return

    setIsProcessing(true)
    try {
      // Chunk requests into batches of 300 to avoid payload limits
      const BATCH_SIZE = 300
      let totalUpdated = 0

      for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
        const batch = parsedRows.slice(i, i + BATCH_SIZE).map((r) => ({
          itemId: r.itemId,
          variantId: r.variantId,
          channel: r.channel,
          qty: r.qty,
        }))

        const res = await sellerAPI.updateStock(batch)
        const updatedCount = res?.data?.data?.updated?.length ?? batch.length
        totalUpdated += updatedCount
      }

      toast.success(`Successfully updated stock for ${totalUpdated} items!`)
      if (onStockUpdated) onStockUpdated()
      onClose()
    } catch (err) {
      console.error("Update error:", err)
      const msg = err?.response?.data?.message || err?.message || "Failed to update stock"
      toast.error(msg)
    } finally {
      setIsProcessing(false)
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Bulk Stock Manager (CSV / Excel)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Export your full catalogue, update counts in Excel, and re-import instantly.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 pt-2">
            <button
              onClick={() => setActiveTab("edit")}
              className={`pb-3 px-4 font-semibold text-xs border-b-2 transition-all flex items-center gap-2 ${
                activeTab === "edit"
                  ? "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
              }`}
            >
              <ArrowUpDown className="w-4 h-4" />
              <span>Stock by channel</span>
            </button>
            <button
              onClick={() => setActiveTab("export")}
              className={`pb-3 px-4 font-semibold text-xs border-b-2 transition-all flex items-center gap-2 ${
                activeTab === "export"
                  ? "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
              }`}
            >
              <Download className="w-4 h-4" />
              <span>1. Export Stock CSV</span>
            </button>
            <button
              onClick={() => setActiveTab("import")}
              className={`pb-3 px-4 font-semibold text-xs border-b-2 transition-all flex items-center gap-2 ${
                activeTab === "import"
                  ? "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
              }`}
            >
              <Upload className="w-4 h-4" />
              <span>2. Import Stock Updates</span>
              {parsedRows.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-[10px] font-bold text-blue-700 dark:text-blue-300">
                  {parsedRows.length}
                </span>
              )}
            </button>
          </div>

          {/* Body Content */}
          <div className="p-6 flex-1 overflow-y-auto">
            {activeTab === "edit" ? (
              <StockByChannelEditor categories={categories} onStockUpdated={onStockUpdated} />
            ) : activeTab === "export" ? (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
                  <p className="font-semibold mb-1">💡 How Bulk Export & Import works:</p>
                  <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-300">
                    <li>Download your current stock snapshot containing item IDs, variants, SKUs, and quantities.</li>
                    <li>Edit the <code className="px-1 py-0.5 rounded bg-white dark:bg-slate-800 font-mono">Quick Stock</code> and <code className="px-1 py-0.5 rounded bg-white dark:bg-slate-800 font-mono">Shop Stock</code> columns (blank cells are left unchanged) in Microsoft Excel or Google Sheets.</li>
                    <li>Save as CSV and upload it in the <strong>Import</strong> tab to batch-apply changes immediately.</li>
                  </ul>
                </div>

                <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 text-center bg-slate-50 dark:bg-slate-950/40">
                  <FileSpreadsheet className="w-12 h-12 mx-auto text-blue-500 mb-3" />
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-1">
                    Ready to export {categories.reduce((sum, c) => sum + (c.items?.length || 0), 0)} items
                  </h4>
                  <p className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
                    Includes all products and attribute variants (sizes, colors) across all store categories.
                  </p>
                  <button
                    onClick={handleExportCSV}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition shadow-md hover:shadow-blue-500/20 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Inventory CSV</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* File Dropzone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-2xl p-6 text-center bg-slate-50 dark:bg-slate-950/40 cursor-pointer transition"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                  <p className="font-semibold text-xs text-slate-700 dark:text-slate-200">
                    {file ? file.name : "Click to select edited CSV file"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">Accepts standard .csv exports</p>
                </div>

                {/* Preview Table */}
                {parsedRows.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                      <span>Previewing <strong>{parsedRows.length}</strong> items to update:</span>
                    </div>

                    <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 sticky top-0">
                          <tr>
                            <th className="p-2.5">Item</th>
                            <th className="p-2.5">SKU</th>
                            <th className="p-2.5 text-center">Channel</th>
                            <th className="p-2.5 text-right">New Stock</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                          {parsedRows.slice(0, 50).map((r, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                              <td className="p-2.5 font-medium text-slate-900 dark:text-white truncate max-w-[200px]">
                                {r.name}
                              </td>
                              <td className="p-2.5 font-mono text-[11px] text-slate-500">
                                {r.sku || "—"}
                              </td>
                              <td className="p-2.5 text-center">
                                <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${CHANNEL_INFO[r.channel].badge}`}>
                                  {CHANNEL_INFO[r.channel].label}
                                </span>
                              </td>
                              <td className="p-2.5 text-right font-bold text-blue-600 dark:text-blue-400">
                                {r.qty}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {parsedRows.length > 50 && (
                        <div className="p-2 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800">
                          + {parsedRows.length - 50} more items will be updated
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Action */}
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 transition cursor-pointer"
            >
              Cancel
            </button>

            {activeTab === "import" && parsedRows.length > 0 && (
              <button
                onClick={handleApplyImport}
                disabled={isProcessing}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition shadow-md hover:shadow-blue-500/20 disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Applying Stock...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Apply Updates ({parsedRows.length} Items)</span>
                  </>
                )}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
