# Birthday Reminder App

Birthday planner with:
- Friend management
- Priority circles
- Reminder timeline (15 days before, 1 day before, birthday)
- Google Calendar quick-add links
- Firebase Web Push setup

## Run locally

```bash
npm install
npm run dev
```

## Firebase setup (for push)

1. Create a Firebase project.
2. Enable Cloud Firestore.
3. Enable Cloud Messaging and create a Web Push certificate key (VAPID).
4. Fill values in `public/firebase-config.js`.
5. Deploy and open the app over HTTPS.

## Automatic reminder scheduler (Cloud Functions)

The app now syncs saved friends to Firestore under `users/{deviceId}/friends/*`.
Device tokens are stored in `deviceTokens/*`.

Deploy the scheduler function:

```bash
cd birthday-app
npm install -g firebase-tools
firebase login
cd functions
npm install
cd ..
firebase deploy --only functions
```

Function added:
- `sendBirthdayReminders` (runs every day at 9:00 AM Asia/Kolkata)
- Sends notifications for 15 days before, 1 day before, and birthday day
- Cleans invalid FCM tokens automatically

## Firestore rules (starter)

Use these while testing:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /deviceTokens/{token} {
      allow read, write: if true;
    }
    match /users/{userId} {
      allow read, write: if true;
      match /friends/{friendId} {
        allow read, write: if true;
      }
    }
    match /schedulerRuns/{dayKey} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

### iPhone requirement

On iPhone, web push works only when the app is opened as an installed Home Screen web app.
Open the deployed URL, add to Home Screen, then open from the icon and tap `Enable notifications`.
