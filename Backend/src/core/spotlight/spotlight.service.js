import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { decideAdminAccess } from '../admin/adminAccessPolicy.js';
import { saveImageFile } from '../../services/storage.service.js';
import { SpotlightAd, SPOTLIGHT_SERVICES, SPOTLIGHT_KINDS } from './spotlightAd.model.js';

/**
 * Partner ads ("spotlights") for Food, Quick and the Shop.
 *
 * A restaurant, Quick store or Shop seller asks for one from their panel; an
 * admin of that service approves or rejects it (Advertisement > Ad Requests)
 * and can pause, resume or edit it afterwards (Ads List). What customers see:
 *
 *   banner   an approved banner inside its dates is added to that service's
 *            home promotion strip -- the same public read the app already
 *            calls (each service's getPublicHomePromotionBanners).
 *   listing  an approved listing inside its dates is returned by
 *            GET /v1/platform/spotlight/promoted?service=..., the ids a list
 *            screen can pin to the top and mark "Promoted".
 *
 * Who may act: the service's "Offers & coupons" permission (promotions),
 * read to see, write to decide.
 */

const PARTNERS = {
  food: { collection: 'food_restaurants', name: (d) => d.restaurantName, adminService: 'food' },
  quick: { collection: 'qc_restaurants', name: (d) => d.restaurantName, adminService: 'quickCommerce' },
  shop: { collection: 'ecom_sellers', name: (d) => d.sellerName, adminService: 'ecommerce' },
};

// A partner cannot queue more than this many undecided requests, so one
// account cannot flood the admin's review list.
const MAX_PENDING_PER_PARTNER = 10;
const MAX_DAYS = 366;

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/** Shown state: the admin's decision, then the dates for approved ones. */
export function stateOf(doc, now = new Date()) {
  if (doc.status !== 'approved') return doc.status;
  if (new Date(doc.startDate) > now) return 'scheduled';
  if (new Date(doc.endDate) < now) return 'expired';
  return 'running';
}

const toItem = (doc, now = new Date()) => ({
  id: String(doc._id),
  service: doc.service,
  partnerId: String(doc.partnerId),
  partnerName: doc.partnerName || '',
  kind: doc.kind,
  title: doc.title,
  description: doc.description || '',
  imageUrl: doc.imageUrl || '',
  ctaLink: doc.ctaLink || '',
  startDate: doc.startDate,
  endDate: doc.endDate,
  budgetNote: doc.budgetNote || '',
  status: doc.status,
  state: stateOf(doc, now),
  rejectionReason: doc.rejectionReason || '',
  reviewedAt: doc.reviewedAt || null,
  createdAt: doc.createdAt || null,
});

/* The link a banner opens: an in-app path or an https URL, nothing else. */
function cleanLink(v) {
  const link = clip(v, 500);
  if (!link) return '';
  if (link.startsWith('/') && !link.startsWith('//')) return link;
  if (/^https:\/\/[^\s]+$/i.test(link)) return link;
  throw new ApiError(400, 'The link must be an app path like /food/... or an https:// address');
}

function parseDates(startIn, endIn, { allowPast = false } = {}) {
  const start = new Date(startIn);
  const end = new Date(endIn);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new ApiError(400, 'Pick a start and an end date');
  if (end <= start) throw new ApiError(400, 'The end date must be after the start date');
  if (!allowPast && end < new Date()) throw new ApiError(400, 'The end date has already passed');
  if (end - start > MAX_DAYS * 24 * 3600 * 1000) throw new ApiError(400, `An ad can run for at most ${MAX_DAYS} days`);
  return { startDate: start, endDate: end };
}

/* ------------------------------------------------------------- partners */

