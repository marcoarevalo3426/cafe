# Validation

Executed during implementation on 13 November 2026 (Australia/Melbourne):

- TypeScript strict check passed.
- Production Webpack build passed.
- Expo dependency compatibility check passed.
- iOS and Android Hermes JavaScript exports passed, with local Inter fonts bundled.
- 23 isolated domain/API tests passed (see final run).
- Local in-app browser: invalid email message; six-digit email code paste; owner verification and restored session; completing an order; viewing completed order history; drawer navigation; menu-template layout; voucher-generation validation/organisation/summary steps; successful generation of two test vouchers after approval; customer login; live owner-generated menu; item variation and note selection; combined voucher balance and cart total.

Browser testing caught and fixed stale session state routing after verification, root container height, radio accessibility state, voucher-table checkbox labels, divider scaling, and the back-arrow rotation. Existing local test data is not committed.

Automatic approval review initially stopped the browser cash-received submission. After explicit user approval, the test generated two $10 vouchers for the demo organisation; the UI displayed six total vouchers and a success confirmation. No real payment or email occurred.

Not executed: live email delivery, live/test Stripe provider checkout, real Apple Pay/Google Pay, APNs/FCM delivery, Expo OTA delivery to installed binaries, signed iOS/Android builds, production hosting, and Docker image execution. These need external credentials, developer accounts/devices, or Docker (not available in the execution environment). The integration code and deployment configuration are included.

The supplied Figma contains mobile frames. Desktop behavior is adapted with a persistent navigation column at 1000 CSS pixels and wider content bounds. Customer item/cart, organisation and management pages extend the existing visual conventions because complete matching Figma frames/JPG references were not supplied.

Responsive verification used an isolated local iframe harness at 320, 402 and 1280 CSS pixels. Narrow layouts stack cafe tiles and retain mobile navigation; desktop layouts show the persistent navigation column. The harness is not part of the product.

The validity display has a regression test for the exclusive end-of-month UTC boundary, including year rollover.

Local Testing mode update: signup and management share a four-role demo account picker. Added HTTP coverage for all roles and native session tokens, production/demo-disabled rejection, public-host and remote-peer rejection, forged forwarding headers, and rejection of local test sessions on public requests.

Browser verification confirmed the Testing mode button on signup, direct demo Admin login, the button on management, switching from Admin to Customer, and logout back to signup. Webpack and iOS/Android bundle exports passed for this change.
