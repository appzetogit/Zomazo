import mongoose from 'mongoose';
import { Product } from '../../admin/models/product.model.js';
import { Order } from '../../orders/models/order.model.js';
import { Offer } from '../../admin/models/offer.model.js';
import { getCoinBalance } from '../../coins/services/coin.service.js';
import { logger } from '../../../../utils/logger.js';
import { config } from '../../../../config/env.js';
import { callGemini, hasGeminiKey } from './geminiClient.js';
import { effectiveModel } from './aiSettings.service.js';

/** The assistant's persona and scope, named after the configured brand. */
const systemInstruction = () => `You are the shopping assistant for ${config.brand.name}, a marketplace with quick delivery and standard courier shipping.
You help customers:
1. Discover products, compare variants, and find the best deals.
2. Track existing orders and delivery phases.
3. Understand coins, rewards and coupons.
4. Distinguish between Quick Delivery (about 30 minutes from nearby stores) and Standard courier shipping.
You cannot place, cancel or refund orders; point the customer to the app for that.
Keep answers concise and helpful. Suggest relevant actions when useful.`;

/**
 * Tool 1: Search products from live catalogue.
 */
async function toolSearchProducts(query, maxPrice = null) {
    const filter = {
        isDeleted: { $ne: true },
        isAvailable: true,
    };
    if (query && typeof query === 'string') {
        const clean = query.replace(/[^\w\s]/g, '').trim();
        if (clean) {
            filter.$or = [
                { name: { $regex: clean, $options: 'i' } },
                { description: { $regex: clean, $options: 'i' } },
                { brand: { $regex: clean, $options: 'i' } },
            ];
        }
    }
    if (maxPrice && Number(maxPrice) > 0) {
        filter.price = { $lte: Number(maxPrice) };
    }

    const items = await Product.find(filter)
        .select('_id name brand price mrp image images categoryName sellerId isAvailable availableIn variants')
        .limit(6)
        .lean();

    return items.map((p) => {
        const primaryImage = p.image || p.images?.[0] || '';
        return {
            id: p._id,
            name: p.name,
            brand: p.brand || '',
            price: p.price,
            mrp: p.mrp || p.price,
            discount: p.mrp && p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0,
            image: primaryImage,
            hasVariants: Array.isArray(p.variants) && p.variants.length > 0,
            inStock: p.isAvailable !== false,
            availableIn: { quick: p.availableIn?.quick !== false, shop: p.availableIn?.shop !== false },
        };
    });
}

/**
 * Tool 2: Get user's recent orders.
 */
async function toolGetUserOrders(userId) {
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return [];
    const orders = await Order.find({ userId: new mongoose.Types.ObjectId(String(userId)) })
        .sort({ createdAt: -1 })
        .limit(3)
        .select('order_id orderId orderStatus deliveryState pricing items fulfilmentMode createdAt')
        .lean();

    return orders.map((o) => ({
        orderId: o.order_id || o.orderId || String(o._id),
        status: o.orderStatus,
        phase: o.deliveryState?.currentPhase || o.orderStatus,
        total: o.pricing?.total || 0,
        mode: o.fulfilmentMode || 'quick',
        itemCount: o.items?.length || 0,
        items: (o.items || []).slice(0, 3).map((it) => it.name || it.dishName || 'Item'),
        date: o.createdAt,
    }));
}

/**
 * Tool 3: Get user's coin balance.
 */
async function toolGetCoinBalance(userId) {
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
    return getCoinBalance(userId).catch(() => null);
}

/**
 * Tool 4: Get active offers.
 */
async function toolGetActiveOffers() {
    const now = new Date();
    const offers = await Offer.find({
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gte: now },
    })
        .select('title couponCode discountType discountValue minOrderAmount maxDiscount')
        .limit(4)
        .lean();
    return offers;
}

/**
 * Process a user chat message with intelligent local intent resolution
 * and optional Google Gemini API augmentation.
 */
