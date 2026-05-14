# NovaCanvas

Minimal GitHub Pages site published from the `docs/` folder on the `main` branch, with a Firebase backend scaffolded for Auth, Firestore, Storage, and Cloud Functions.

## GitHub Pages

GitHub Pages serves the site from `main` -> `/docs`.

## Firebase

The repo is bound to Firebase project `novacanvas`.

Core files:

- `firebase.json`: Firebase services and emulator config
- `firestore.rules`: initial database security rules
- `storage.rules`: initial storage security rules
- `functions/`: TypeScript Cloud Functions workspace
- `.env.example`: frontend/backend Firebase config placeholders
- `docs/firebase-config.example.js`: browser-side Firebase config handoff

### Local backend

1. Install dependencies:
   `cd functions && npm install`
2. Start emulators from the repo root:
   `firebase emulators:start`
3. Deploy backend:
   `firebase deploy --only functions,firestore,storage`

### Current backend entry points

- `healthCheck`: callable function for frontend connectivity tests
- `bootstrapUserProfile`: Firestore trigger to stamp profile metadata

### Firebase web app

The Firebase web app is already registered:

- App name: `novacanvas-web`
- App ID: `1:439001638626:web:b42cf86c3be1f232f6a0bb`

### Current provisioning status

- Firestore: created and rules/indexes deployed
- Functions: scaffolded locally, but Firebase requires the Blaze plan before deployment
- Storage: rules file is ready, but a Storage bucket still needs to be initialized once in the Firebase console