async function partnerOf(service, partnerId) {
  const def = PARTNERS[service];
  if (!def || !isId(partnerId)) throw new ApiError(403, 'Business not found');
  const doc = await mongoose.connection.collection(def.collection)
    .findOne({ _id: new mongoose.Types.ObjectId(String(partnerId)) }, { projection: { restaurantName: 1, sellerName: 1 } });
  if (!doc) throw new ApiError(403, 'Business not found');
  return { _id: doc._id, name: String(def.name(doc) || '').trim() };
}

/**
 * A partner asks for an ad. `file` is the uploaded banner image (multer),
 * stored by the platform's upload service; a banner needs one.
 */
export async function createRequest(service, partnerId, body = {}, file = null) {
  const partner = await partnerOf(service, partnerId);
  const kind = String(body.kind || '').trim();
  if (!SPOTLIGHT_KINDS.includes(kind)) throw new ApiError(400, 'Pick a banner or a promoted listing');
  const title = clip(body.title, 120);
  if (!title) throw new ApiError(400, 'Give the ad a title');
  const dates = parseDates(body.startDate, body.endDate);
  const ctaLink = cleanLink(body.ctaLink);
  if (kind === 'banner' && !file) throw new ApiError(400, 'A banner needs an image');

  const pending = await SpotlightAd.countDocuments({ service, partnerId: partner._id, status: 'pending' });
  if (pending >= MAX_PENDING_PER_PARTNER) {
    throw new ApiError(429, 'You already have several requests waiting. Wait for a decision before sending more.');
  }

  const imageUrl = file ? (await saveImageFile(file, `spotlight/${service}`)).url : '';
  const doc = await SpotlightAd.create({
    service,
    partnerId: partner._id,
    partnerName: partner.name,
    kind,
    title,
    description: clip(body.description, 500),
    imageUrl,
    ctaLink,
    ...dates,
    budgetNote: clip(body.budgetNote, 200),
  });
  return toItem(doc.toObject());
}

export async function listOwn(service, partnerId) {
  const partner = await partnerOf(service, partnerId);
  const docs = await SpotlightAd.find({ service, partnerId: partner._id }).sort({ createdAt: -1 }).limit(200).lean();
  const now = new Date();
  return docs.map((d) => toItem(d, now));
}

/** A partner withdraws a request nobody has decided on yet. */
export async function withdrawOwn(service, partnerId, id) {
  const partner = await partnerOf(service, partnerId);
  if (!isId(id)) throw new ApiError(404, 'Request not found');
  const res = await SpotlightAd.deleteOne({ _id: id, service, partnerId: partner._id, status: 'pending' });
  if (!res.deletedCount) throw new ApiError(404, 'Only a request still waiting for review can be withdrawn');
  return { id: String(id) };
}

/* ---------------------------------------------------------------- admin */

const canSee = (admin, service, write = false) =>
  decideAdminAccess(admin, { service: PARTNERS[service].adminService, resource: 'promotions', write }).allowed;

function assertService(admin, service, write = false) {
  if (!SPOTLIGHT_SERVICES.includes(service)) throw new ApiError(400, 'Unknown service');
  if (!canSee(admin, service, write)) {
    throw new ApiError(403, write ? 'You can view these ads but not change them' : 'You do not have access to these ads');
  }
}

/**
 * Ads for one service. `view=requests` is the review queue (pending and
 * rejected); otherwise the approved ones, filterable by shown state.
 */
export async function adminList(admin, query = {}) {
  const service = String(query.service || '').trim();
  assertService(admin, service);
  const filter = { service };
  const requests = query.view === 'requests';
  filter.status = requests ? { $in: ['pending', 'rejected'] } : { $in: ['approved', 'paused'] };
  if (requests && ['pending', 'rejected'].includes(query.status)) filter.status = query.status;
  if (SPOTLIGHT_KINDS.includes(query.kind)) filter.kind = query.kind;
  const q = clip(query.q, 80);
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    filter.$or = [{ title: rx }, { partnerName: rx }];
  }
  const now = new Date();
  let items = (await SpotlightAd.find(filter).sort({ createdAt: -1 }).limit(500).lean()).map((d) => toItem(d, now));
  const state = String(query.state || '');
  if (!requests && ['running', 'scheduled', 'expired', 'paused'].includes(state)) items = items.filter((i) => i.state === state);
  return { items };
}

