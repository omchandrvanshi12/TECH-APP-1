import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const PORT = Number(process.env.PORT) || 4000

const dbPath = path.join(__dirname, 'data', 'school.db')
const uploadsDir = path.join(__dirname, 'uploads')

fs.mkdirSync(path.dirname(dbPath), { recursive: true })
fs.mkdirSync(uploadsDir, { recursive: true })

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('student', 'teacher'))
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacherId INTEGER NOT NULL,
    title TEXT NOT NULL,
    time TEXT NOT NULL,
    meetingUrl TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live',
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(teacherId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classId INTEGER NOT NULL,
    originalName TEXT NOT NULL,
    storageName TEXT NOT NULL,
    mimeType TEXT NOT NULL,
    url TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(classId) REFERENCES classes(id)
  );
`)

const userColumns = db.prepare('PRAGMA table_info(users)').all()
const emailColumn = userColumns.find((column) => column.name === 'email')
const usersMigratedExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users_migrated'").get()

if (emailColumn?.notnull) {
  db.pragma('foreign_keys = OFF')
  try {
    if (!usersMigratedExists) {
      db.exec(`
        CREATE TABLE users_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          password TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('student', 'teacher')),
          phone TEXT
        );
      `)
    }

    db.exec(`
      INSERT OR IGNORE INTO users_migrated (id, name, email, password, role)
      SELECT id, name, email, password, role FROM users;
      DROP TABLE IF EXISTS users;
      ALTER TABLE users_migrated RENAME TO users;
    `)
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

const migratedUserColumns = db.prepare('PRAGMA table_info(users)').all()
if (!migratedUserColumns.some((column) => column.name === 'phone')) {
  db.exec('ALTER TABLE users ADD COLUMN phone TEXT')
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users(phone) WHERE phone IS NOT NULL')

const normalizePhone = (phone) => phone.replace(/[\s()-]/g, '')

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '_')
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `${uniqueSuffix}-${safeName}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isAllowed = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')
    cb(isAllowed ? null : new Error('Only PDF and image files are allowed.'), isAllowed)
  },
})

app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(uploadsDir))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'Future Shadow Classes API is running' })
})

