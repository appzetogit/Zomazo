import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';

/**
 * The conversation on a Food, Quick or Shop support ticket.
 *
 * Those tickets were built with one `adminResponse` field, so a second reply
 * overwrote the first. Taxi tickets already keep every message on the ticket.
 * Rather than change seven ticket models in three services, each message is a
 * row here, keyed by the inbox source (supportInbox.service.js) and ticket id.
 * The services still get `adminResponse` set to the latest reply, so their own
 * screens and notifications behave as before.
 *
 * Old tickets: an `adminResponse` written before this existed is shown as the
 * first admin message, and copied in as one the first time anyone adds to the
 * thread -- so it keeps its place and is not shown twice afterwards.
 */

const messageSchema = new mongoose.Schema(
  {
    source: { type: String, required: true },
    ticketId: { type: mongoose.Schema.Types.ObjectId, required: true },
    from: { type: String, enum: ['requester', 'admin'], required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    authorName: { type: String, default: '' },
    message: { type: String, required: true, maxlength: 4000 },
    at: { type: Date, default: Date.now },
    // The old single answer, copied in.
    legacy: { type: Boolean, default: false },
  },
  { collection: 'platform_support_messages', versionKey: false },
);
messageSchema.index({ source: 1, ticketId: 1, at: 1, _id: 1 });

export const SupportMessage = mongoose.models.SupportMessage || mongoose.model('SupportMessage', messageSchema);

const shape = (m) => ({ from: m.from, name: m.authorName || '', message: m.message, at: m.at || null });

/**
 * The whole conversation, oldest first: the request itself, then every
 * message. `ticket` is the ticket document (lean).
 */
export async function threadFor(source, ticket) {
  const rows = await SupportMessage.find({ source, ticketId: ticket._id }).sort({ at: 1, _id: 1 }).lean();
  const out = [{ from: 'requester', name: '', message: ticket.description || ticket.issueType || ticket.subject || '', at: ticket.createdAt || null }];
  if (!rows.length && ticket.adminResponse) {
    out.push({ from: 'admin', name: '', message: ticket.adminResponse, at: ticket.updatedAt || null });
  }
  return out.concat(rows.map(shape));
}

/**
 * An admin answered a ticket: called by each service's own update function
 * (Food, Quick, Shop admin services) before it overwrites adminResponse, so
 * the conversation is complete whether the answer came from that service's
 * screen, Help & Support or Chattings -- all of which go through it.
 *
 * Sending the current answer again (a status change from a form that posts
 * the whole ticket) is not a new message. Never throws: the answer itself must
 * still be saved and sent if the thread cannot be written.
 */
export async function recordAdminReply(source, Model, id, reply, author = {}) {
  const message = typeof reply === 'string' ? reply.trim() : '';
  if (!message || !mongoose.Types.ObjectId.isValid(String(id || ''))) return;
  try {
    const before = await Model.findById(id).lean();
    if (!before || String(before.adminResponse || '').trim() === message) return;
    await appendMessage(source, before, { from: 'admin', message, authorId: author.id || null, authorName: author.name || '' });
  } catch (err) {
    logger.error(`Support thread not updated for ${source}:${id}: ${err.message}`);
  }
}

/** Add one message, first keeping any old single answer in its place. */
export async function appendMessage(source, ticket, { from, message, authorId = null, authorName = '' }) {
  const ticketId = ticket._id;
  const hasRows = await SupportMessage.exists({ source, ticketId });
  if (!hasRows && ticket.adminResponse) {
    await SupportMessage.create({
      source, ticketId, from: 'admin', message: ticket.adminResponse, at: ticket.updatedAt || ticket.createdAt || new Date(), legacy: true,
    });
  }
  await SupportMessage.create({ source, ticketId, from, message, authorId, authorName, at: new Date() });
}
