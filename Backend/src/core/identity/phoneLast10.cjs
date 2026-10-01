/**
 * Phone lookups by an indexed "last 10 digits" field.
 *
 * Sign-in used to find a partner, seller, rider or customer with a suffix regex
 * on the raw phone ('9876543210$'), because rows hold the number as typed:
 * '+91 98765 43210', '919876543210', '9876543210'. A regex like that cannot use
 * an index, so every sign-in read the whole collection.
 *
 *   phoneLast10Plugin(schema, { pairs: [['phone', 'phoneLast10']] })
 *
 * keeps `phoneLast10` = the last ten digits of `phone` on save, insertMany and
 * every mongoose update that sets `phone`, and indexes it.
 *
 *   byLast10(phone, [['phone', 'phoneLast10']])
 *
 * is the filter to find a row by it. Each pair contributes two branches:
 *   { phoneLast10: '9876543210' }                     -- the normal, indexed hit
 *   { phoneLast10: null, phone: /9876543210$/ }       -- rows written before the
 *                                                        field existed
 * The second branch walks the same index, but only its null part, so it reads
 * only rows the backfill has not stamped yet. Once
 * scripts/migrations/backfillPhoneLast10.mjs --apply has run there are none, and
 * the fallback costs nothing without anyone having to remember to remove it.
 *
 * CommonJS so the Services models (CommonJS) can use it like the ESM ones.
 * Writes made with the raw driver bypass the hooks; stamp those by hand
 * (see toLast10) or the row is only found through the fallback.
 */

const toLast10 = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.slice(-10) : undefined;
};

// Every regex built from caller input goes through this.
const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} phone
 * @param {Array<[string, string]>} pairs  [rawField, last10Field]
 * @returns {object|null}  a filter, or null when the phone has no digits
 */
const byLast10 = (phone, pairs) => {
  const ten = toLast10(phone);
  if (!ten) return null;
  // Any separators between the digits ('+91 98765 43210'), as the fallback must
  // find what the stamped field would have.
  const suffix = `${ten.split('').map(escapeRegex).join('\\D*')}\\D*$`;
  const or = [];
  for (const [raw, last10] of pairs) {
    or.push({ [last10]: ten });
    or.push({ [last10]: null, [raw]: { $regex: suffix } });
  }
  return { $or: or };
};

/**
 * @param {import('mongoose').Schema} schema
 * @param {{ pairs: Array<[string, string, {blank?: string}?]> }} opts
 *        blank: what to store when the raw field has no digits. Leave it unset for
 *        fields under a partial unique index on { $type: 'string' } (restaurant and
 *        seller ownerPhoneLast10), so phone-less rows do not collide.
 */
function phoneLast10Plugin(schema, { pairs }) {
  for (const [, last10] of pairs) {
    if (!schema.path(last10)) schema.add({ [last10]: { type: String } });
    schema.index({ [last10]: 1 });
  }
  const valueFor = (raw, opts) => {
    const ten = toLast10(raw);
    if (ten) return ten;
    return opts && opts.blank !== undefined ? opts.blank : undefined;
  };

  schema.pre('save', function stampPhoneLast10() {
    for (const [raw, last10, opts] of pairs) {
      if (this.isNew || this.isModified(raw) || this.get(last10) == null) {
        this.set(last10, valueFor(this.get(raw), opts));
      }
    }
  });

  schema.pre('insertMany', function stampPhoneLast10Many(next, docs) {
    for (const doc of Array.isArray(docs) ? docs : [docs]) {
      if (!doc) continue;
      for (const [raw, last10, opts] of pairs) {
        const value = typeof doc.get === 'function' ? doc.get(raw) : doc[raw];
        const ten = valueFor(value, opts);
        if (typeof doc.set === 'function') doc.set(last10, ten);
        else doc[last10] = ten;
      }
    }
    next();
  });

  const stampUpdate = function stampPhoneLast10Update() {
    const update = this.getUpdate();
    if (!update || Array.isArray(update)) return;
    for (const [raw, last10, opts] of pairs) {
      for (const op of ['$set', '$setOnInsert']) {
        if (update[op] && Object.prototype.hasOwnProperty.call(update[op], raw)) {
          update[op][last10] = valueFor(update[op][raw], opts);
        }
      }
      if (Object.prototype.hasOwnProperty.call(update, raw)) {
        update[last10] = valueFor(update[raw], opts);
      }
      if (update.$unset && Object.prototype.hasOwnProperty.call(update.$unset, raw)) {
        update.$unset[last10] = '';
      }
    }
    this.setUpdate(update);
  };
  schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany', 'replaceOne'], stampUpdate);
}

module.exports = { toLast10, escapeRegex, byLast10, phoneLast10Plugin };
