# Collapsing this fork — what to check before deleting a file

`modules/quickCommerce` is a source fork of `modules/food` plus a fork of `core/`.
Removing it is worth doing, and most of it is mechanical. This file records the
three things that are **not** mechanical, each of which was found by nearly getting
it wrong.

---

## 1. Identical text does not mean identical behaviour

Four files in `core/payments` are **byte-for-byte identical** to master's and still
do completely different things:

```
core/payments/transaction.service.js
    import { FoodUserWallet } from '../../modules/food/user/models/userWallet.model.js';
        resolves to  src/modules/food/user/models/userWallet.model.js

modules/quickCommerce/core/payments/transaction.service.js
    SAME LINE
        resolves to  src/modules/quickCommerce/modules/food/user/models/userWallet.model.js
```

The fork works because it sits at a directory depth where every relative import
lands on its own copy. So:

> **A file being identical to master's is not a reason to delete it. It is a reason
> to check what it binds to.**

Deleting one of these and repointing its importers at master's copy would silently
redirect every wallet write to the other vertical's collection. Nothing would
throw. The money would just go somewhere else.

Collapsing these needs the models passed in rather than imported by path. That is
a real refactor of a money path, and it is deliberately **not** done yet:
`recordTransaction` only runs under BullMQ (currently off) and is scheduled to be
replaced by `core/finance/ledger.service.js`. Refactoring an untestable money path
that is already slated for removal is poor value for the risk.

---

## 2. Check the collection before repointing an import

| what | master | this fork | safe to merge? |
|---|---|---|---|
| OTP | `food_otps` | was `qc_otps` | **yes** — collapsed; OTPs live ~5 min, so the only cost was in-flight logins at deploy |
| refresh tokens | `food_refresh_tokens` | `qc_refresh_tokens` | **no** — holds every live session; merging logs everyone out |
| notifications | `food_notifications` | same | already shared |
| broadcasts | `food_notification_broadcasts` | `qc_broadcast_notifications` | not yet — plus a TTL index master lacks |
| payments | `payments` | same | already shared |
| refunds / settlements / transactions | shared names | `qc_*` | no — needs a migration |
| users | `users` | `qc_users` | no — identity merge, blocked on the dry-run |
| admins | `admins` | `qc_admins` | no — and the permission *shapes* differ |

The rule that falls out: **share the code, keep the collection**, until a migration
is a deliberate decision with a chosen moment. `core/refreshTokens/refreshToken.model.js`
shows the shape — one schema, two model registrations.

---

## 3. Find importers by FILENAME, not by path prefix

```bash
# WRONG — misses './notification.controller.js' and '../refreshTokens/...'
grep -rn "core/notifications/notification.controller" --include=*.js modules/quickCommerce

# RIGHT
grep -rnE "from ['\"][^'\"]*notification\.controller" --include=*.js modules/quickCommerce
```

The wrong form reported **zero importers** for a file that was very much in use.
The same mistake cost an import in the OTP collapse. Both times the thing that
caught it was:

```bash
node -e "process.env.NODE_ENV='test'; import('./src/app.js').then(()=>console.log('ok'))"
```

Run that after every collapse. It loads the whole route tree, so a broken import
fails immediately instead of at the first request to that endpoint.

---

## 4. Which direction has the fork drifted?

Not always the direction you expect. Check before assuming master is newer.

| module | drift |
|---|---|
| `core/otp` | **master ahead** — the fork was missing the rate limiter, phone normalisation and the DLT template. Collapsing was a security fix. |
| `core/notifications` | **fork ahead** — it had a mark-all-read endpoint food did not. Collapsing meant porting the feature *into* master first. |
| `notifications/firebase.service.js` | **fork ahead**, 788 lines against 629, four extra exports. A merge project, not a step. |
| `core/payments/wallet.service.js` | **master ahead** — a customer-facing dedup fix landed in master and never reached here. |

A fix landing on one side only, in both directions, is the actual cost of this
fork. It is why the collapse is worth finishing.

---

## 5. Scan before collapsing, and compare the schemas too

Two checks found more in an afternoon than reading did:

- **Import-aware identity scan.** A copy is only collapsible when its text is
  identical AND every relative import resolves to the same file, or to this
  fork's own copy of that file which is itself collapsible. Most identical files
  fail this: they bind to this fork's `core`, `utils` or models.
- **Field drift.** Load each forked model beside its original and diff
  `Object.keys(schema.paths)`. Deliberate differences (pharmacy fields here,
  `seller` for `restaurant` in the Shop) are expected; a field the original has
  and the copy lacks is usually a fix that never crossed over. The Mongoose
  default of dropping unknown fields means the copy fails silently.

Found that way (28 Sep 2026), and fixed:

| what | found |
|---|---|
| referral: one reward per phone number | the platform sign-in had it; this fork's sign-in and the Shop's invite path did not, and their logs had no `refereePhone` to check. Now shared: `food/admin/models/referralLog.model.js` exports `buildReferralLogSchema()`. |
| referral: the cap claimed atomically | same: read-then-increment here let parallel sign-ups run past it |
| Cash on Delivery block | set on the platform account, read only by Food's checkout; Quick and the Shop now check it (`core/identity/codBlock.js`) |
| coupon usage | `offerUsage.model.js` fell back to food's model by load order, so live usage went to `food_offer_usages`; it now says so explicitly and stays there |

## Progress

Phase 3 of the super-app work (28 Sep 2026): 24 files that passed the scan in
this fork and the Shop's now re-export the original; 19 empty, unimported files
were deleted.

`modules/quickCommerce/core`: **36 files → 27**.

Done: `otp`, `refreshTokens`, `roles/role.middleware`, `notifications` (4 of 7),
`payments/razorpayWebhook.controller`.

Blocked on a database: `users`, `admin` (both identity merges),
`payments/{refund,settlement,transaction}` models and services (collection
migrations, and the ledger cutover replaces them anyway).

Merge projects, not collapses: `notifications/firebase.service.js`,
`notifications/fcm.routes.js`.

Genuinely vertical-specific, keep: `roles/adminPermission.middleware.js`,
`notifications/models/notificationBroadcast.model.js`.

### Missed money fixes, second pass (29 Sep 2026)

Every fix commit that touched Food's or core's money files was checked against
its Quick and Shop twins. Ported, each with a smoke test:

| fix | where it was missing |
| --- | --- |
| a partly paid payment link is not paid | Services (`razorpayService.paymentLinkPayments`) |
| 5 wrong handover codes replace the code | Shop |
| a late capture on a cancelled order is refunded, not kept; only `pending_payment` orders advance | Shop (orders and split checkouts) |
| abandoned unpaid orders are kept cancelled, not deleted | Shop (`abandonedAt`; hidden from sellers) |
| stores cannot mark their own orders picked up / delivered | Shop |
| one order per double tap (implicit idempotency, 10 s) | Shop orders and checkouts |
| rider payouts only to the account on file, paused 24 h after it changes | Shop, Quick |
| rider cash deposit: gateway required, captured amount, counted once | Shop (all three), Quick (gateway) |
| a return takes back the order's cashback, pro rata | Shop |
| a cash order counts against the rider's cash limit | Shop |
| withdrawals decided once, with `WITHDRAWAL_DECIDE` | Shop (seller and rider) |
| delivered or paid orders cannot be deleted | Shop |
| a wallet-paid checkout that fails refunds the wallet | Shop |
| ledger: delivery GST is tax, coins charged to the platform, no zero floor on the seller's share | Shop; Quick (floor) |
| GST follows who funded the coupon | Shop |

Note on the Shop's rider rows above (handover code, rider withdrawals, cash
deposits, cash limit, rider accept and status): the Shop ships by courier only
(`fulfilmentMode` is fixed to 'standard' in orderSplit.service.js) and its
`/delivery` routes are not mounted, so that code is dormant today. The fixes
keep it safe if the Shop ever gets riders; they closed nothing live.

The Shop's per-customer coupon limit is now claimed atomically at placement
(`ecommerce/.../orders/services/couponClaim.service.js`), stored on the order or
checkout as `couponClaim`, and given back once when the unpaid order or
checkout is abandoned, swept or unwound. A customer's own unpaid order holding
the coupon gives way to their retry, as in Food.
