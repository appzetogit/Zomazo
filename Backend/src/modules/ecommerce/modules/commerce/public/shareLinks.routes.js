import express from 'express';
import mongoose from 'mongoose';

import { config } from '../../../config/env.js';
import { Seller } from '../seller/models/seller.model.js';
import { Product } from '../admin/models/product.model.js';

const router = express.Router();

const PLAY_STORE_URL =
    process.env.ANDROID_PLAY_STORE_URL ||
    'https://play.google.com/store/apps/details?id=com.fooduser.app';
const APP_STORE_URL = process.env.IOS_APP_STORE_URL || '';

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/** Stored images may be absolute URLs or upload-relative paths. */
const absoluteUrl = (req, value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const origin = `${req.protocol}://${req.get('host')}`;
    return `${origin}/${raw.replace(/^\/+/, '')}`;
};

const firstOf = (...values) =>
    values.flat().find((v) => typeof v === 'string' && v.trim()) || '';

/**
 * The page a shared link lands on.
 *
 * Its real job is the Open Graph tags. WhatsApp, Instagram and the rest fetch the
 * URL and render a preview card from them, which is what makes a shared link look
 * like a shared seller rather than a bare string — and they only do that for
 * http(s) URLs, which is why the app no longer shares custom-scheme links.
 *
 * Anyone with the app installed never sees this page: Android App Links hands the
 * URL straight to the app. This is the fallback for everyone else, so it leads with
 * the store link rather than pretending to be the product.
 */
const renderPage = ({ title, description, image, canonical, appUrl }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · ${escapeHtml(config.brand.name)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapeHtml(config.brand.name)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
${image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : ''}
<style>
:root { color-scheme: light dark; }
body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  background:#fafafa; color:#1a1a1a; display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; }
.card { max-width:420px; width:100%; background:#fff; border-radius:20px; padding:28px;
  box-shadow:0 8px 30px rgba(0,0,0,.08); text-align:center; }
img { width:100%; max-height:220px; object-fit:cover; border-radius:14px; margin-bottom:20px; }
h1 { font-size:22px; margin:0 0 8px; }
p { color:#666; font-size:15px; line-height:1.5; margin:0 0 24px; }
a.btn { display:block; padding:14px 20px; border-radius:999px; text-decoration:none;
  font-weight:600; font-size:15px; margin-bottom:10px; }
.primary { background:#FF5700; color:#fff; }
.secondary { background:#f1f1f1; color:#1a1a1a; }
@media (prefers-color-scheme: dark) {
  body { background:#111; color:#f5f5f5; }
  .card { background:#1c1c1e; box-shadow:none; }
  p { color:#a1a1a6; }
  .secondary { background:#2c2c2e; color:#f5f5f5; }
}
</style>
</head>
<body>
<div class="card">
  ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" />` : ''}
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(description)}</p>
  <a class="btn primary" href="${escapeHtml(PLAY_STORE_URL)}">Get ${escapeHtml(config.brand.name)} on Android</a>
  ${APP_STORE_URL ? `<a class="btn secondary" href="${escapeHtml(APP_STORE_URL)}">Get ${escapeHtml(config.brand.name)} on iPhone</a>` : ''}
  <a class="btn secondary" href="${escapeHtml(appUrl)}">Already have the app? Open it</a>
</div>
</body>
</html>`;

/**
 * These pages need inline CSS and remote images, both of which the app-wide
 * `default-src 'self'` policy blocks. Scoped here rather than loosened globally.
 */
const sendPage = (res, html) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'",
    );
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('html').send(html);
};

const notFoundPage = (req, res, what) =>
    sendPage(
        res,
        renderPage({
            title: `This ${what} is unavailable`,
            description:
                `The link may have expired, or the item is no longer being sold. Browse everything else on ${config.brand.name}.`,
            image: '',
            canonical: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
            appUrl: PLAY_STORE_URL,
        }),
    );

/**
 * Digital Asset Links — what makes Android verify the app owns this domain and
 * open shared links directly instead of in a browser.
 *
 * Served from env rather than a checked-in file so the release fingerprint is not
 * committed and staging/production can differ. Comma-separated: an app signed by
 * Play App Signing has both an upload and a distribution certificate, and BOTH
 * must be listed or verification fails for one of the two build paths.
 */
router.get('/.well-known/assetlinks.json', (_req, res) => {
    const fingerprints = String(process.env.ANDROID_SHA256_FINGERPRINTS || '')
        .split(',')
        .map((f) => f.trim().toUpperCase())
        .filter(Boolean);

    if (fingerprints.length === 0) {
        // An empty list would be served as a valid file that verifies nothing,
        // and Android caches it — failing loudly is better than that.
        return res.status(503).json({
            error:
                'ANDROID_SHA256_FINGERPRINTS is not configured. App Links cannot be verified until it is set.',
        });
    }

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('application/json').send(
        JSON.stringify([
            {
                relation: ['delegate_permission/common.handle_all_urls'],
                target: {
                    namespace: 'android_app',
                    package_name:
                        process.env.ANDROID_PACKAGE_NAME || 'com.fooduser.app',
                    sha256_cert_fingerprints: fingerprints,
                },
            },
        ]),
    );
});

router.get('/seller-detail/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return notFoundPage(req, res, 'seller');
        }

        const seller = await Seller.findOne({
            _id: id,
            status: 'approved',
        })
            .select('sellerName profileImage coverImage coverImages area city')
            .lean();

        if (!seller) return notFoundPage(req, res, 'seller');

        const place = [seller.area, seller.city].filter(Boolean).join(', ');

        sendPage(
            res,
            renderPage({
                title: seller.sellerName || 'Seller',
                description: place ||
                    `Shop on ${config.brand.name}.`,
                image: absoluteUrl(
                    req,
                    firstOf(
                        seller.coverImage,
                        seller.coverImages || [],
                        seller.profileImage,
                    ),
                ),
                canonical: `${req.protocol}://${req.get('host')}/seller-detail/${id}`,
                appUrl: `${config.brand.appScheme}://seller-detail/${id}`,
            }),
        );
    } catch (err) {
        next(err);
    }
});

router.get('/product-detail', async (req, res, next) => {
    try {
        const id = String(req.query.id || req.query.productId || '').trim();
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return notFoundPage(req, res, 'product');
        }

        const product = await Product.findOne({ _id: id, approvalStatus: 'approved' })
            .select('name description price image images sellerId')
            .populate('sellerId', 'sellerName')
            .lean();

        if (!product) return notFoundPage(req, res, 'product');

        const sellerName = product.sellerId?.sellerName || '';
        const price = Number(product.price);
        const description = [
            Number.isFinite(price) && price > 0 ? `Rs.${price}` : '',
            sellerName ? `from ${sellerName}` : '',
            product.description || '',
        ]
            .filter(Boolean)
            .join(' · ');

        const sellerId = String(product.sellerId?._id || product.sellerId || '');
        const query = new URLSearchParams({ id, sellerId }).toString();

        sendPage(
            res,
            renderPage({
                title: product.name || 'Product',
                description: description || `Order it on ${config.brand.name}.`,
                image: absoluteUrl(req, firstOf(product.image, product.images || [])),
                canonical: `${req.protocol}://${req.get('host')}/product-detail?${query}`,
                appUrl: `${config.brand.appScheme}://product-detail?${query}`,
            }),
        );
    } catch (err) {
        next(err);
    }
});

export default router;