export async function handleAssistantChat({ message, userId = null, history = [], settings = null }) {
    const text = String(message || '').trim();
    if (!text) {
        return {
            reply: "Hi there! I'm the assistant. How can I help you today? You can search products, check order status, or explore coins!",
            products: [],
            suggestions: ['Find latest offers', 'Track my order', 'My coins', 'Quick vs Standard'],
        };
    }

    const lower = text.toLowerCase();

    // 1. Check intent: Coins & Rewards
    if (lower.includes('coin') || lower.includes('reward') || lower.includes('balance') || lower.includes('spin')) {
        let coinData = null;
        if (userId) {
            coinData = await toolGetCoinBalance(userId);
        }
        const balanceText = coinData
            ? `You currently have **${coinData.usable} usable coins** (worth ₹${coinData.usableValue})!`
            : `coins can be earned through order refunds, referrals, and the Daily Lucky Wheel!`;

        return {
            reply: `${balanceText}\n\n💡 **How it works:**\n- 1 Coin = ₹1 discount on checkouts.\n- You can pay up to **50%** of any order total using coins.\n- Refund coins give you 80% usable balance with instant credit.`,
            suggestions: ['Play Daily Lucky Wheel', 'Explore trending items', 'Track my order'],
            action: { type: 'coins', data: coinData },
            toolCalls: [{ name: 'getCoinBalance', args: null }],
        };
    }

    // 2. Check intent: Order tracking
    if (lower.includes('order') || lower.includes('track') || lower.includes('where is my') || lower.includes('status')) {
        if (!userId) {
            return {
                reply: 'To track your live orders, please log in to your account. I can show you live courier tracking and delivery stages right here!',
                suggestions: ['Browse products', 'Check available offers'],
            };
        }
        const orders = await toolGetUserOrders(userId);
        if (!orders.length) {
            return {
                reply: "You don't have any recent orders placed yet. Would you like to check out some trending products or active coupons?",
                suggestions: ['Show popular products', 'Active coupons'],
            };
        }

        const latest = orders[0];
        const readablePhase = (latest.phase || latest.status || 'placed').replace(/_/g, ' ').toUpperCase();
        return {
            reply: `Here is your latest order **#${latest.orderId}**:\n- **Status:** ${readablePhase}\n- **Mode:** ${latest.mode === 'quick' ? '⚡ Quick Delivery (15-30m)' : '📦 Standard Courier'}\n- **Amount:** ₹${latest.total}\n- **Items:** ${latest.items.join(', ')}`,
            orders,
            toolCalls: [{ name: 'getUserOrders', args: null }],
            suggestions: ['Need help with this order?', 'Browse more products', 'Check coins balance'],
        };
    }

    // 3. Check intent: Offers & Discounts
    if (lower.includes('offer') || lower.includes('coupon') || lower.includes('discount') || lower.includes('promo') || lower.includes('deal')) {
        const offers = await toolGetActiveOffers();
        const offerList = offers.length
            ? offers.map((o) => `🏷️ **${o.couponCode}**: ${o.title} (${o.discountType === 'percentage' ? `${o.discountValue}% OFF` : `₹${o.discountValue} OFF`})`).join('\n')
            : 'Check out our daily discounts on popular category pages!';

        return {
            toolCalls: [{ name: 'getActiveOffers', args: null }],
            reply: `Here are the top promotions available today:\n\n${offerList}\n\nApply these codes at checkout or redeem your coins for up to 50% off!`,
            suggestions: ['Search clothing', 'Find electronics', 'How to use coins'],
        };
    }

    // 4. Check intent: Product search
    let searchQuery = text;
    let maxPrice = null;

    // Extract price constraint if present e.g. "under 500" or "below 1000"
    const priceMatch = text.match(/(?:under|below|less than|within)\s*(?:rs\.?|inr|₹)?\s*(\d+)/i);
    if (priceMatch) {
        maxPrice = parseInt(priceMatch[1], 10);
        searchQuery = text.replace(priceMatch[0], '').replace(/(find|show|give|me|search|for|buy|get)/gi, '').trim();
    } else {
        searchQuery = text.replace(/(find|show|give|me|search|for|buy|get|looking for)/gi, '').trim();
    }

    const foundProducts = await toolSearchProducts(searchQuery, maxPrice);

    if (foundProducts.length > 0) {
        return {
            reply: `I found ${foundProducts.length} great option${foundProducts.length > 1 ? 's' : ''} for "${searchQuery || text}"${maxPrice ? ` under ₹${maxPrice}` : ''}:`,
            products: foundProducts,
            toolCalls: [{ name: 'searchProducts', args: { query: searchQuery, maxPrice } }],
            suggestions: ['Filter by low price', 'Check active coupons', 'View delivery modes'],
        };
    }

    // 5. Ask Gemini when a key is configured (the caller has already checked
    //    the enabled switch, the daily cap and the monthly budget).
    if (hasGeminiKey()) {
        try {
            const addendum = String(settings?.systemPromptAddendum || '').trim();
            const priorTurns = (Array.isArray(history) ? history : []).slice(-6)
                .filter((h) => h && typeof h.text === 'string' && h.text.trim())
                .map((h) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text.slice(0, 1000) }] }));
            // Gemini wants the conversation to open with a user turn.
            while (priorTurns.length && priorTurns[0].role !== 'user') priorTurns.shift();
            const result = await callGemini({
                model: effectiveModel(settings),
                systemText: addendum ? `${systemInstruction()}

Additional guidance from the store:
${addendum}` : systemInstruction(),
                contents: [...priorTurns, { role: 'user', parts: [{ text }] }],
                generationConfig: { maxOutputTokens: 400 },
            });
            if (result.text) {
                return {
                    reply: result.text,
                    usage: result.usage,
                    model: result.model,
                    suggestions: ['Search popular products', 'My coins', 'Track latest order'],
                };
            }
            return fallbackReply({ usage: result.usage, model: result.model });
        } catch (geminiErr) {
            // The message only; the request config (with its headers) is never logged.
            logger.warn(`Gemini API call skipped/failed: ${geminiErr.message}`);
        }
    }

    return fallbackReply();
}

function fallbackReply(extra = {}) {
    // Fallback general response
    return {
        reply: `I can help you explore products, check available deals, track your courier shipments, or manage coins. What would you like to discover?`,
        suggestions: ['Search summer collection', 'What is Quick Delivery?', 'Check today’s coupons', 'My coins'],
        ...extra,
    };
}
