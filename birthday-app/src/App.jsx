import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const FRIENDS_STORAGE_KEY = 'birthday-app-friends'
const SENT_REMINDERS_STORAGE_KEY = 'birthday-app-sent-reminders'
const DEVICE_ID_STORAGE_KEY = 'birthday-app-device-id'
const REMINDER_STEPS = [
  { daysBefore: 15, label: '15 days before' },
  { daysBefore: 1, label: '1 day before' },
  { daysBefore: 0, label: 'Birthday today' },
]
const PRIORITY_CIRCLES = [
  { key: 'circle_1', label: 'Circle 1', note: 'Highest priority' },
  { key: 'circle_2', label: 'Circle 2', note: 'Medium priority' },
  { key: 'circle_3', label: 'Circle 3', note: 'Lower priority' },
]

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent)
}

function isStandaloneDisplayMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function getFirebaseClient() {
  const firebase = window.firebase
  const config = window.FIREBASE_CONFIG

  if (!firebase || !config || !config.apiKey) {
    return null
  }

  if (!firebase.apps.length) {
    firebase.initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
    })
  }

  return firebase
}

function getOrCreateDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY)
  if (existing) {
    return existing
  }
  const nextId = crypto.randomUUID()
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, nextId)
  return nextId
}

function normalizePriority(value) {
  if (PRIORITY_CIRCLES.some((item) => item.key === value)) {
    return value
  }
  if (value === 'close_friends') {
    return 'circle_1'
  }
  if (value === 'friends') {
    return 'circle_2'
  }
  return 'circle_2'
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function parseMonthDay(birthdayIso) {
  const [year, month, day] = birthdayIso.split('-').map(Number)
  return { year, month: month - 1, day }
}

function getBirthdayOccurrence(birthdayIso, year) {
  const parsed = parseMonthDay(birthdayIso)
  return new Date(year, parsed.month, parsed.day)
}

function toGoogleAllDayDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function buildGoogleCalendarLink({ friend, eventDate, title, details }) {
  const endDate = addDays(eventDate, 1)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details,
    dates: `${toGoogleAllDayDate(eventDate)}/${toGoogleAllDayDate(endDate)}`,
    recur: 'RRULE:FREQ=YEARLY',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function getCalendarLinks(friend, today) {
  const nextBirthday = getNextBirthdayDate(friend.birthday, today)
  const baseDetails = `Birthday reminder for ${friend.name}.${friend.note ? ` Note: ${friend.note}` : ''}`
  const titlePrefix = `${friend.name} birthday reminder`

  return [
    {
      key: '15',
      label: 'Add 15d',
      href: buildGoogleCalendarLink({
        friend,
        eventDate: addDays(nextBirthday, -15),
        title: `${titlePrefix} (15 days before)`,
        details: `${baseDetails} 15 days before birthday.`,
      }),
    },
    {
      key: '1',
      label: 'Add 1d',
      href: buildGoogleCalendarLink({
        friend,
        eventDate: addDays(nextBirthday, -1),
        title: `${titlePrefix} (1 day before)`,
        details: `${baseDetails} 1 day before birthday.`,
      }),
    },
    {
      key: '0',
      label: 'Add Birthday',
      href: buildGoogleCalendarLink({
        friend,
        eventDate: nextBirthday,
        title: `${titlePrefix} (birthday day)`,
        details: `${baseDetails} Birthday day.`,
      }),
    },
  ]
}

function openAllCalendarLinks(friend, today) {
  const links = getCalendarLinks(friend, today)
  links.forEach((link, index) => {
    setTimeout(() => {
      window.open(link.href, '_blank', 'noopener,noreferrer')
    }, index * 200)
  })
}

function getNextBirthdayDate(birthdayIso, today) {
  const thisYearBirthday = getBirthdayOccurrence(birthdayIso, today.getFullYear())
  return thisYearBirthday >= today
    ? thisYearBirthday
    : getBirthdayOccurrence(birthdayIso, today.getFullYear() + 1)
}

function getDaysAway(targetDate, fromDate) {
  const oneDayMs = 24 * 60 * 60 * 1000
  return Math.round((targetDate - fromDate) / oneDayMs)
}

function getReminderFeed(friends, today) {
  const rows = []

  friends.forEach((friend) => {
    const nextBirthday = getNextBirthdayDate(friend.birthday, today)

    REMINDER_STEPS.forEach((step) => {
      const reminderDate = addDays(nextBirthday, -step.daysBefore)
      const daysAway = getDaysAway(reminderDate, today)

      if (daysAway < 0) {
        return
      }

      rows.push({
        id: `${friend.id}-${nextBirthday.getFullYear()}-${step.daysBefore}`,
        friendId: friend.id,
        name: friend.name,
        label: step.label,
        birthdayDate: nextBirthday,
        reminderDate,
        daysAway,
      })
    })
  })

  return rows.sort((a, b) => a.reminderDate - b.reminderDate)
}

function loadFriends() {
  try {
    const raw = localStorage.getItem(FRIENDS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.map((friend) => ({
      ...friend,
      priority: normalizePriority(friend.priority),
    }))
  } catch {
    return []
  }
}

function loadSentReminders() {
  try {
    const raw = localStorage.getItem(SENT_REMINDERS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function App() {
  const [deviceId] = useState(getOrCreateDeviceId)
  const [friends, setFriends] = useState(loadFriends)
  const [sentReminders, setSentReminders] = useState(loadSentReminders)
  const [permission, setPermission] = useState(
    'Notification' in window ? Notification.permission : 'default',
  )
  const [form, setForm] = useState({ name: '', birthday: '', note: '', priority: 'circle_1' })
  const [editingFriendId, setEditingFriendId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [error, setError] = useState('')
  const [setupMessage, setSetupMessage] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const importInputRef = useRef(null)

  const today = startOfDay(new Date())
  const reminderFeed = useMemo(() => getReminderFeed(friends, today), [friends, today])
  const dueToday = reminderFeed.filter((item) => item.daysAway === 0)
  const upcoming = reminderFeed.slice(0, 10)
  const selectedPriorityInfo = PRIORITY_CIRCLES.find((item) => item.key === form.priority)
  const peopleInSelectedPriority = friends.filter(
    (friend) => normalizePriority(friend.priority) === form.priority,
  )
  const filteredFriends = useMemo(() => {
    const term = searchQuery.trim().toLowerCase()
    return friends.filter((friend) => {
      const matchesSearch =
        term.length === 0 ||
        friend.name.toLowerCase().includes(term) ||
        friend.note.toLowerCase().includes(term)
      const matchesPriority =
        priorityFilter === 'all' || normalizePriority(friend.priority) === priorityFilter
      return matchesSearch && matchesPriority
    })
  }, [friends, priorityFilter, searchQuery])

  useEffect(() => {
    localStorage.setItem(FRIENDS_STORAGE_KEY, JSON.stringify(friends))
  }, [friends])

  useEffect(() => {
    let isCancelled = false

    async function syncFriendsToCloud() {
      const firebase = getFirebaseClient()
      if (!firebase?.firestore) {
        return
      }

      const db = firebase.firestore()
      const userRef = db.collection('users').doc(deviceId)
      const friendsRef = userRef.collection('friends')
      const batch = db.batch()

      batch.set(
        userRef,
        {
          deviceId,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      const existingFriends = await friendsRef.get()
      const incomingIds = new Set(friends.map((friend) => friend.id))
      existingFriends.forEach((doc) => {
        if (!incomingIds.has(doc.id)) {
          batch.delete(doc.ref)
        }
      })

      friends.forEach((friend) => {
        batch.set(
          friendsRef.doc(friend.id),
          {
            ...friend,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      })

      await batch.commit()
      if (!isCancelled) {
        setSyncMessage('Friend records synced to cloud.')
      }
    }

    syncFriendsToCloud().catch(() => {
      if (!isCancelled) {
        setSyncMessage('Cloud sync pending. Check Firebase Firestore setup.')
      }
    })

    return () => {
      isCancelled = true
    }
  }, [deviceId, friends])

  useEffect(() => {
    localStorage.setItem(SENT_REMINDERS_STORAGE_KEY, JSON.stringify(sentReminders))
  }, [sentReminders])

  useEffect(() => {
    if (!('Notification' in window) || permission !== 'granted' || dueToday.length === 0) {
      return
    }

    const newKeys = {}

    dueToday.forEach((item) => {
      if (sentReminders[item.id]) {
        return
      }

      new Notification(`Birthday Reminder: ${item.name}`, {
        body: `${item.label}. Birthday on ${formatDate(item.birthdayDate)}.`,
      })
      newKeys[item.id] = true
    })

    if (Object.keys(newKeys).length > 0) {
      setSentReminders((current) => ({ ...current, ...newKeys }))
    }
  }, [dueToday, permission, sentReminders])

  function requestPermission() {
    if (!('Notification' in window)) {
      setError('Notifications are not supported on this device/browser.')
      return
    }

    if (isIosDevice() && !isStandaloneDisplayMode()) {
      setError(
        'On iPhone, install this app to Home Screen first, then open from that icon and tap Enable notifications.',
      )
      return
    }

    const firebase = getFirebaseClient()
    if (!firebase?.messaging) {
      setError('Firebase is not configured yet. Add your Firebase keys in public/firebase-config.js.')
      return
    }

    Notification.requestPermission()
      .then(async (result) => {
        setPermission(result)
        if (result !== 'granted') {
          setError('Please allow notifications to get reminder alerts.')
          return
        }

        const registration = await navigator.serviceWorker.register('/sw.js')
        const messaging = firebase.messaging()
        const token = await messaging.getToken({
          vapidKey: window.FIREBASE_CONFIG?.vapidKey,
          serviceWorkerRegistration: registration,
        })

        if (!token) {
          setError('Unable to get push token. Check Firebase Web Push certificate key (VAPID).')
          return
        }

        localStorage.setItem('birthday-app-fcm-token', token)
        setSetupMessage('Push is enabled for this device.')
        setError('')

        if (firebase.firestore) {
          const db = firebase.firestore()
          await db.collection('deviceTokens').doc(token).set(
            {
              token,
              userId: deviceId,
              enabled: true,
              platform: navigator.platform || 'unknown',
              userAgent: navigator.userAgent,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
        }
      })
      .catch(() => {
        setError('Notification setup failed. Please check Firebase config and browser permissions.')
      })
  }

  function handleInputChange(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  function saveFriend(event) {
    event.preventDefault()
    const trimmedName = form.name.trim()

    if (!trimmedName || !form.birthday) {
      setError('Please enter both friend name and birthday.')
      return
    }

    if (editingFriendId) {
      setFriends((current) =>
        current.map((friend) =>
          friend.id === editingFriendId
            ? {
                ...friend,
                name: trimmedName,
                birthday: form.birthday,
                note: form.note.trim(),
                priority: form.priority,
              }
            : friend,
        ),
      )
    } else {
      setFriends((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          name: trimmedName,
          birthday: form.birthday,
          note: form.note.trim(),
          priority: form.priority,
        },
      ])
    }

    setForm({ name: '', birthday: '', note: '', priority: 'circle_1' })
    setEditingFriendId(null)
    setError('')
  }

  function removeFriend(friendId) {
    setFriends((current) => current.filter((friend) => friend.id !== friendId))
    if (editingFriendId === friendId) {
      setForm({ name: '', birthday: '', note: '', priority: 'circle_1' })
      setEditingFriendId(null)
    }
  }

  function startEditing(friend) {
    setForm({
      name: friend.name,
      birthday: friend.birthday,
      note: friend.note,
      priority: normalizePriority(friend.priority),
    })
    setEditingFriendId(friend.id)
    setError('')
  }

  function cancelEditing() {
    setForm({ name: '', birthday: '', note: '', priority: 'circle_1' })
    setEditingFriendId(null)
    setError('')
  }

  function exportBackup() {
    const payload = {
      exportedAt: new Date().toISOString(),
      friends,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const dateTag = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `birthday-backup-${dateTag}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function importBackup(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const sourceFriends = Array.isArray(parsed) ? parsed : parsed.friends

      if (!Array.isArray(sourceFriends)) {
        throw new Error('Invalid backup format')
      }

      const normalized = sourceFriends
        .filter(
          (friend) =>
            friend &&
            typeof friend.id === 'string' &&
            typeof friend.name === 'string' &&
            typeof friend.birthday === 'string',
        )
        .map((friend) => ({
          id: friend.id,
          name: friend.name.trim(),
          birthday: friend.birthday,
          note: typeof friend.note === 'string' ? friend.note : '',
          priority: normalizePriority(friend.priority),
        }))

      if (normalized.length === 0) {
        throw new Error('Backup has no valid friends')
      }

      setFriends(normalized)
      setEditingFriendId(null)
      setForm({ name: '', birthday: '', note: '', priority: 'circle_1' })
      setError('')
    } catch {
      setError('Import failed. Please use a valid backup JSON file.')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Birthday Reminder</p>
        <h1>Never miss your close friends' birthdays</h1>
        <p className="hero-subtitle">
          Reminders are prepared automatically for 15 days before, 1 day before, and birthday day.
        </p>
        <button className="notify-btn" onClick={requestPermission} type="button">
          {permission === 'granted' ? 'Notifications enabled' : 'Enable notifications'}
        </button>
        {setupMessage && <p className="success-text">{setupMessage}</p>}
        {syncMessage && <p className="success-text">{syncMessage}</p>}
        {error && <p className="error-text">{error}</p>}
      </section>

      <section className="card add-friend-card">
        <h2>Add a Friend</h2>
        <form className="friend-form" onSubmit={saveFriend}>
          <div className="form-main">
            <div className="form-fields">
              <label>
                Name
                <input
                  name="name"
                  placeholder="e.g. Rohan"
                  value={form.name}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                Birthday
                <input
                  name="birthday"
                  type="date"
                  value={form.birthday}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                Note (optional)
                <input
                  name="note"
                  placeholder="Gift idea, nickname..."
                  value={form.note}
                  onChange={handleInputChange}
                />
              </label>
            </div>
            <fieldset className="priority-picker">
              <legend>Priority Circle</legend>
              <div className="priority-wheel">
                <button
                  type="button"
                  className={`priority-btn ring-outer${form.priority === 'circle_3' ? ' active' : ''}`}
                  onClick={() => setForm((current) => ({ ...current, priority: 'circle_3' }))}
                  aria-pressed={form.priority === 'circle_3'}
                >
                  <span className="circle-number">3</span>
                </button>
                <button
                  type="button"
                  className={`priority-btn ring-middle${form.priority === 'circle_2' ? ' active' : ''}`}
                  onClick={() => setForm((current) => ({ ...current, priority: 'circle_2' }))}
                  aria-pressed={form.priority === 'circle_2'}
                >
                  <span className="circle-number">2</span>
                </button>
                <button
                  type="button"
                  className={`priority-btn ring-inner${form.priority === 'circle_1' ? ' active' : ''}`}
                  onClick={() => setForm((current) => ({ ...current, priority: 'circle_1' }))}
                  aria-pressed={form.priority === 'circle_1'}
                >
                  <span className="circle-number circle-word">Birthday</span>
                </button>
              </div>
              <p className="priority-note">
                {PRIORITY_CIRCLES.find((item) => item.key === form.priority)?.note}
              </p>
              <div className="priority-people">
                <p className="priority-people-title">
                  People in {selectedPriorityInfo?.label}
                </p>
                {peopleInSelectedPriority.length === 0 ? (
                  <p className="muted small-muted">No people in this priority yet.</p>
                ) : (
                  <ul className="priority-people-list">
                    {peopleInSelectedPriority.map((friend) => (
                      <li key={friend.id}>
                        {friend.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </fieldset>
          </div>
          <div className="form-actions">
            <button type="submit">{editingFriendId ? 'Update Friend' : 'Save Friend'}</button>
            {editingFriendId && (
              <button className="secondary-btn" type="button" onClick={cancelEditing}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Due Today ({formatDate(today)})</h2>
        {dueToday.length === 0 ? (
          <p className="muted">No reminders for today.</p>
        ) : (
          <ul className="list">
            {dueToday.map((item) => (
              <li key={item.id} className="due">
                <strong>{item.name}</strong>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Upcoming Reminders</h2>
        {upcoming.length === 0 ? (
          <p className="muted">Add friends to see your timeline.</p>
        ) : (
          <ul className="list">
            {upcoming.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <p>
                    {item.label} on {formatDate(item.reminderDate)}
                  </p>
                </div>
                <span className="badge">
                  {item.daysAway} day{item.daysAway === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Friends ({friends.length})</h2>
        <div className="friends-controls">
          <input
            type="text"
            placeholder="Search name or note"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <select
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <option value="all">All priorities</option>
            {PRIORITY_CIRCLES.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="backup-actions">
          <button className="secondary-btn" type="button" onClick={exportBackup}>
            Export Backup
          </button>
          <button
            className="secondary-btn"
            type="button"
            onClick={() => importInputRef.current?.click()}
          >
            Import Backup
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden-input"
            onChange={importBackup}
          />
        </div>
        {filteredFriends.length === 0 ? (
          <p className="muted">No friends saved yet.</p>
        ) : (
          <ul className="list">
            {filteredFriends.map((friend) => (
              <li key={friend.id}>
                <div>
                  <strong>{friend.name}</strong>
                  <p>
                    Birthday: {formatDate(getBirthdayOccurrence(friend.birthday, today.getFullYear()))}
                    {friend.note ? ` - ${friend.note}` : ''}
                  </p>
                  <div className="calendar-links">
                    <button
                      type="button"
                      className="calendar-link calendar-link-button"
                      onClick={() => openAllCalendarLinks(friend, today)}
                    >
                      Add All 3
                    </button>
                    {getCalendarLinks(friend, today).map((link) => (
                      <a
                        key={link.key}
                        className="calendar-link"
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                </div>
                <div className="row-actions">
                  <button className="edit-btn" type="button" onClick={() => startEditing(friend)}>
                    Edit
                  </button>
                  <button
                    className="remove-btn"
                    type="button"
                    onClick={() => removeFriend(friend.id)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer className="footer-note">
        Keep this app opened at least once daily so reminders can be checked reliably in the browser.
      </footer>
    </main>
  )
}

export default App
