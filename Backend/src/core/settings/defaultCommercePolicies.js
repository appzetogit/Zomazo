/**
 * The starting Refund, Cancellation and Shipping & Delivery policies for the
 * platform, for every service it runs: food, groceries (Quick), shopping,
 * medicines, rides and parcels, and home services.
 *
 * Seeded into Master settings -> Legal pages (platform_profile.legal.refund /
 * .cancellation / .shipping) by scripts/seed-legal-pages.mjs, only where the
 * page is empty; an admin edits them from then on.
 *
 * Like defaultTerms.js, windows, fees and timelines that admins configure are
 * referred to ("shown in the app"), not written in, so a policy cannot
 * contradict what the app actually does. The bank timelines are the payment
 * networks' own and do not change with settings.
 */

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const parts = ({ brand = 'Zomazo', email = 'zomazo.in@gmail.com', updated = new Date() } = {}) => ({
  b: esc(brand),
  date: updated.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
  contactLine: email
    ? `by email at <a href="mailto:${esc(email)}">${esc(email)}</a>, or through <strong>Help &amp; Support</strong> in the app`
    : 'through <strong>Help &amp; Support</strong> in the app',
});

export function defaultRefundPolicyHtml(opts = {}) {
  const { b, date, contactLine } = parts(opts);
  return `
<h1>Refund Policy</h1>
<p>Last updated: ${date}</p>

<p>This policy explains when you get money back for an order, ride or booking on ${b}, how it is paid, and how long it takes. It applies to every service on the app, alongside our Terms &amp; Conditions and Cancellation Policy.</p>

<h3>1. When you get a refund</h3>
<ul>
<li><strong>Order not accepted or cancelled by the Partner or by us</strong>: full refund.</li>
<li><strong>Order cancelled by you</strong> within the free cancellation window shown in the app: full refund. After that window, any cancellation fee shown in the app is deducted.</li>
<li><strong>Items missing, wrong, damaged, spoiled or expired</strong>: refund for the affected items, once checked. Report it through Help &amp; Support within 24 hours of delivery (for food, as soon as possible), with photos where you can.</li>
<li><strong>Order not delivered</strong> for reasons within our or the Partner's control: full refund.</li>
<li><strong>Payment taken but the order was not placed</strong>: the amount is reversed automatically.</li>
<li><strong>Rides</strong>: if you were overcharged, charged for a ride that did not happen, or charged a cancellation fee wrongly, the difference is refunded after review.</li>
<li><strong>Home services</strong>: if the professional did not turn up, or the service booked was not delivered, the amount paid for it is refunded.</li>
<li><strong>Shopping (e-commerce) orders</strong>: items can be returned within the return window shown on the product page, unused and in their original packaging with tags. The refund is issued once the returned item has been picked up and checked.</li>
</ul>

<h3>2. When refunds are not given</h3>
<ul>
<li>Food that was delivered as ordered but did not suit your taste.</li>
<li>Orders cancelled after preparation or dispatch, beyond the cancellation fee rules shown in the app.</li>
<li>Delivery that failed because the address was wrong, you could not be reached, or you were not available to receive it.</li>
<li>Items marked non-returnable on the product page (for example perishables, innerwear, personal-care and opened medicines), unless they arrived damaged, wrong or expired.</li>
<li>Prescription medicines that were supplied correctly against your prescription.</li>
</ul>

<h3>3. How refunds are paid</h3>
<p>Refunds go to your ${b} wallet or to the original payment method, as shown when the refund is issued. Wallet refunds can be used straight away on any service in the app. Cash on delivery orders are refunded to the wallet, or to a bank account or UPI ID you give us.</p>

<h3>4. How long it takes</h3>
<ul>
<li>${b} wallet: immediately once the refund is approved.</li>
<li>UPI: usually within 1 to 3 working days.</li>
<li>Debit or credit card and net banking: usually 5 to 7 working days, depending on your bank.</li>
</ul>
<p>Refund requests are reviewed within 48 hours. If a refund approved by us has not reached you within these times, contact us with the order ID and we will share the bank reference so you can follow up.</p>

<h3>5. Misuse</h3>
<p>We may refuse refunds, and restrict an account, where requests are false, repeated without reason, or part of an attempt to abuse refunds, offers or cash on delivery.</p>

<h3>6. Contact</h3>
<p>For refund questions, contact ${b} ${contactLine}, with your order ID.</p>
`.trim();
}

