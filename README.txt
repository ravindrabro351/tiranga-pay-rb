TIRANGA PAY FINAL COMPLETE PACKAGE

FILES:
- user-app/index.html, app.js, manifest.json
- admin-panel/index.html, admin.js, firebase-messaging-sw.js, manifest.json
- functions/index.js, package.json
- database.rules.json
- firebase.json
- .firebaserc
- preview/

FIRST ADMIN SETUP:
Realtime Database:
admins/<ADMIN_AUTH_UID>/role = "superadmin"

DEPLOY:
firebase deploy --only database
firebase deploy --only hosting:user
firebase deploy --only hosting:admin
cd functions
npm install
cd ..
firebase deploy --only functions

NOTIFICATIONS:
1. settings/webPushVapidKey already needs to contain your VAPID public key.
2. Open Admin Panel and tap Allow Notifications.
3. Deploy Cloud Functions.

IMPORTANT:
- UTR is not bank-verified automatically without a payment gateway API.
- Admin Reject triggers automatic penalty.
- 4th rejection automatically blocks the user.
- Hosted HTML/CSS/JS updates automatically appear in iframe-based installed APKs.
- Native icon, splash, Android permissions, or native push-plugin changes require APK rebuild.


FIXED PREVIEW:
- preview/user-preview.html works offline without Firebase.
- preview/admin-preview.html works offline without Firebase.
- Real Login/Register/Admin Login only work after Firebase Hosting deploy.
- Do not judge live Firebase authentication from file:// preview.


FIREBASE CONNECTION FILES:
- user-app/firebase-config.js
- admin-panel/firebase-config.js

Both app.js and admin.js import the same Firebase project configuration:
Project ID: tiranga-pay-rb
Realtime Database: tiranga-pay-rb-default-rtdb.firebaseio.com

REQUIRED FIREBASE SETUP:
1. Authentication > Sign-in method > Email/Password = Enabled
2. Realtime Database rules deploy from database.rules.json
3. Add admin role:
   admins/<ADMIN_AUTH_UID>/role = "superadmin"
4. Deploy hosting and functions.
