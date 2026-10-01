import crypto from 'crypto';

/**
 * The claim-pay-record engine behind every admin refund (Food, Quick, the Shop,
 * Taxi rides). Each vertical supplies where its refund fields live and how to pay;
 * this file owns the rules that keep money from going out twice:
 *
 *  1. CLAIM: one atomic update sets status 'pending', reserves the amount on the
 *     counter and writes a claim { key, at, ... } -- matched against the values
 *     just read, so two refunds started together cannot both spend one headroom.
 *  2. PAY: the vertical's payout, tagged with claim.key (gateway notes/receipt,
 *     wallet row) so the payment can be found again later.
 *  3. RECORD: status 'processed', a history row, the claim removed.
 *
 * A crash between 1 and 3 leaves the claim 'pending'. That must not block the
 * document forever, and must not pay twice either: a claim older than
 * STALE_CLAIM_MS is taken over (atomically, on claim.at), and the payout is then
 * LOOKED FOR by its key before anything else happens. Found: it is recorded as
 * the refund it was. Not found: the reservation is released. Only then does the
 * new refund run, from a clean state.
 */

export const STALE_CLAIM_MS = 10 * 60 * 1000;

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
export const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);

/** An Error the error handlers pass through with this status (4xx text is shown). */
export const refundError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

/**
 * @param {object} o
 * @param {import('mongoose').Model} o.Model
 * @param {*} o.docId
 * @param {{status: string, counter: string, claim: string, history: string}} o.paths
 * @param {number} o.paidPaise                    what was paid, in total
 * @param {(doc) => number|Promise<number>} [o.seedPaise]  already refunded when the counter is unset
 * @param {number|string|null|undefined} o.amount  rupees; empty = everything left
 * @param {object} o.meta                         { method, reason, byAdminId } kept on claim + history
 * @param {(p: {rupees: number, key: string}) => Promise<{refundId?: string}>} o.pay
 * @param {(claim) => Promise<{refundId?: string}|null>} o.findPaid  a payout made under claim.key, or null
 * @param {(doc) => number} [o.othersPaise]     refunded outside this engine and not on the counter
 *   (the Shop's returns), read fresh on every run and counted against the cap
 * @param {(p: {full: boolean, totalPaise: number, refundId: string}) => object} [o.recordSet] extra $set on record
 * @param {(claim) => object} [o.recordInc]      extra $inc on record
 * @param {{service: string, customerId: *, orderId: *}} [o.rewards]  take back the order's cashback
 *   and loyalty points in proportion to each refund recorded (core/promotions/orderRewards.js)
 * @param {object} [o.labels]                     { left: (leftPaise, paidPaise) => string } wording
 * @param {number} [o.now]                        clock, for tests
 * @returns {Promise<{entry, alreadyPaise, totalPaise, full, recovered}>}
 */
export async function runAdminRefund(o) {
  const { Model, docId, paths, paidPaise } = o;
  const now = o.now ?? Date.now();
  let recovered = null;

  let doc = await Model.findById(docId).lean();
  if (!doc) throw refundError('Not found', 404);

  if (get(doc, paths.status) === 'pending') {
    recovered = await recoverStaleClaim(o, doc, now);
    doc = await Model.findById(docId).lean();
  }

  const prevStatus = get(doc, paths.status) || 'none';
  const rawCounter = Number.isFinite(get(doc, paths.counter)) ? get(doc, paths.counter) : null;
  const counterPaise = rawCounter ?? (Number(await o.seedPaise?.(doc)) || 0);
  const alreadyPaise = counterPaise + (Number(o.othersPaise?.(doc)) || 0);
  const leftPaise = paidPaise - alreadyPaise;
  if (leftPaise <= 0) throw refundError('Everything paid has already been refunded', 400);

  const amount = o.amount;
  const wantedPaise = amount === undefined || amount === null || amount === '' ? leftPaise : toPaise(amount);
  if (!(wantedPaise > 0)) throw refundError('Refund amount must be more than zero', 400);
  if (wantedPaise > leftPaise) {
    throw refundError(
      `Refund cannot be more than ₹${(leftPaise / 100).toFixed(2)}, what is left of the ₹${(paidPaise / 100).toFixed(2)} paid`,
      400,
    );
  }

  const totalPaise = alreadyPaise + wantedPaise;
  const key = `rf_${crypto.randomBytes(9).toString('hex')}`;
  const claim = { key, at: new Date(now), amountPaise: wantedPaise, prevStatus, ...o.meta };
  const claimed = await Model.findOneAndUpdate(
    {
      _id: doc._id,
      [paths.status]: prevStatus === 'none' ? { $in: [null, 'none'] } : prevStatus,
      [paths.counter]: rawCounter,
    },
    { $set: { [paths.status]: 'pending', [paths.counter]: counterPaise + wantedPaise, [paths.claim]: claim } },
    { new: true },
  );
  if (!claimed) throw refundError('Another refund is in progress or just finished. Refresh and try again.', 409);

  let refundId = '';
  try {
    ({ refundId = '' } = (await o.pay({ rupees: wantedPaise / 100, key })) || {});
  } catch (err) {
    // Nothing moved: give the reservation back. $inc, not $set -- a counter can be
    // shared (Quick's returns add to it), and a $set would erase their increments.
    await Model.updateOne(
      { _id: doc._id, [`${paths.claim}.key`]: key },
      { $set: { [paths.status]: prevStatus }, $inc: { [paths.counter]: -wantedPaise }, $unset: { [paths.claim]: 1 } },
    );
    throw refundError(`The refund could not be paid (${err?.message || 'payout error'}). Nothing was refunded; try again.`, 424);
  }

  const full = totalPaise >= paidPaise;
  const entry = await record(o, doc._id, claim, { refundId, full, totalPaise });
  return { entry, alreadyPaise, totalPaise, full, recovered };
}

