let messaging;

export function firebasePushConfigured(env = process.env) {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try { const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); return Boolean(account.project_id === (env.FIREBASE_PROJECT_ID || "dawayo-f8170") && account.client_email && account.private_key); }
    catch { return false; }
  }
  return Boolean(env.GOOGLE_APPLICATION_CREDENTIALS);
}

export async function sendFirebaseNotification({ token, notificationId, customerId, category }, env = process.env) {
  if (!firebasePushConfigured(env)) throw Object.assign(Error("Firebase sender is not configured."), { code: "NOT_CONFIGURED" });
  if (!messaging) {
    const [{ initializeApp, cert, applicationDefault, getApps }, { getMessaging }] = await Promise.all([import("firebase-admin/app"), import("firebase-admin/messaging")]);
    const projectId = env.FIREBASE_PROJECT_ID || "dawayo-f8170";
    const serviceAccount = env.FIREBASE_SERVICE_ACCOUNT_JSON ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) : null;
    if (serviceAccount && serviceAccount.project_id !== projectId) throw Object.assign(Error("Firebase project does not match."), { code: "NOT_CONFIGURED" });
    const app = getApps().find(app => app.name === "dawayo-mobile-push") || initializeApp({ projectId, credential: serviceAccount ? cert(serviceAccount) : applicationDefault() }, "dawayo-mobile-push");
    messaging = getMessaging(app);
  }
  let timer;
  try {
    // Private order/reply details are fetched from the authenticated inbox.
    // A stale offline binding must never reveal them on a phone's lock screen.
    return await Promise.race([
      messaging.send({ token, notification: { title: "DAWAYO", body: "새 알림이 도착했습니다. 앱에서 확인해주세요." },
        data: { notificationId, customerId, category },
        android: { priority: ["ORDER", "SUPPORT"].includes(category) ? "high" : "normal", ttl: 86400000, collapseKey: notificationId, notification: { tag: notificationId, channelId: ({ ORDER: "dawayo_orders", SUPPORT: "dawayo_support", RESTOCK: "dawayo_restock", EVENT: "dawayo_events", MARKETING: "dawayo_marketing" })[category] || "dawayo_events" } } }),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(Object.assign(Error("Push result is unknown."), { code: "PUSH_TIMEOUT" })), 15000); }),
    ]);
  } finally { clearTimeout(timer); }
}