app.post('/api/signup', (req, res) => {
  const { name, email, phone, password, role } = req.body || {}
  const normalizedEmail = email?.toLowerCase().trim() || null
  const normalizedPhone = phone ? normalizePhone(phone.trim()) : null

  if (!name || (!normalizedEmail && !normalizedPhone) || !password || !role) {
    return res.status(400).json({ message: 'Name, phone or email, password, and role are required.' })
  }

  if (!['student', 'teacher'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role selected.' })
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR phone = ?').get(normalizedEmail, normalizedPhone)
  if (existing) {
    return res.status(409).json({ message: 'An account with this email or phone already exists.' })
  }

  const hashedPassword = bcrypt.hashSync(password, 10)
  const result = db.prepare(
    'INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)',
  ).run(name.trim(), normalizedEmail, normalizedPhone, hashedPassword, role)

  return res.status(201).json({
    message: 'Account created successfully.',
    user: {
      id: result.lastInsertRowid,
      name: name.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      role,
    },
  })
})

app.post('/api/login', (req, res) => {
  const { identifier, password, role } = req.body || {}
  const loginIdentifier = identifier?.trim() || ''
  const normalizedEmail = loginIdentifier.toLowerCase()
  const normalizedPhone = normalizePhone(loginIdentifier)

  if (!loginIdentifier || !password || !role) {
    return res.status(400).json({ message: 'Email or phone, password, and role are required.' })
  }

  const user = db.prepare(
    'SELECT * FROM users WHERE (email = ? OR phone = ?) AND role = ?',
  ).get(normalizedEmail, normalizedPhone, role)
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials.' })
  }

  const validPassword = bcrypt.compareSync(password, user.password)
  if (!validPassword) {
    return res.status(401).json({ message: 'Invalid credentials.' })
  }

  return res.json({
    message: 'Login successful.',
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
  })
})

app.get('/api/classes', (_req, res) => {
  const classes = db.prepare(`
    SELECT c.*, u.name AS teacherName
    FROM classes c
    JOIN users u ON u.id = c.teacherId
    ORDER BY c.createdAt DESC
  `).all()

  const resourceRows = db.prepare('SELECT * FROM resources ORDER BY createdAt DESC').all()
  const resourcesByClass = resourceRows.reduce((map, resource) => {
    if (!map[resource.classId]) {
      map[resource.classId] = []
    }
    map[resource.classId].push({
      id: resource.id,
      originalName: resource.originalName,
      mimeType: resource.mimeType,
      url: resource.url,
    })
    return map
  }, {})

  const result = classes.map((classItem) => ({
    ...classItem,
    teacherName: classItem.teacherName,
    resources: resourcesByClass[classItem.id] || [],
  }))

  res.json({ classes: result })
})

app.patch('/api/classes/:id/end', (req, res) => {
  const { teacherId } = req.body || {}
  const classItem = db.prepare(`
    SELECT id FROM classes WHERE id = ? AND teacherId = ?
  `).get(Number(req.params.id), Number(teacherId))

  if (!classItem) {
    return res.status(404).json({ message: 'Class not found for this teacher.' })
  }

  db.prepare("UPDATE classes SET status = 'ended' WHERE id = ?").run(classItem.id)
  return res.json({ message: 'Class ended successfully.' })
})

app.post('/api/classes/:id/resources', upload.array('files', 10), (req, res) => {
  const { teacherId } = req.body || {}
  const files = req.files || []
  const classItem = db.prepare(`
    SELECT id FROM classes WHERE id = ? AND teacherId = ?
  `).get(Number(req.params.id), Number(teacherId))

  if (!classItem) {
    return res.status(404).json({ message: 'Class not found for this teacher.' })
  }

  const status = db.prepare('SELECT status FROM classes WHERE id = ?').get(classItem.id)
  if (status.status !== 'ended') {
    return res.status(409).json({ message: 'End the class before uploading final notes.' })
  }

  if (files.length === 0) {
    return res.status(400).json({ message: 'Select at least one PDF or image file.' })
  }

  const insertResource = db.prepare(`
    INSERT INTO resources (classId, originalName, storageName, mimeType, url)
    VALUES (?, ?, ?, ?, ?)
  `)

  files.forEach((file) => {
    insertResource.run(classItem.id, file.originalname, file.filename, file.mimetype, `/uploads/${file.filename}`)
  })

  return res.status(201).json({ message: 'Notes uploaded successfully.' })
})

app.post('/api/classes', upload.array('files', 10), (req, res) => {
  const { teacherId, title, time, status } = req.body || {}
  const files = req.files || []

  if (!teacherId || !title || !time) {
    return res.status(400).json({ message: 'Teacher, title, and time are required.' })
  }

  const teacher = db.prepare('SELECT id, role, name FROM users WHERE id = ? AND role = ?').get(Number(teacherId), 'teacher')
  if (!teacher) {
    return res.status(403).json({ message: 'Only teachers can create classes.' })
  }

  const roomCode = `${title.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)}-${crypto.randomBytes(5).toString('hex')}`
  const meetingUrl = `https://meet.jit.si/FutureShadowClasses-${roomCode}#config.toolbarButtons=["microphone","camera","desktop","fullscreen","chat","raisehand","hangup"]`

  const classStatus = ['live', 'upcoming'].includes(status) ? status : 'live'
  const classInsert = db.prepare(`
    INSERT INTO classes (teacherId, title, time, meetingUrl, status)
    VALUES (?, ?, ?, ?, ?)
  `)

  const result = classInsert.run(Number(teacherId), title.trim(), time.trim(), meetingUrl.trim(), classStatus)
  const classId = Number(result.lastInsertRowid)

  if (files.length > 0) {
    const insertResource = db.prepare(`
      INSERT INTO resources (classId, originalName, storageName, mimeType, url)
      VALUES (?, ?, ?, ?, ?)
    `)

    files.forEach((file) => {
      const url = `/uploads/${file.filename}`
      insertResource.run(classId, file.originalname, file.filename, file.mimetype, url)
    })
  }

  return res.status(201).json({
    message: 'Class created successfully.',
    class: {
      id: classId,
      teacherId: Number(teacherId),
      title: title.trim(),
      time: time.trim(),
      meetingUrl: meetingUrl.trim(),
      status: classStatus,
      teacherName: teacher.name,
      resources: files.map((file) => ({
        originalName: file.originalname,
        url: `/uploads/${file.filename}`,
      })),
    },
  })
})

const clientDistDir = path.join(__dirname, 'dist')
if (fs.existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir))
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(clientDistDir, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Future Shadow Classes API running at http://localhost:${PORT}`)
})
