const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const REMINDERS = [
  { daysBefore: 15, label: "15 days before" },
  { daysBefore: 1, label: "1 day before" },
  { daysBefore: 0, label: "Birthday day" },
];

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function sameDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getBirthdayOccurrence(birthdayIso, year) {
  const [_, month, day] = birthdayIso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getDueReminderLines(friend, today) {
  const lines = [];
  const candidateYears = [today.getFullYear(), today.getFullYear() + 1];

  candidateYears.forEach((year) => {
    const birthday = getBirthdayOccurrence(friend.birthday, year);
    REMINDERS.forEach((step) => {
      const reminderDate = addDays(birthday, -step.daysBefore);
      if (sameDate(reminderDate, today)) {
        lines.push(`${friend.name}: ${step.label}`);
      }
    });
  });

  return lines;
}

exports.sendBirthdayReminders = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "Asia/Kolkata",
    region: "asia-south1",
  },
  async () => {
    const today = startOfDay(new Date());
    const dayKey = today.toISOString().slice(0, 10);
    const runRef = db.collection("schedulerRuns").doc(dayKey);
    const runSnap = await runRef.get();
    if (runSnap.exists) {
      logger.info(`Scheduler already ran for ${dayKey}. Skipping duplicate run.`);
      return;
    }

    const tokenSnapshot = await db
      .collection("deviceTokens")
      .where("enabled", "==", true)
      .get();

    const tokensByUserId = new Map();
    tokenSnapshot.forEach((doc) => {
      const data = doc.data();
      if (!data.userId || !data.token) {
        return;
      }
      const current = tokensByUserId.get(data.userId) || [];
      current.push({ token: data.token, docId: doc.id });
      tokensByUserId.set(data.userId, current);
    });

    const usersSnapshot = await db.collection("users").get();
    let totalSent = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userTokens = tokensByUserId.get(userId) || [];
      if (userTokens.length === 0) {
        continue;
      }

      const friendsSnapshot = await userDoc.ref.collection("friends").get();
      const dueLines = [];

      friendsSnapshot.forEach((friendDoc) => {
        const friend = friendDoc.data();
        if (!friend.name || !friend.birthday) {
          return;
        }
        dueLines.push(...getDueReminderLines(friend, today));
      });

      if (dueLines.length === 0) {
        continue;
      }

      const body =
        dueLines.length > 3
          ? `${dueLines.slice(0, 3).join(" | ")} (+${dueLines.length - 3} more)`
          : dueLines.join(" | ");

      const response = await admin.messaging().sendEachForMulticast({
        tokens: userTokens.map((entry) => entry.token),
        notification: {
          title: "Birthday reminders",
          body,
        },
        data: {
          dayKey,
          type: "birthday-reminder",
          url: "/",
        },
      });

      totalSent += response.successCount;

      const staleTokenDeletes = [];
      response.responses.forEach((item, index) => {
        if (item.success) {
          return;
        }
        const code = item.error?.code || "";
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-registration-token")
        ) {
          staleTokenDeletes.push(
            db.collection("deviceTokens").doc(userTokens[index].docId).delete(),
          );
        }
      });
      if (staleTokenDeletes.length > 0) {
        await Promise.all(staleTokenDeletes);
      }
    }

    await runRef.set({
      sentCount: totalSent,
      ranAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`Birthday scheduler completed for ${dayKey}`, { totalSent });
  },
);
