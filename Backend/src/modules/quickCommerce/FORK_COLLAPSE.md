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
| refunds / settlements / transactions | shared names | was `qc_*` | **merged** (1 Oct 2026) -- core collections, `vertical` marker; see below |
| users | `users` | was `qc_users` | **merged** (1 Oct 2026) -- see "Database merges" below |
| admins | `admins` | was `qc_admins` | **merged** (1 Oct 2026) -- see "Database merges" below |

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

Blocked on a database: nothing left -- `users`, `admin` and the payment
records are merged (1 Oct 2026, see "Database merges" below). The Quick
`payments/{refund,settlement,transaction}.service.js` files remain as code (they
bind to Quick's wallets, see section 1); their data is in the core collections,
and the ledger cutover replaces them anyway.

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

### Missed fixes outside the money files (29 Sep 2026)

The same scan without the money filter (every fix commit whose Food/core file
changed but not the fork's twin) turned up ~70 candidates. Most are Food-only
features Quick and the Shop do not have (formulation pricing, Rs 99 store,
dish add-ons, availability schedules, the restaurant bill engine). Ported, each
where the twin had the same bug in live code:

- Quick: price changes, approvals, bulk uploads and deletes reach customers at
  once; a deleted store leaves no configuration behind; the stock switch no
  longer re-opens approval; a paid seller withdrawal is decided once; open
  orders stop listing customer phones; a rider's pass is recorded; the admin
  cannot confirm an unpaid order; no cancel after pickup; paid or delivered
  orders cannot be deleted; dispatch uses the rider's real cash across
  services against their own limit; a rider cannot delete their account with
  cash or a delivery pending.
- Shop: sub-admins get only the sections they were given (shared
  `enforceAdminAccess`, paths in `admin/routes/shopAdminAccess.js`); admin
  price edits clear the product page; one direct notification per customer
  was capped (partial index -- the old sparse index on `ecom_notifications`
  must be dropped once by hand); pushes use the Firebase project the database
  names; any address label is accepted; logout always detaches the push token;
  only Shop admins change its banners.
- Both: a rejected store, rider or seller is refused on every request, not
  only at sign-in.

### Database merges (1 Oct 2026)

**Customers: `qc_users` -> `users`.** Quick reads and writes customers in the
shared `users` collection; a Quick customer id IS the platform id.
`modules/quickCommerce/core/users/user.model.js` re-exports the platform
model; the old rows are `LegacyQcUser`, read only by the merge.

- The merge is `core/identity/quickCustomer.js` (`mergeQcUser`): the platform
  account by platformUserId, else the last ten digits of the phone, else one
  made with the qc row's own `_id` (so its wallet and rows need not move).
  Quick-only fields keep their own names -- `quickReferralCount`,
  `quickReferredBy`, `quickBlocked` (Quick's admin switch; `isActive` is every
  app), `quickJoinedAt` (Quick's admin and broadcasts list only these),
  `tokenVersion`, rider `rating`. Blanks are filled, push tokens and addresses
  merged, every reference in `QC_USER_REFS` rewritten, and `qc_user_id_map`
  keeps old -> new.
- Code works before and after the script: the session middleware, socket,
  refresh, invite codes and the offers list call `resolveQuickCustomerId`,
  which merges a waiting row on that customer's first request.
  `platformUserIdFor`, `resolveInviter` and `linkedIds('qc_users')` read the
  map / the platform id too.
- Run: deploy, then `node scripts/migrations/mergeQcUsers.mjs` (dry run),
  `--apply` (re-runnable), later `--drop-old` (refuses while any reference to
  a moved id is left -- a clash on a unique index, e.g. a second cart for one
  person, is reported for a hand decision; it renames `qc_users`, not drops).
- Between the deploy and `--apply`, admin and rider screens that populate a
  customer show no name for customers not merged yet: run the script straight
  after the deploy.
- Closing the Quick account no longer deletes anything shared: it empties
  Quick's cart and favourites, signs Quick out and clears `quickJoinedAt`.
- Test: `tests/merge-qc-users.smoke.mjs`.

**Admins: `qc_admins` -> `admins`.** Quick's admins are platform admins, under
the shared permission model enforced by `core/admin/enforceAdminAccess.middleware.js`.

- `core/admin/quickAdmin.js` (`mergeQcAdmin`): a new email becomes a platform
  sub-admin of the Quick module with the row's own `_id` and password hash --
  `servicesAccess` quickCommerce + medical, `module` quickCommerce,
  `admin_type` subadmin (so the policy keeps it out of Food, Rides and the
  Shop); a Quick super_admin gets write on every resource the Quick panel
  offers, a sub_admin its sections mapped by `QC_SECTION_RESOURCES`
  (view/export -> read, create/edit/delete -> write, delete access only if it
  had delete). An email already in `admins` keeps that account -- its
  password and permissions -- and only gains the Quick and Medical panels
  (the script lists these as REVIEW). `qc_admin_id_map` keeps old -> new.
- Code works before and after: Quick's session middleware and
  `requireServiceAccess` translate an old qc_admins id (merging it on the
  spot); Quick's admin sign-in and password reset merge a waiting row by email.
- Quick's own sub-admin screens (`/qc/admin/sub-admins`) answer 410: admins
  are managed in Master > Admin accounts. The web panel did not use them.
- Run: deploy, then `node scripts/migrations/mergeQcAdmins.mjs`, `--apply`,
  later `--drop-old`. Test: `tests/merge-qc-admins.smoke.mjs`.

**Payment records: `qc_refunds`, `qc_settlements`, `qc_entity_transactions` ->
`refunds`, `settlements`, `transactions`.** One schema per record
(`core/payments/models/*.model.js`); every row carries `vertical` -- null for
the core's own, 'quickCommerce' for Quick's (`core/payments/models/verticalPayments.js`).
The core models read only rows with no vertical; Quick's models are the same
schema narrowed to theirs, so neither side's lists or reports see the other's.

- Rows keep their `_id` when copied (a return's `refundId`, a settlement's
  `transactionIds` still resolve); `qc_payment_id_map` records each copy.
- Works before and after: until a collection is fully copied, Quick's lists
  read both (`readThrough`), and a row Quick touches (processing a settlement
  or a gateway refund) is copied first, so nothing is written to the old
  collections again.
- Reports: pnl, commission overview and core/finance read none of these
  collections, so nothing there changes. All three were written only by the
  BullMQ path (off) and Quick's admin settlement screens.
- Run: deploy, then `node scripts/migrations/mergeQcPayments.mjs`, `--apply`,
  later `--drop-old` (renames the three). The first boot builds a `vertical`
  index on the three core collections; a ledger write that lands during that
  build can fail once with "catalog changes" and is safe to retry.
- Test: `tests/merge-qc-payments.smoke.mjs`.

**Production order:** deploy; `mergeQcUsers.mjs` (dry run, then `--apply`);
`mergeQcAdmins.mjs` (dry run, review the REVIEW list, `--apply`);
`mergeQcPayments.mjs` (dry run, `--apply`). The three are independent and
each is re-runnable; run `--drop-old` for each only after checking the app.