async function record(o, id, claim, { refundId, full, totalPaise }) {
  const { Model, paths } = o;
  const entry = {
    amount: claim.amountPaise / 100,
    method: claim.method || '',
    refundId: String(refundId || ''),
    reason: claim.reason || '',
    byAdminId: claim.byAdminId || '',
    claimKey: claim.key,
    at: new Date(),
  };
  await Model.updateOne(
    { _id: id, [`${paths.claim}.key`]: claim.key },
    {
      $set: { [paths.status]: 'processed', ...(o.recordSet?.({ full, totalPaise, refundId: entry.refundId }) || {}) },
      ...(o.recordInc ? { $inc: o.recordInc(claim) } : {}),
      $unset: { [paths.claim]: 1 },
      $push: { [paths.history]: entry },
    },
  );
  /*
   * The refund's share of the cashback and points goes back with it. Here, not
   * at each caller, because a payout recovered by a takeover is recorded here
   * too. Keyed by the claim, so a record that runs twice takes back once; a
   * full refund takes back whatever is left. Never throws.
   */
  if (o.rewards) {
    const { takeBackForRefund } = await import('../promotions/orderRewards.js');
    await takeBackForRefund({
      ...o.rewards,
      refundedPaise: full ? o.paidPaise : claim.amountPaise,
      paidPaise: o.paidPaise,
      key: `admin_refund:${claim.key}`,
    });
  }
  return entry;
}

/**
 * A claim left 'pending'. Fresh: someone is paying it right now -- refuse. Stale:
 * take it over by moving claim.at (only one taker wins), then find out whether its
 * payout happened before deciding anything.
 */
async function recoverStaleClaim(o, doc, now) {
  const { Model, paths } = o;
  const claim = get(doc, paths.claim);
  const at = claim?.at ? new Date(claim.at).getTime() : 0;
  if (claim?.key && now - at < STALE_CLAIM_MS) {
    throw refundError('A refund is already in progress. Refresh in a moment.', 409);
  }

  const takenOver = await Model.findOneAndUpdate(
    { _id: doc._id, [paths.status]: 'pending', [`${paths.claim}.at`]: claim?.at ?? null },
    { $set: { [`${paths.claim}.at`]: new Date(now) } },
    { new: true },
  );
  if (!takenOver) throw refundError('Another refund is in progress or just finished. Refresh and try again.', 409);

  const counter = Number(get(takenOver, paths.counter)) || 0;
  if (!claim?.key) {
    // A 'pending' with no claim was written by something else (a cancellation
    // refund in flight, or one from before claims). Not ours to settle.
    throw refundError('A refund on this is stuck in progress and needs checking by hand.', 409);
  }

  const paid = await o.findPaid(claim);
  if (paid) {
    const total = counter + (Number(o.othersPaise?.(takenOver)) || 0);
    await record(o, doc._id, claim, { refundId: paid.refundId || '', full: total >= o.paidPaise, totalPaise: total });
    return { claimKey: claim.key, outcome: 'recorded' };
  }
  await Model.updateOne(
    { _id: doc._id, [`${paths.claim}.key`]: claim.key },
    {
      $set: { [paths.status]: claim.prevStatus || 'none' },
      $inc: { [paths.counter]: -(Number(claim.amountPaise) || 0) },
      $unset: { [paths.claim]: 1 },
    },
  );
  return { claimKey: claim.key, outcome: 'released' };
}
