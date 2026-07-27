TIRANGA PAY V5 FINAL

LIVE FIREBASE:
- user-app/
- admin-panel/
- database.rules.json
- firebase.json
- .firebaserc

FULLY INTERACTIVE DEMO:
- demo/user/index.html
- demo/admin/index.html
Both demo panels share browser storage. Open both in the same browser.
Demo flow:
1. User demo login.
2. Submit activation payment.
3. Admin demo login -> Pending Payments -> Approve or Reject.
4. User demo refreshes automatically; verify code or see penalty.
5. After activation, VIP logo/code replaces payment card.
6. Fund click opens bank-account setup, not payment.
7. Bonus Claim adds ₹2,000 to Total Balance.
8. Withdrawal appears in Admin demo and can be Approved -> Processing -> Paid.

BANK DIRECTORY:
- 211 RBI-derived regulated/NEFT-participant bank names are seeded.
- Includes public, private, small finance, payments, RRB, foreign and many co-operative banks.
- Admin can add/disable banks.
- Live upload: open admin-panel/seed-banks.html after admin login.

ADMIN MENU:
Dashboard, Users List, Pending Payments, Approved Payments, Rejected Payments,
Activation Codes, Penalty & Block History, Fund Management, User Fund Accounts,
Commission & Ledger, Transaction History, Withdrawal Management, Bonus Management,
Policies & App Content, Notifications & Activity, General Settings,
All India Bank Directory, Audit Logs.

DEPLOY:
firebase deploy --only database
firebase deploy --only hosting:user
firebase deploy --only hosting:admin

ADMIN ROLE:
admins/<AUTH_UID>/role = "superadmin"

SECURITY:
ATM PIN, CVV and full card number are never collected.
