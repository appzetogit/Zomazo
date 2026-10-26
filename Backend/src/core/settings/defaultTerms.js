/**
 * The starting Terms & Conditions for customers of the platform, written for
 * every service it runs: food, groceries (Quick), medicines, rides and parcels,
 * and home services.
 *
 * Seeded into Master settings -> Legal pages (platform_profile.legal.terms) by
 * scripts/seed-legal-pages.mjs, only where that page is empty; an admin edits it
 * from then on. Partners (restaurants, sellers, pharmacies, riders, drivers,
 * service professionals) sign their own agreements, set per app.
 *
 * Times and amounts that admins configure -- cancellation windows, fees,
 * refund timelines -- are referred to, not written in, so the terms cannot
 * contradict what the app actually does.
 */

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function defaultTermsHtml({ brand = 'Zomazo', operator = 'Zomazo', email = 'zomazo.in@gmail.com', updated = new Date() } = {}) {
  const b = esc(brand);
  const op = esc(operator || brand);
  const em = esc(email || 'zomazo.in@gmail.com');
  const date = updated.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const contactLine = `by email at <a href="mailto:${em}">${em}</a>, or through <strong>Help &amp; Support</strong> in the app`;

  return `
<h1>Terms &amp; Conditions</h1>
<p><strong>Effective Date / Last Updated:</strong> ${date}</p>

<p>These Terms &amp; Conditions ("Terms", "Agreement") govern your access to and use of the mobile applications (iOS and Android), web portals, and software platform (collectively, the "Platform") owned and operated by ${op} ("${b}", "we", "us", "our").</p>

<p>By creating an account, downloading, accessing, or using the Platform, you agree to be legally bound by these Terms, our <a href="/privacy">Privacy Policy</a>, and any applicable cancellation and refund policies. If you do not agree to these Terms, you must not access or use the Platform.</p>

<hr />

<h3>1. Electronic Marketplace &amp; Intermediary Status</h3>
<p>${b} is an electronic marketplace and technology intermediary platform operating under Section 79 of the Information Technology Act, 2000. We connect users with independent third-party service providers and merchants, including restaurants, grocery sellers, licensed pharmacies, delivery partners, drivers, and service professionals ("Partners"). Unless explicitly stated in writing for a specific product or service, the Partner—not ${b}—is the seller of the goods or provider of the services and is solely responsible for inventory, quality, preparation, safety, warranties, packaging, and regulatory licensing.</p>

<h3>2. App Store &amp; Platform Specific Terms (Apple iOS &amp; Google Android)</h3>
<p>If you download or access the Platform via the Apple App Store or Google Play Store:</p>
<ul>
  <li><strong>Parties to Agreement:</strong> You acknowledge that this Agreement is entered into between you and ${b} only, and not with Apple Inc. ("Apple") or Google LLC ("Google"). Neither Apple nor Google is responsible for the Platform, its content, maintenance, or support.</li>
  <li><strong>Maintenance and Support:</strong> ${b} is solely responsible for providing any maintenance and support services with respect to the Platform as specified in these Terms or required under applicable law. Apple and Google have no obligation whatsoever to furnish any maintenance or support services.</li>
  <li><strong>Third-Party Beneficiaries:</strong> You agree that Apple, Apple's subsidiaries, and Google are third-party beneficiaries of these Terms. Upon your acceptance of these Terms, Apple and Google will have the right (and will be deemed to have accepted the right) to enforce these Terms against you as a third-party beneficiary.</li>
  <li><strong>Scope of License:</strong> ${b} grants you a limited, non-exclusive, non-transferable, revocable license to download and use the application on devices you own or control, in accordance with the Apple App Store Terms of Service and Google Play Terms of Service.</li>
  <li><strong>Product Claims &amp; Intellectual Property:</strong> ${b}, and not Apple or Google, is responsible for addressing any claims relating to the Platform or your possession and use of the Platform, including consumer protection claims, regulatory non-compliance, and third-party intellectual property infringement claims.</li>
</ul>

<h3>3. Eligibility &amp; Account Registration</h3>
<ul>
  <li>You must be at least 18 years of age and legally capable of entering into a binding contract under Indian law.</li>
  <li>Account authentication is conducted via your mobile telephone number and a secure One-Time Password (OTP). You are responsible for maintaining the confidentiality of your credentials and devices.</li>
  <li>You agree to provide true, accurate, and current information, including valid delivery addresses and contact information.</li>
  <li>A single account works seamlessly across all services offered on the Platform. Creating fake, automated, or multiple duplicate accounts is strictly prohibited.</li>
</ul>

<h3>4. Orders, Pricing, and Payments</h3>
<ul>
  <li>Prices, menus, descriptions, and stock quantities are published by independent Partners and are subject to change without prior notice. The final payable amount is displayed at checkout before you confirm payment.</li>
  <li>The total price may include applicable item costs, taxes (GST), packaging charges, delivery charges, platform fees, and surge fees. Any promotional coupon applied is discounted prior to final payment.</li>
  <li>Orders are subject to acceptance by the Partner. In the event an item is out of stock, the Partner may reject or partially fulfill the order, and you will not be charged for unsupplied goods.</li>
  <li>Payments can be made via authorized online payment methods (UPI, debit/credit cards, net banking), ${b} in-app wallet, or cash on delivery where available. All online transactions are securely encrypted and processed by RBI-licensed payment aggregators (Razorpay).</li>
</ul>

<h3>5. Pharmacy &amp; Prescription Medicine Orders</h3>
<ul>
  <li>${b} acts strictly as a technology facilitator connecting customers with independent, licensed retail pharmacies. We do not sell, dispense, or distribute medicines directly.</li>
  <li>Prescription medications (Schedule H, H1, and X drugs) will be dispensed strictly against a valid, verifiable prescription issued by a Registered Medical Practitioner. The fulfilling pharmacist reserves the statutory right to verify, alter, or reject any prescription order that fails to meet legal and medical standards.</li>
  <li>Information provided on the Platform regarding pharmaceutical products is for informational purposes only and does not constitute medical advice or a substitute for professional healthcare consultation.</li>
</ul>

<h3>6. Taxi Rides &amp; Parcel Logistics</h3>
<ul>
  <li>Fare estimates shown before booking are dynamic and subject to variation based on travel route, waiting time, traffic conditions, night charges, state entry taxes, tolls, and parking fees.</li>
  <li>Rides are operated by independent vehicle drivers. Riders must comply with traffic safety guidelines (e.g. wearing seatbelts or helmets).</li>
  <li>Parcel delivery must not be used to transport illegal, hazardous, inflammable, toxic, stolen, or restricted goods, currency, precious metals, or live animals. Drivers reserve the right to inspect packages for safety.</li>
</ul>

<h3>7. Home Services</h3>
<p>Home maintenance, repair, and lifestyle services are carried out by verified independent service professionals. Customers must ensure safe and unobstructed access to the work premises. Any additional material costs or extra scope requested on-site will be communicated and billed accordingly.</p>

<h3>8. In-App Wallet</h3>
<ul>
  <li>The ${b} digital wallet is a closed-loop internal account balance holding refunds, referral rewards, and cashback credits.</li>
  <li>Wallet balances can be redeemed across any service available on the Platform. Wallet balances are non-transferable to other users and cannot be withdrawn as cash, except where a refund is legally required to be credited back to your original funding source.</li>
</ul>

<h3>9. Cancellations &amp; Refunds</h3>
<p>Orders, rides, and services may be cancelled according to the cancellation timelines displayed in the app. If a cancellation fee applies due to merchant preparation or driver dispatch, it will be clearly indicated before cancellation confirmation. Refunds for missing, damaged, spoiled, or non-delivered items are processed in accordance with our <a href="/refund">Refund Policy</a> and credited to your wallet or original payment method within 1 to 7 business days.</p>

<h3>10. User Conduct &amp; Prohibited Activities</h3>
<p>You agree not to misuse the Platform, including but not limited to: placing fraudulent orders; misusing promotional offers or referrals; abusing, harassing, or threatening delivery partners, drivers, or customer support staff; reverse engineering or attempting to exploit the app codebase; or using the Platform for any unlawful purpose. Violation may result in immediate suspension or termination of your account.</p>

<h3>11. Account Deletion &amp; Termination</h3>
<p>In accordance with App Store and Play Store policies, you may delete your account and associated personal data at any time via <code>Account / Profile &rarr; Settings &rarr; Delete Account</code> in the app, or by contacting our team at <a href="mailto:${em}">${em}</a>. Upon receiving your verified deletion request, your profile and identity data will be removed within 30 days, subject to legally mandated financial recordkeeping requirements.</p>

<h3>12. Intellectual Property Rights</h3>
<p>All trademarks, logos, UI designs, code, graphics, and content associated with ${b} are the exclusive intellectual property of ${b} or its licensors. You may not copy, reproduce, modify, or distribute any part of the Platform without prior written consent.</p>

<h3>13. Limitation of Liability</h3>
<p>To the maximum extent permitted by applicable law, ${b} shall not be liable for any indirect, incidental, special, or consequential damages resulting from the use or inability to use the Platform, or for the quality, safety, or legality of goods and services provided by independent Partners. In any event, ${b}'s aggregate liability shall not exceed the amount actually paid by you for the order or booking giving rise to the claim.</p>

<h3>14. Governing Law &amp; Dispute Resolution</h3>
<p>These Terms shall be governed by and construed in accordance with the laws of India. Any dispute arising under or in connection with these Terms shall be subject to the exclusive jurisdiction of the competent courts of India, without prejudice to consumer rights under the Consumer Protection Act, 2019.</p>

<h3>15. Contact &amp; Grievance Redressal</h3>
<p>For questions regarding these Terms, or to report a grievance, please contact us:</p>
<p>
  <strong>Grievance Officer:</strong> Customer Grievance Desk<br />
  <strong>Company / Platform:</strong> ${b} (${op})<br />
  <strong>Email:</strong> <a href="mailto:${em}">${em}</a><br />
  <strong>Website:</strong> <a href="https://zomazo.in" target="_blank" rel="noopener noreferrer">https://zomazo.in</a><br />
  <strong>In-App Support:</strong> Help &amp; Support section
</p>
<p>In accordance with the Consumer Protection (E-Commerce) Rules, 2020, we acknowledge complaints within 48 hours and endeavor to resolve them within 30 days.</p>
`.trim();
}
