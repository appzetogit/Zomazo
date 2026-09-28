import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { linkedIds } from '../orders/myOrders.service.js';
import { isModuleEnabled } from '../modules/moduleState.service.js';
import { MODULES } from '../modules/moduleRegistry.js';

/**
 * The super app's help centre, for the customer.
 *
 * One screen raises a ticket about anything the customer has -- a food or
 * grocery order, a ride, a home-service booking, a Shop order -- or about
 * their account. Each ticket is filed with the service that owns it, in that
 * service's own ticket collection, so the service's admins answer it where
 * they always have and it appears in Master > Help & Support
 * (core/support/supportInbox.service.js) like any other:
 *
 *   food, other      food_support_tickets (the platform account)
 *   quick, medical   qc_support_tickets   (the customer's qc_users row)
 *   taxi, parcel,    Taxi's support tickets, through Taxi's own create handler
 *     rental
 *   shop             ecom_support_tickets (the customer's ecom_users row)
 *   services         Services has no ticket desk, so food_support_tickets,
 *                    tagged service 'services' with the booking number
 *
 * The order is looked up under the customer's own ids before anything is
 * filed: a ticket can only be about the customer's own order.
 */

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
const coll = (name) => mongoose.connection.collection(name);
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

export const HELP_SERVICES = ['food', 'quick', 'medical', 'taxi', 'parcel', 'rental', 'services', 'shop', 'other'];

const LABEL = {
  food: 'Food',
  quick: 'Quick',
  medical: 'Medical',
  taxi: 'Rides',
  parcel: 'Parcel',
  rental: 'Rental',
  services: 'Services',
  shop: 'Shop',
  other: 'Account & app',
};

const foodTicket = async () => (await import('../../modules/food/user/models/supportTicket.model.js')).FoodSupportTicket;
const quickTicket = async () =>
  (await import('../../modules/quickCommerce/modules/food/user/models/supportTicket.model.js')).FoodSupportTicket;
const shopTicket = async () => (await import('../../modules/ecommerce/modules/commerce/user/models/supportTicket.model.js')).SupportTicket;
const taxiTicket = async () => (await import('../../modules/taxi/support/models/SupportTicket.js')).SupportTicket;

async function me(userId) {
  const doc = await coll('users').findOne({ _id: oid(userId) }, { projection: { phone: 1, isActive: 1 } });
  if (!doc) throw new ApiError(404, 'Account not found');
  return doc;
}

/** The customer's own order in a service that keys orders by its own customer rows. */
async function ownOrder({ users, orders, userId, phone, orderId }) {
  const ids = await linkedIds(users, userId, phone);
  if (!ids.length) return null;
  return coll(orders).findOne({ _id: oid(orderId), userId: { $in: ids } }, { projection: { userId: 1, order_id: 1, orderId: 1 } });
}

const orderNumber = (o) => o?.order_id || (typeof o?.orderId === 'string' ? o.orderId : '') || String(o?._id || '').slice(-6).toUpperCase();

/**
 * Raise a ticket.
 *
 * @param {string} userId  the signed-in customer's platform id
 * @param {{ service: string, orderId?: string, issueType: string, description?: string }} body
 * @returns {Promise<object>} the ticket, in the help centre's shape
 */
