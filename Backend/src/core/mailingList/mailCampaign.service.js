import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { decideAdminAccess } from '../admin/adminAccessPolicy.js';
import { MailSubscriber, MAIL_SOURCES } from './mailSubscriber.model.js';
import { MailCampaign } from './mailCampaign.model.js';

/**
 * Sending the newsletter (Subscribed Mail List > Send newsletter).
 *
 * The admin writes a subject and a plain-text body; it goes to every address
 * still subscribed (optionally only those from one service), each mail with
 * that person's own unsubscribe link. Mail goes out in small batches after
 * the request returns -- a list of thousands would outlive any HTTP timeout --
 * and the campaign row keeps the counts, so the screen can show progress.
 *
 * Each batch is read fresh with status 'subscribed', so someone who
 * unsubscribes while a send is running gets nothing after that.
 *
 * Who may send: "Banners & pages" (cms) write, the permission that already
 * covers broadcast notifications, for every service the send reaches.
 */

const BATCH = 50;
const ADMIN_SERVICE = { food: 'food', quick: 'quickCommerce', shop: 'ecommerce', taxi: 'taxi', services: 'food', other: 'food' };

function assertCanSend(admin, source) {
  const services = source ? [ADMIN_SERVICE[source]] : [...new Set(Object.values(ADMIN_SERVICE))];
  const ok = services.every((service) => decideAdminAccess(admin, { service, resource: 'cms', write: true }).allowed);
  if (!ok) throw new ApiError(403, 'You do not have access to send the newsletter');
}

/*
 * Where the unsubscribe link points: PUBLIC_API_URL (the API's public
 * origin), else the first FRONTEND_URL, which proxies /api on the same origin.
 */
export function unsubscribeUrl(token) {
  const origin = String(process.env.PUBLIC_API_URL || String(process.env.FRONTEND_URL || '').split(',')[0] || '')
    .trim().replace(/\/+$/, '');
  const path = origin.endsWith('/api/v1') ? '' : '/api/v1';
  return `${origin}${path}/platform/mailing-list/unsubscribe?token=${encodeURIComponent(token)}`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderMail({ subject, body }, token) {
  const link = unsubscribeUrl(token);
  const text = `${body}\n\n--\nYou are getting this because you subscribed to our newsletter.\nUnsubscribe: ${link}\n`;
  const html = '<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#222;max-width:560px;margin:0 auto;padding:20px">'
    + `<div>${escapeHtml(body).replace(/\r?\n/g, '<br>')}</div>`
    + '<hr style="border:none;border-top:1px solid #eee;margin:24px 0">'
    + '<p style="color:#888;font-size:12px">You are getting this because you subscribed to our newsletter. '
    + `<a href="${escapeHtml(link)}">Unsubscribe</a></p></body></html>`;
  return {
    subject,
    text,
    html,
    // Lets mail apps show their own unsubscribe button.
    headers: { 'List-Unsubscribe': `<${link}>` },
  };
}

const defaultSend = async (mail) => (await import('../../utils/email.js')).sendMail(mail);

/** Send one campaign, batch by batch, updating its counts as it goes. */
export async function runCampaign(campaignId, { send = defaultSend } = {}) {
  const campaign = await MailCampaign.findById(campaignId).lean();
  if (!campaign) return null;
  const filter = { status: 'subscribed', ...(campaign.source ? { sources: campaign.source } : {}) };
  let lastId = null;
  let sent = 0;
  let failed = 0;
  try {
    for (;;) {
      const batch = await MailSubscriber.find(lastId ? { ...filter, _id: { $gt: lastId } } : filter)
        .sort({ _id: 1 }).limit(BATCH).select('email unsubscribeToken').lean();
      if (!batch.length) break;
      const results = await Promise.all(batch.map((s) => send({ to: s.email, ...renderMail(campaign, s.unsubscribeToken) }).catch(() => false)));
      const ok = results.filter(Boolean).length;
      sent += ok;
      failed += results.length - ok;
      lastId = batch[batch.length - 1]._id;
      await MailCampaign.updateOne({ _id: campaign._id }, { $set: { sent, failed } });
    }
    const status = sent === 0 && failed > 0 ? 'failed' : 'sent';
    await MailCampaign.updateOne({ _id: campaign._id }, { $set: { sent, failed, status, finishedAt: new Date() } });
  } catch (err) {
    logger.error(`Newsletter ${campaign._id} stopped: ${err.message}`);
    await MailCampaign.updateOne({ _id: campaign._id }, { $set: { sent, failed, status: 'failed', finishedAt: new Date() } });
  }
  return MailCampaign.findById(campaign._id).lean();
}

/**
 * Start a send. Returns the campaign at once; mail goes out after. `wait`
 * and `send` are for tests (await the run, and a stub mailer).
 */
export async function startCampaign(admin, body = {}, { wait = false, send } = {}) {
  const source = String(body.source || '').trim();
  if (source && !MAIL_SOURCES.includes(source)) throw new ApiError(400, 'Unknown source');
  assertCanSend(admin, source);
  const subject = String(body.subject ?? '').trim().slice(0, 200);
  const text = String(body.body ?? '').trim().slice(0, 20000);
  if (!subject) throw new ApiError(400, 'Write a subject');
  if (!text) throw new ApiError(400, 'Write the message');
  if (!send) {
    const { isEmailConfigured } = await import('../../utils/email.js');
    if (!isEmailConfigured()) throw new ApiError(400, 'Email is not set up. Add SMTP details in Master settings first.');
  }
  // One send at a time. A send older than six hours is taken as stopped (a
  // restart mid-send), so it cannot block the newsletter for good.
  const running = await MailCampaign.exists({ status: 'sending', startedAt: { $gt: new Date(Date.now() - 6 * 3600 * 1000) } });
  if (running) throw new ApiError(409, 'A newsletter is still being sent. Wait for it to finish.');

  const total = await MailSubscriber.countDocuments({ status: 'subscribed', ...(source ? { sources: source } : {}) });
  if (!total) throw new ApiError(400, 'Nobody to send to');
  const campaign = await MailCampaign.create({ subject, body: text, source, total, createdBy: admin?._id || null });
  const run = runCampaign(campaign._id, send ? { send } : {});
  if (wait) return run;
  run.catch(() => {});
  return campaign.toObject();
}

export async function listCampaigns(admin) {
  // Reading the history needs only read access to the list itself.
  const ok = Object.values(ADMIN_SERVICE).some((service) => decideAdminAccess(admin, { service, resource: 'cms' }).allowed);
  if (!ok) throw new ApiError(403, 'You do not have access to the newsletter');
  const items = await MailCampaign.find({}).sort({ createdAt: -1 }).limit(50).select('-body').lean();
  return { items: items.map((c) => ({ ...c, id: String(c._id) })) };
}