async function loadFor(admin, id, write) {
  if (!isId(id)) throw new ApiError(404, 'Ad not found');
  const doc = await SpotlightAd.findById(id);
  if (!doc) throw new ApiError(404, 'Ad not found');
  assertService(admin, doc.service, write);
  return doc;
}

/** Approve or reject a request. Rejecting needs a reason the partner will see. */
export async function adminReview(admin, id, body = {}) {
  const doc = await loadFor(admin, id, true);
  if (doc.status !== 'pending') throw new ApiError(409, 'This request has already been decided');
  const decision = String(body.decision || '');
  if (decision === 'approve') {
    doc.status = 'approved';
    doc.rejectionReason = '';
  } else if (decision === 'reject') {
    const reason = clip(body.reason, 500);
    if (!reason) throw new ApiError(400, 'Say why the request is rejected');
    doc.status = 'rejected';
    doc.rejectionReason = reason;
  } else {
    throw new ApiError(400, 'Approve or reject');
  }
  doc.reviewedBy = admin?._id || null;
  doc.reviewedAt = new Date();
  await doc.save();
  return toItem(doc.toObject());
}

/** Pause or resume an approved ad, or change its title, link or dates. */
export async function adminUpdate(admin, id, body = {}) {
  const doc = await loadFor(admin, id, true);
  if (!['approved', 'paused'].includes(doc.status)) throw new ApiError(409, 'Decide the request before changing it');
  if (body.paused !== undefined) {
    if (typeof body.paused !== 'boolean') throw new ApiError(400, 'Say whether the ad should be paused');
    doc.status = body.paused ? 'paused' : 'approved';
  }
  if (body.title !== undefined) {
    const title = clip(body.title, 120);
    if (!title) throw new ApiError(400, 'Give the ad a title');
    doc.title = title;
  }
  if (body.ctaLink !== undefined) doc.ctaLink = cleanLink(body.ctaLink);
  if (body.budgetNote !== undefined) doc.budgetNote = clip(body.budgetNote, 200);
  if (body.startDate !== undefined || body.endDate !== undefined) {
    Object.assign(doc, parseDates(body.startDate ?? doc.startDate, body.endDate ?? doc.endDate, { allowPast: true }));
  }
  await doc.save();
  return toItem(doc.toObject());
}

/* --------------------------------------------------------------- public */

const runningFilter = (service, kind, now = new Date()) => ({
  service, kind, status: 'approved', startDate: { $lte: now }, endDate: { $gte: now },
});

/**
 * Running banner ads for a service, shaped like that service's home promotion
 * banners so the app shows them in the same strip. Never throws: a broken ad
 * must not take the service's own banners down with it.
 */
export async function runningBanners(service) {
  try {
    const docs = await SpotlightAd.find(runningFilter(service, 'banner')).sort({ startDate: 1 }).limit(10).lean();
    return docs.filter((d) => d.imageUrl).map((d) => ({
      _id: d._id,
      imageUrl: d.imageUrl,
      title: d.title,
      ctaLink: d.ctaLink || '',
      isActive: true,
      isSponsored: true,
      sortOrder: 9999,
    }));
  } catch {
    return [];
  }
}

/** The businesses with a running promoted listing in a service. */
export async function promotedPartners(service) {
  if (!SPOTLIGHT_SERVICES.includes(service)) throw new ApiError(400, 'Unknown service');
  const docs = await SpotlightAd.find(runningFilter(service, 'listing')).sort({ startDate: 1 }).limit(50).lean();
  const seen = new Set();
  const items = [];
  for (const d of docs) {
    const id = String(d.partnerId);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ partnerId: id, title: d.title, endDate: d.endDate });
  }
  return { items };
}