export function defaultCancellationPolicyHtml(opts = {}) {
  const { b, date, contactLine } = parts(opts);
  return `
<h1>Cancellation Policy</h1>
<p>Last updated: ${date}</p>

<p>This policy explains how you, a Partner or ${b} can cancel an order, ride or booking, and what it costs. The exact free cancellation window and any fee for each service are shown in the app before you confirm and again when you cancel; those figures are part of this policy.</p>

<h3>1. Cancelling an order (food, groceries, medicines)</h3>
<ul>
<li>You can cancel free of charge until the store or restaurant accepts the order, or within the free window shown in the app.</li>
<li>After the order is accepted or being prepared or packed, a cancellation fee of up to the order value may apply, because the food or items cannot be resold. The fee is shown before you confirm the cancellation.</li>
<li>Once the order has been picked up for delivery it can no longer be cancelled.</li>
</ul>

<h3>2. Cancelling a shopping (e-commerce) order</h3>
<p>You can cancel free of charge until the order is shipped. After it ships, you can refuse delivery or return it under the return window shown on the product page; see the Refund Policy.</p>

<h3>3. Cancelling a ride or parcel delivery</h3>
<ul>
<li>You can cancel free of charge within the free window shown in the app after booking, or if the driver is running much later than the arrival time shown.</li>
<li>After that, or once the driver has arrived at the pickup point, a cancellation fee shown in the app may be charged. It goes mostly to the driver for their time and travel.</li>
<li>Waiting charges may apply if the driver waits at pickup beyond the free waiting time.</li>
</ul>

<h3>4. Cancelling a home service booking</h3>
<p>You can cancel or reschedule free of charge up to the time shown in the app before the slot. A visit fee may apply for cancellations after the professional has set out or reached you.</p>

<h3>5. Cancellations by a Partner or by ${b}</h3>
<p>A Partner or ${b} may cancel an order or booking, for example if an item is out of stock, the store is closed, the address is outside the service area, a driver cannot be found, payment fails, or the order looks fraudulent. You are not charged for these cancellations and anything you paid is refunded in full under the Refund Policy.</p>

<h3>6. Repeated cancellations</h3>
<p>Frequent cancellations after acceptance, or refusing cash on delivery orders, may lead to cash on delivery being turned off or the account being restricted.</p>

<h3>7. Contact</h3>
<p>To cancel an order you cannot cancel in the app, or to question a fee, contact ${b} ${contactLine}.</p>
`.trim();
}

export function defaultShippingPolicyHtml(opts = {}) {
  const { b, date, contactLine } = parts(opts);
  return `
<h1>Shipping &amp; Delivery Policy</h1>
<p>Last updated: ${date}</p>

<p>This policy explains where and how ${b} delivers orders, what it costs and how long it takes.</p>

<h3>1. Where we deliver</h3>
<p>We deliver only inside the service areas set for each store, restaurant and service, within India. The app checks your address at checkout; if it is outside the area, the order cannot be placed.</p>

<h3>2. How delivery works</h3>
<ul>
<li><strong>Food, groceries and medicines</strong> are delivered by delivery partners, usually the same day and often within an hour. You can track the order live in the app.</li>
<li><strong>Shopping (e-commerce) orders</strong> are packed by the seller and delivered by our delivery partners or a courier. The expected delivery date is shown at checkout and in your order details.</li>
<li><strong>Parcel delivery</strong> is picked up and dropped by a driver at the addresses you choose, and tracked live.</li>
</ul>

<h3>3. Delivery charges</h3>
<p>Any delivery fee, small-order fee, distance or surge charge, packaging charge and platform fee is shown separately at checkout before you pay. Free delivery, where offered, applies on the conditions shown.</p>

<h3>4. Delivery times</h3>
<p>Delivery times shown are estimates. They can change with preparation time, distance, traffic, weather, demand or events beyond our control. If an order is running late we show the updated time in the app. Shopping orders that are delayed beyond the expected date can be cancelled through Help &amp; Support for a full refund, if not yet delivered.</p>

<h3>5. Receiving your order</h3>
<ul>
<li>Give a complete address and a reachable phone number. The delivery partner may call you to find the address.</li>
<li>Some orders need a delivery code (OTP) shared from the app to the delivery partner at handover.</li>
<li>Medicines on prescription may be handed over only to an adult at the address.</li>
<li>If you cannot be reached or are unavailable, the delivery partner waits for a short time and the order may then be cancelled; see the Cancellation and Refund policies.</li>
</ul>

<h3>6. Problems with a delivery</h3>
<p>Check the order at delivery. If anything is missing, damaged or wrong, report it through Help &amp; Support within 24 hours, with photos where you can.</p>

<h3>7. Contact</h3>
<p>For delivery questions, contact ${b} ${contactLine}, with your order ID.</p>
`.trim();
}