export async function createCustomerTicket(userId, body = {}) {
  const service = String(body.service || '').trim().toLowerCase();
  if (!HELP_SERVICES.includes(service)) throw new ApiError(400, 'Choose what the ticket is about');
  const issueType = clip(body.issueType, 120);
  if (!issueType) throw new ApiError(400, 'Choose the issue');
  const description = clip(body.description, 2000);
  const orderId = String(body.orderId || '').trim();
  const needsOrder = service !== 'other';
  if (needsOrder && !isId(orderId)) throw new ApiError(400, 'Choose the order, ride or booking this is about');

  const { phone } = await me(userId);
  const notYours = () => new ApiError(404, 'That order is not on your account');

  if (service === 'other') {
    const Ticket = await foodTicket();
    const doc = await Ticket.create({ userId: oid(userId), type: 'other', issueType, description });
    return toRow('food', doc.toObject());
  }

  if (service === 'food') {
    const order = await coll('food_orders').findOne({ _id: oid(orderId), userId: oid(userId) }, { projection: { _id: 1 } });
    if (!order) throw notYours();
    const Ticket = await foodTicket();
    const doc = await Ticket.create({ userId: oid(userId), type: 'order', orderId: order._id, issueType, description });
    return toRow('food', doc.toObject());
  }

  if (service === 'quick' || service === 'medical') {
    const order = await ownOrder({ users: 'qc_users', orders: 'qc_orders', userId, phone, orderId });
    if (!order) throw notYours();
    const Ticket = await quickTicket();
    const doc = await Ticket.create({ userId: order.userId, type: 'order', orderId: order._id, issueType, description });
    return toRow('quick', doc.toObject());
  }

  if (service === 'shop') {
    if (!(await isModuleEnabled(MODULES.ECOMMERCE))) throw new ApiError(400, 'The Shop is not available right now');
    const order = await ownOrder({ users: 'ecom_users', orders: 'ecom_orders', userId, phone, orderId });
    if (!order) throw notYours();
    const Ticket = await shopTicket();
    const doc = await Ticket.create({ userId: order.userId, type: 'order', orderId: order._id, issueType, description });
    return toRow('shop', doc.toObject());
  }

  if (service === 'services') {
    const ids = await linkedIds('sp_users', userId, phone);
    const booking = ids.length
      ? await coll('sp_bookings').findOne({ _id: oid(orderId), userId: { $in: ids } }, { projection: { bookingNumber: 1 } })
      : null;
    if (!booking) throw notYours();
    const Ticket = await foodTicket();
    const doc = await Ticket.create({
      userId: oid(userId),
      type: 'other',
      service: 'services',
      orderRef: booking.bookingNumber || String(booking._id),
      issueType,
      description,
    });
    return toRow('food', doc.toObject());
  }

  // Rides, parcels and rentals: filed through Taxi's own handler, so the ticket
  // is exactly what the Taxi app would have raised.
  const ride = await coll('taxirides').findOne({ _id: oid(orderId), userId: oid(userId) }, { projection: { _id: 1 } });
  if (!ride) throw notYours();
  const { createSupportTicket } = await import('../../modules/taxi/support/controllers/supportController.js');
  let created = null;
  await createSupportTicket(
    {
      auth: { role: 'user', sub: String(userId) },
      body: {
        title: clip(`${issueType} · ${LABEL[service]} #${String(ride._id).slice(-6).toUpperCase()}`, 140),
        message: description || issueType,
      },
    },
    { status() { return this; }, json(payload) { created = payload?.data; } },
  );
  const Ticket = await taxiTicket();
  const doc = created?.id ? await Ticket.findById(created.id).lean() : null;
  if (!doc) throw new ApiError(500, 'Could not raise the ticket. Please try again.');
  return toRow('taxi', doc);
}

/* ---------------------------------------------------------------- reading */

const STATUS = {
  open: 'open',
  pending: 'open',
  'in-progress': 'in_progress',
  in_progress: 'in_progress',
  assigned: 'in_progress',
  resolved: 'resolved',
  closed: 'resolved',
};

function toRow(source, doc) {
  const taxi = source === 'taxi';
  const messages = taxi ? doc.messages || [] : [];
  const lastAdmin = [...messages].reverse().find((m) => m.senderRole === 'admin');
  let service = source;
  if (source === 'food') service = doc.service || (doc.type === 'order' ? 'food' : 'other');
  if (taxi) service = 'taxi';
  return {
    key: `${source}:${doc._id}`,
    id: String(doc._id),
    service,
    serviceLabel: LABEL[service] || LABEL.other,
    code: doc.ticketCode || doc.ticketId || String(doc._id).slice(-6).toUpperCase(),
    subject: doc.issueType || doc.title || 'Support request',
    description: doc.description || messages[0]?.message || '',
    orderRef: doc.orderRef || (doc.orderId ? String(doc.orderId).slice(-6).toUpperCase() : ''),
    status: STATUS[String(doc.status || '')] || 'open',
    reply: taxi ? lastAdmin?.message || '' : doc.adminResponse || '',
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || doc.lastMessageAt || doc.createdAt || null,
  };
}

/** Every ticket the customer has raised, with any service, newest activity first. */
export async function listCustomerTickets(userId) {
  const { phone } = await me(userId);
  const shopOn = await isModuleEnabled(MODULES.ECOMMERCE);
  const [qcIds, shopIds] = await Promise.all([
    linkedIds('qc_users', userId, phone),
    shopOn ? linkedIds('ecom_users', userId, phone) : [],
  ]);
  const [Food, Quick, Shop, Taxi] = await Promise.all([foodTicket(), quickTicket(), shopOn ? shopTicket() : null, taxiTicket()]);
  const LIMIT = 100;
  const lists = await Promise.all([
    Food.find({ userId: oid(userId) }).sort({ updatedAt: -1 }).limit(LIMIT).lean().then((r) => r.map((d) => toRow('food', d))),
    qcIds.length
      ? Quick.find({ userId: { $in: qcIds } }).sort({ updatedAt: -1 }).limit(LIMIT).lean().then((r) => r.map((d) => toRow('quick', d)))
      : [],
    Shop && shopIds.length
      ? Shop.find({ userId: { $in: shopIds } }).sort({ updatedAt: -1 }).limit(LIMIT).lean().then((r) => r.map((d) => toRow('shop', d)))
      : [],
    Taxi.find({ requesterRole: 'user', requesterId: oid(userId) }).sort({ updatedAt: -1 }).limit(LIMIT).lean()
      .then((r) => r.map((d) => toRow('taxi', d))),
  ]);
  return lists.flat().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, LIMIT);
}

export const __testables = { toRow };
