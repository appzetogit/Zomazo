import React, { useState, useEffect, useRef } from "react"
import { useStoreMode } from "@store/context/StoreModeContext"
import { motion, AnimatePresence } from "framer-motion"
import {
  Sparkles,
  Send,
  X,
  Bot,
  User,
  ShoppingBag,
  Coins,
  Truck,
  ExternalLink,
  ChevronDown,
  RotateCcw,
  MessageSquare,
  HelpCircle,
  LifeBuoy,
} from "lucide-react"
import { aiAPI, supportAPI } from "@store/api"
import { useCart } from "@store/context/CartContext"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

const QUICK_PROMPTS = [
  { label: "🔍 Find casual shirts", query: "find casual shirts under 1000" },
  { label: "🪙 My coins", query: "what is my coin balance" },
  { label: "📦 Track my order", query: "track my order" },
  { label: "🏷️ Active coupons", query: "what are today's coupons" },
  { label: "⚡ Quick vs Standard", query: "what is the difference between quick and standard delivery?" },
]

export default function GeminiAssistantWidget() {
  const { storePath } = useStoreMode()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hello! I'm your shopping assistant. Ask me to find products, track orders, or check your coins!",
      suggestions: QUICK_PROMPTS.map((p) => p.label),
    },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [conversationId, setConversationId] = useState(null)
  const [handingOff, setHandingOff] = useState(false)
  const [ticketId, setTicketId] = useState(null)
  const messagesEndRef = useRef(null)
  const { addToCart } = useCart()
  const navigate = useNavigate()

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, isOpen])

  const handleSend = async (queryText = null) => {
    const textToSend = queryText || input.trim()
    if (!textToSend || isLoading) return

    const userMsg = { role: "user", text: textToSend }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setIsLoading(true)

    try {
      const res = await aiAPI.chat({
        message: textToSend,
        history: messages.slice(-6).map((m) => ({ role: m.role, text: m.text })),
        conversationId,
      })

      // sendResponse wraps the payload: { success, message, data }.
      const data = res?.data?.data || res?.data || {}
      if (data.conversationId) setConversationId(data.conversationId)
      const assistantMsg = {
        role: "assistant",
        text: data.reply || "Here is what I found for you:",
        products: data.products || [],
        orders: data.orders || [],
        suggestions: data.suggestions || [],
        unavailable: Boolean(data.unavailable),
      }

      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      console.error("AI chat error:", err)
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "I'm having trouble connecting right now. Please try again or browse our categories directly!",
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  /** Hands the chat to a person: a support ticket with the transcript attached. */
  const handleTalkToSupport = async () => {
    if (handingOff) return
    const transcript = messages
      .filter((m) => m.text)
      .map((m) => `${m.role === "user" ? "Customer" : "Assistant"}: ${m.text}`)
      .join("\n\n")
    const header = conversationId ? `Assistant conversation ${conversationId}\n\n` : ""
    setHandingOff(true)
    try {
      const res = await supportAPI.createTicket({
        type: "other",
        issueType: "Assistant hand-off",
        description: `${header}${transcript}`.slice(-8000),
      })
      const ticket = res?.data?.data?.ticket
      setTicketId(ticket?._id || "created")
      if (ticket?._id && conversationId) {
        aiAPI.linkHandoff({ conversationId, ticketId: ticket._id }).catch(() => {})
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "I've passed this conversation to our support team with the full chat attached. They'll get back to you soon. You can follow it under Help & Support.",
        },
      ])
      toast.success("Support ticket created")
    } catch (err) {
      const status = err?.response?.status
      toast.error(status === 401 ? "Please log in to contact support" : "Could not reach support. Please try again.")
    } finally {
      setHandingOff(false)
    }
  }

  const handleProductClick = (productId) => {
    navigate(storePath(`/product/${productId}`))
    setIsOpen(false)
  }

  const handleAddToCart = (product, e) => {
    e.stopPropagation()
    const result = addToCart({
      id: product.id,
      _id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      sellerId: product.sellerId,
      seller: product.sellerName || product.seller,
      quantity: 1,
    })
    if (result?.ok === false) {
      // needsConfirmation means the replace dialog is up; it speaks for itself.
      if (!result.needsConfirmation) {
        toast.error(result.error || "Could not add item to cart")
      }
      return
    }
    toast.success(`Added ${product.name} to cart!`)
  }

  return (
    <>
      {/* Floating Pill Button */}
      <div className="fixed bottom-[72px] right-3 lg:bottom-6 lg:right-5 z-40">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Ask the assistant"
          className="flex h-11 w-11 items-center justify-center gap-2 lg:h-auto lg:w-auto lg:px-4 lg:py-2.5 rounded-full bg-gradient-to-r from-purple-600 via-indigo-600 to-amber-500 text-white font-semibold text-sm shadow-xl hover:shadow-purple-500/25 transition-all border border-white/20 cursor-pointer"
        >
          <Sparkles className="w-5 h-5 lg:w-4 lg:h-4 text-amber-300 animate-pulse" aria-hidden="true" />
          <span className="hidden lg:inline">Ask the assistant</span>
        </motion.button>
      </div>

      {/* Slide-in Chat Drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-20 md:bottom-20 right-4 z-50 w-[92vw] sm:w-[420px] h-[580px] max-h-[80vh] flex flex-col rounded-3xl bg-slate-900 border border-indigo-500/30 shadow-2xl overflow-hidden backdrop-blur-xl text-white"
          >
            {/* Header */}
            <div className="px-5 py-3.5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-purple-500 to-amber-400 flex items-center justify-center shadow-inner">
                  <Bot className="w-5 h-5 text-slate-950" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-sm text-white">Shopping assistant</h3>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Gemini
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">Shopping & Delivery Assistant</p>
                </div>
              </div>

              <div className="flex items-center gap-1">
              <button
                onClick={handleTalkToSupport}
                disabled={handingOff || Boolean(ticketId) || messages.length < 2}
                title={ticketId ? "Sent to support" : "Talk to support"}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white/10 hover:bg-white/20 text-slate-200 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <LifeBuoy className="w-3.5 h-3.5" />
                {ticketId ? "Sent" : handingOff ? "Sending…" : "Talk to support"}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role === "assistant" && (
                    <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-2xl p-3 leading-relaxed ${
                      m.role === "user"
                        ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-br-none shadow-md"
                        : "bg-slate-800/80 border border-slate-700/60 text-slate-200 rounded-tl-none"
                    }`}
                  >
                    <div className="whitespace-pre-line">{m.text}</div>

                    {/* Render Recommended Products if returned */}
                    {m.products && m.products.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {m.products.map((p) => (
                          <div
                            key={p.id}
                            onClick={() => handleProductClick(p.id)}
                            className="p-2 rounded-xl bg-slate-900/90 border border-slate-700 hover:border-indigo-500 transition cursor-pointer flex flex-col justify-between group"
                          >
                            {p.image ? (
                              <img
                                src={p.image}
                                alt={p.name}
                                className="w-full h-20 object-cover rounded-lg mb-1.5"
                              />
                            ) : (
                              <div className="w-full h-20 bg-slate-800 rounded-lg mb-1.5 flex items-center justify-center text-slate-500">
                                <ShoppingBag className="w-6 h-6" />
                              </div>
                            )}

                            <div className="font-semibold text-white line-clamp-1 group-hover:text-indigo-300 transition">
                              {p.name}
                            </div>

                            <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-800">
                              <div>
                                <span className="font-bold text-amber-400">₹{p.price}</span>
                                {p.mrp > p.price && (
                                  <span className="text-[10px] text-slate-500 line-through ml-1">
                                    ₹{p.mrp}
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={(e) => handleAddToCart(p, e)}
                                className="px-2 py-0.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold text-white transition"
                              >
                                + Add
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Render Live Order Tracking if returned */}
                    {m.orders && m.orders.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {m.orders.map((ord, oIdx) => (
                          <div
                            key={oIdx}
                            className="p-2.5 rounded-xl bg-slate-900 border border-indigo-500/40 flex items-center justify-between"
                          >
                            <div>
                              <div className="font-bold text-white flex items-center gap-1.5">
                                <Truck className="w-3.5 h-3.5 text-indigo-400" />
                                #{ord.orderId}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {ord.mode === "quick" ? "⚡ Quick Commerce" : "📦 Courier"} • ₹{ord.total}
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold uppercase">
                              {ord.phase || ord.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {m.unavailable && !ticketId && (
                      <button
                        onClick={handleTalkToSupport}
                        disabled={handingOff}
                        className="mt-2.5 flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-[10px] font-semibold transition cursor-pointer disabled:opacity-50"
                      >
                        <LifeBuoy className="w-3 h-3" /> Talk to support
                      </button>
                    )}

                    {/* Action Suggestion Chips */}
                    {m.suggestions && m.suggestions.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5 pt-2 border-t border-slate-700/50">
                        {m.suggestions.map((sug, sIdx) => (
                          <button
                            key={sIdx}
                            onClick={() => handleSend(sug)}
                            className="px-2.5 py-1 rounded-full bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-[10px] font-medium transition cursor-pointer"
                          >
                            {sug}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-2.5 items-center text-slate-400">
                  <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex gap-1 py-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Prompts Bar if at beginning */}
            {messages.length <= 2 && (
              <div className="px-3 py-1.5 bg-slate-950/60 border-t border-white/5 flex gap-1.5 overflow-x-auto no-scrollbar">
                {QUICK_PROMPTS.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(p.query)}
                    className="whitespace-nowrap px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] transition shrink-0 cursor-pointer border border-slate-700"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {/* Input Bar */}
            <div className="p-3 bg-slate-950 border-t border-white/10 flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask anything (e.g. find shoes under 999)..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-full px-4 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                className="p-2 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white disabled:opacity-40 transition hover:scale-105 active:scale-95 cursor-pointer disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
