import {onCall} from "firebase-functions/v2/https";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

admin.initializeApp();

export const healthCheck = onCall(
  {
    region: "us-central1",
  },
  (request) => {
    return {
      ok: true,
      projectId: admin.app().options.projectId ?? "novacanvas",
      authenticated: request.auth != null,
      timestamp: new Date().toISOString(),
    };
  },
);

export const bootstrapUserProfile = onDocumentCreated(
  {
    document: "users/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }

    const data = snapshot.data();
    if (data.createdAt) {
      return;
    }

    await snapshot.ref.set(
      {
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
  },
);
