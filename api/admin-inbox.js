const { admin, db, initError, verifyToken } = require('./_firebase');
const { sendEmail } = require('./_email');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    // GET — all threads grouped by userId, sorted by most recent
    if (req.method === 'GET') {
      const snap = await db.collection('sp_inbox').limit(200).get();

      const threadMap = {};
      snap.forEach(d => {
        const data = d.data();
        const uid = data.userId;
        if (!threadMap[uid]) {
          threadMap[uid] = {
            userId: uid,
            refCode: data.refCode || '',
            userEmail: data.userEmail || '',
            userHandle: data.userHandle || '',
            subject: data.subject || '',
            messages: [],
          };
        }
        if (!threadMap[uid].subject && data.subject) threadMap[uid].subject = data.subject;
        threadMap[uid].messages.push({
          id: d.id,
          ...data,
          createdAt: data.createdAt
            ? new Date((data.createdAt._seconds || data.createdAt.seconds || 0) * 1000).toISOString()
            : null,
        });
      });

      // Sort messages within each thread by createdAt ASC
      const threads = Object.values(threadMap).map(thread => {
        thread.messages.sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return ta - tb;
        });

        const unreadCount = thread.messages.filter(m => m.from === 'user' && !m.read).length;
        const lastMsg = thread.messages[thread.messages.length - 1];
        return { ...thread, unreadCount, lastMessageAt: lastMsg?.createdAt || null };
      });

      // Sort threads by most recent message DESC
      threads.sort((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return tb - ta;
      });

      return res.status(200).json({ threads });
    }

    // POST { action:'compose', to, subject, text } — admin starts a new conversation
    if (req.method === 'POST' && req.body?.action === 'compose') {
      const { to, subject, text } = req.body;
      if (!to || !text?.trim()) {
        return res.status(400).json({ error: 'Missing "to" or "text"' });
      }

      const toTrimmed = String(to).trim();
      let targetUserId = null;
      let targetEmail  = '';
      let targetRefCode = '';
      let targetHandle  = '';

      if (toTrimmed.includes('@')) {
        // Look up by email in Firebase Auth
        try {
          const authUser = await admin.auth().getUserByEmail(toTrimmed);
          targetUserId = authUser.uid;
          targetEmail  = toTrimmed;
          // Enrich with Firestore profile
          try {
            const ud = await db.collection('sp_users').doc(targetUserId).get();
            if (ud.exists) { targetRefCode = ud.data().refCode || ''; targetHandle = ud.data().nickname || ''; }
          } catch (_) {}
        } catch (_) {
          // Not a registered user — send email only, no Firestore thread
          await sendEmail({
            to: toTrimmed,
            subject: (subject || 'Message from ScrollPay').trim(),
            html: `
              <h2 style="margin:0 0 8px;">${(subject || 'Message from ScrollPay').trim()}</h2>
              <p style="color:#475569;">${text.trim().replace(/\n/g, '<br>')}</p>
              <p style="margin-top:24px;"><a href="https://scrollpay.app" style="background:#f97316;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open ScrollPay</a></p>
              <p style="color:#94a3b8;font-size:12px;margin-top:32px;">— The ScrollPay Team</p>
            `,
          });
          return res.status(200).json({ ok: true, emailOnly: true });
        }
      } else {
        // Resolve by refCode or handle
        const upper = toTrimmed.toUpperCase();
        let snap = await db.collection('sp_users').where('refCode', '==', upper).limit(1).get();
        if (snap.empty) snap = await db.collection('sp_users').where('nickname', '==', toTrimmed).limit(1).get();
        if (snap.empty) return res.status(404).json({ error: 'User not found. Try their email, ref code, or handle.' });
        const d = snap.docs[0];
        targetUserId  = d.id;
        targetRefCode = d.data().refCode  || '';
        targetHandle  = d.data().nickname || '';
        try {
          const au = await admin.auth().getUser(targetUserId);
          targetEmail = au.email || '';
        } catch (_) {}
      }

      if (!targetUserId) return res.status(400).json({ error: 'Could not resolve user' });

      // Store admin message
      const msgRef = db.collection('sp_inbox').doc();
      await msgRef.set({
        userId: targetUserId,
        refCode: targetRefCode,
        userEmail: targetEmail,
        userHandle: targetHandle,
        subject: (subject || '').trim(),
        from: 'admin',
        text: text.trim(),
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Email notification
      if (targetEmail) {
        sendEmail({
          to: targetEmail,
          subject: (subject || 'New message from ScrollPay').trim(),
          html: `
            <h2 style="margin:0 0 8px;">${(subject || 'You have a new message').trim()}</h2>
            <p style="color:#475569;">${text.trim().replace(/\n/g, '<br>')}</p>
            <p style="margin-top:24px;"><a href="https://scrollpay.app" style="background:#f97316;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open ScrollPay</a></p>
            <p style="color:#94a3b8;font-size:12px;margin-top:32px;">— The ScrollPay Team</p>
          `,
        });
      }

      return res.status(200).json({ id: msgRef.id, ok: true });
    }

    // POST { userId, refCode, text } — admin replies, marks user msgs as read
    if (req.method === 'POST') {
      const { userId, refCode, text } = req.body || {};
      if (!userId || !refCode || !text || !text.trim()) {
        return res.status(400).json({ error: 'Missing userId, refCode, or text' });
      }

      // Fetch all messages for this userId (single where clause)
      const snap = await db.collection('sp_inbox')
        .where('userId', '==', userId)
        .get();

      const batch = db.batch();

      // Mark all from=user messages as read
      snap.forEach(d => {
        const data = d.data();
        if (data.from === 'user' && !data.read) {
          batch.update(d.ref, { read: true });
        }
      });

      // Add admin reply doc
      const newMsgRef = db.collection('sp_inbox').doc();
      batch.set(newMsgRef, {
        userId,
        refCode: refCode.toUpperCase().trim(),
        userEmail: '',
        userHandle: '',
        from: 'admin',
        text: text.trim(),
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await batch.commit();

      // Email user — look up their address from Firebase Auth
      try {
        const authUser = await admin.auth().getUser(userId);
        if (authUser.email) {
          sendEmail({
            to: authUser.email,
            subject: 'New message from ScrollPay',
            html: `
              <h2 style="margin:0 0 8px;">You have a new message</h2>
              <p style="color:#475569;">${text.trim().replace(/\n/g, '<br>')}</p>
              <p style="margin-top:24px;"><a href="https://scrollpay.app" style="background:#f97316;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open ScrollPay</a></p>
              <p style="color:#94a3b8;font-size:12px;margin-top:32px;">— The ScrollPay Team</p>
            `,
          });
        }
      } catch (_) {}

      return res.status(200).json({ id: newMsgRef.id, ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
