TIRANGA PAY v6 FINAL

Included:
- White-theme User App with all options always visible
- ₹1,999 platform payment flow
- Unique username/email/phone reservation
- Unique UTR reservation
- Admin approve/reject
- Fake/Invalid UTR penalty:
  1st +100 => 2099
  2nd +200 => 2299
  3rd +300 => 2599
  4th => blocked
- Activation code
- Main account setup
- Per-fund account setup
- Working support links controlled by Admin
- Change Password via Firebase reset email
- Privacy Policy / Terms / Refund pages controlled by Admin
- Withdrawal request flow
- Audit logs

IMPORTANT:
Fabricated financial transactions are NOT generated as real activity in this package.
Only verified/real ledger records should be treated as financial transactions.

Deploy:
firebase use --add
select tiranga-pay-rb, alias default
firebase target:apply hosting user tiranga-pay-rb-user
firebase target:apply hosting admin tiranga-pay-rb-admin
firebase deploy --only hosting,firestore


AUTO ACTIVITY
- After successful activation-code verification, the app schedules simulated activity after 1 minute.
- Visible row names: Credit, Debit, Commission.
- Credit and Commission are green; Debit is red.
- Records are stored with simulated=true, withdrawable=false.
- They do not increase real withdrawable balance.

V8 FIXES
- Fixed registration permission-denied bug by moving Firestore uniqueness checks after Firebase Auth creation.
- Login now works for successfully registered users.
- Fixed Activation Code verification rules so assigned user can consume only their own active code.
- Auto Credit/Debit/Commission starts 1 minute after Main Account Setup is fully completed and accountStatus=running.

V10 ADMIN + QR UPLOAD
- User App remains the same as v9/v8-auth-fixed behavior.
- Premium dark navy Admin Panel restored.
- Removed QR URL input from Admin UI.
- Admin chooses QR photo from gallery/device.
- Supports PNG/JPG/JPEG/WEBP up to 5MB.
- Uploads QR to Firebase Storage and saves download URL to settings/app.qrUrl.
- User App automatically displays uploaded QR from Firestore settings.
- Change QR and Remove QR supported.
- Deploy Storage Rules with hosting/firestore/storage.

V11 QR LINK MODE
- Firebase Storage not required.
- Admin Panel Payment Settings has QR Image Link field.
- Paste a public http/https direct image link and preview it.
- Saved URL goes to Firestore settings/app.qrUrl.
- User App displays the QR image automatically from that URL.
- Deploy only hosting + firestore.

V12 FIXES
- Refresh no longer flashes Login screen in User App or Admin Panel; loading screen is shown until Firebase Auth resolves.
- Activation code assigned by Admin now displays automatically instead of "Waiting...".
- Notifications from Admin are visible from the bell icon; user-specific and all-user notifications supported.
- Top profile icon opens Profile.
- Bonus claim added after account is running; claimed bonus is shown in eligible withdrawable amount.
- Auto Credit/Debit/Commission scheduler made retry-safe and starts 1 minute after Main Account Setup completes.
- Auto activity uses fixed transaction IDs to avoid duplicates.
- Simulated auto activity is kept separate from real withdrawable balance and clearly disclosed.

V13 FIXES
- Removed visible Loading screens completely.
- Refresh keeps the same User/App page and scroll position using sessionStorage.
- Admin refresh also restores same section and scroll position.
- Body stays hidden only until Firebase Auth resolves, preventing a fake logout/login flash.
- Auto Credit/Debit/Commission repaired for old and new RUNNING accounts.
- Existing RUNNING accounts older than 1 minute generate missing auto activity almost immediately.
- Auto transaction IDs are fixed/idempotent to prevent duplicates.
- Dashboard right-side info card replaced with Bonus Claim card.
- Claimed bonus appears in eligible/withdrawable balance.

V14 ADMIN RESTORE
- Restored Admin Panel exactly from the last known working v11 premium version.
- Removed the broken hidden-body/admin refresh experiment that caused a white screen.
- User App remains on v13 fixes.

V16 FINAL FIXES
- Activation code verification now auto-claims configured bonus immediately.
- Bonus balance appears in eligible withdrawal amount.
- Auto Credit/Debit/Commission repaired for old and new RUNNING accounts.
- Missing fixed activity entries are detected and generated.
- Old RUNNING accounts are repaired almost immediately; new RUNNING accounts after ~1 minute.
- Failed auto generation retries automatically.

V17 ADDITIONS
- Admin can configure up to 6 Telegram support links.
- User Support page shows all configured Telegram links.
- Withdrawal amount is immediately reserved from displayed available withdrawable balance.
- Withdrawal history appears on Withdrawal page and Transactions page.
- Fund pages show only that fund's Credit/Debit/Commission activity.
- Simulated auto commission is excluded from withdrawable balance.

V18: Commission entries are included in eligible withdrawable balance. Withdrawal requests reserve/minus the requested amount from available balance.

V19 POLICY SAVE FIX
- Privacy Policy, Terms & Conditions and Refund Policy now save directly to Firestore settings/app.
- Added clear success/error status and alert.
- Policy save is independent from audit logging, so audit failure does not block policy save.
- Existing User App behavior preserved.

V20 POLICY SAVE + REFRESH
- Policy save uses a single delegated click handler.
- Saves Privacy Policy, Terms and Refund Policy directly to settings/app.
- Reads the document back and verifies all three saved values.
- On successful save, Admin Panel refreshes once automatically.
- After refresh, Policies & Content section opens again automatically.

V21 POLICY PERSISTENCE FIX
- Privacy Policy saved in content/privacyPolicy.
- Terms saved in content/terms.
- Refund Policy saved in content/refundPolicy.
- Admin reads all three back and verifies exact saved text before refresh.
- Admin refreshes once after successful save and reopens Policies & Content.
- User App listens to these 3 content documents in realtime.

V22 SUPPORT REPLACE FIX
- Customer Support now uses content/support as the source of truth.
- Save / Replace overwrites the previous support configuration.
- Mirrors support to settings/app for backward compatibility.
- Supports up to 6 Telegram links if fields exist.
- Support description/message is editable.
- Phone support is forced off/blank.
- User App listens to content/support in realtime.
- Save verifies persistence, refreshes once, and reopens Support Settings.

V23 SUPPORT PERSISTENCE FIX
- Admin support form no longer reloads from stale settings/app support values.
- content/support is now the single source of truth for Admin and User App.
- Save/Replace fully overwrites content/support (merge:false).
- Save reads back and verifies exact Telegram, WhatsApp, email and description values.
- Removed values stay removed after refresh.
- settings/app receives only a compatibility mirror and is not used to reload Admin support fields.
