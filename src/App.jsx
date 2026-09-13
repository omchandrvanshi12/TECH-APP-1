import { useState } from 'react'
import './App.css'

const defaultForm = { name: '', email: '', phone: '', password: '' }

function App() {
  const [authMode, setAuthMode] = useState('login')
  const [role, setRole] = useState('student')
  const [formData, setFormData] = useState(defaultForm)
  const [currentUser, setCurrentUser] = useState(null)
  const [classes, setClasses] = useState([])
  const [selectedClass, setSelectedClass] = useState(null)
  const [newClass, setNewClass] = useState({
    title: '',
    time: '',
    meetingUrl: '',
    status: 'live',
  })
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [classFiles, setClassFiles] = useState({})
  const [notice, setNotice] = useState('')

  const fetchClasses = async () => {
    try {
      const response = await fetch('/api/classes')
      const data = await response.json()
      setClasses(data.classes || [])
    } catch (error) {
      console.error('Failed to load classes', error)
    }
  }

  const handleInputChange = (event) => {
    const { name, value } = event.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleAuthSubmit = async (event) => {
    event.preventDefault()

    const identifier = formData.identifier.trim()
    const password = formData.password.trim()

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, role }),
      })

      const data = await response.json()

      if (!response.ok) {
        setNotice(data.message || 'Login failed.')
        return
      }

      setCurrentUser(data.user)
      setNotice('')
      setFormData(defaultForm)
      await fetchClasses()
    } catch {
      setNotice('Login failed. Please try again.')
    }
  }

  const handleSignupSubmit = async (event) => {
    event.preventDefault()

    if (!formData.name || (!formData.email && !formData.phone) || !formData.password) {
      setNotice('Please fill all fields.')
      return
    }

    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email.trim().toLowerCase(),
          phone: formData.phone.trim(),
          password: formData.password.trim(),
          role,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setNotice(data.message || 'Sign up failed.')
        return
      }

      setNotice('Account created successfully. Please login now.')
      setAuthMode('login')
      setFormData(defaultForm)
    } catch {
      setNotice('Sign up failed. Please try again.')
    }
  }

  const handleCreateClass = async (event) => {
    event.preventDefault()

    if (!newClass.title || !newClass.time) {
      setNotice('Please fill class title and time.')
      return
    }

    const payload = new FormData()
    payload.append('teacherId', String(currentUser.id))
    payload.append('title', newClass.title)
    payload.append('time', newClass.time)
    payload.append('status', newClass.status)

    uploadedFiles.forEach((file) => payload.append('files', file))

    try {
      const response = await fetch('/api/classes', {
        method: 'POST',
        body: payload,
      })

      const data = await response.json()

      if (!response.ok) {
        setNotice(data.message || 'Could not create class.')
        return
      }

      setNewClass({ title: '', time: '', meetingUrl: '', status: 'live' })
      setUploadedFiles([])
      setNotice('Class created successfully.')
      await fetchClasses()
    } catch {
      setNotice('Class creation failed.')
    }
  }

  const handleFileUpload = (event) => {
    setUploadedFiles(Array.from(event.target.files || []))
  }

  const endClass = async (classId) => {
    try {
      const response = await fetch(`/api/classes/${classId}/end`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: currentUser.id }),
      })
      const data = await response.json()
      setNotice(data.message || 'Class could not be ended.')
      if (response.ok) await fetchClasses()
    } catch {
      setNotice('Could not connect to the server.')
    }
  }

  const uploadClassNotes = async (classId) => {
    const files = classFiles[classId] || []
    if (files.length === 0) {
      setNotice('Please select notes or files first.')
      return
    }

    const payload = new FormData()
    payload.append('teacherId', String(currentUser.id))
    files.forEach((file) => payload.append('files', file))

    try {
      const response = await fetch(`/api/classes/${classId}/resources`, {
        method: 'POST',
        body: payload,
      })
      const data = await response.json()
      setNotice(data.message || 'Notes could not be uploaded.')
      if (response.ok) {
        setClassFiles((previous) => ({ ...previous, [classId]: [] }))
        await fetchClasses()
      }
    } catch {
      setNotice('Could not connect to the server.')
    }
  }

  const renderTeacherClass = (item) => (
    <div key={item.id} className="class-card">
      <div className="class-topline">
        <span className={`tag ${item.status}`}>{item.status}</span>
        <strong>{item.time}</strong>
      </div>
      <h3>{item.title}</h3>
      <p>{item.meetingUrl}</p>

      <div className="notes-block">
        <span>Uploaded files:</span>
        <ul>
          {item.resources.length > 0 ? (
            item.resources.map((resource) => (
              <li key={resource.id}>
                <a href={resource.url} target="_blank" rel="noreferrer">
                  {resource.originalName}
                </a>
              </li>
            ))
          ) : (
            <li>No files uploaded yet</li>
          )}
        </ul>
      </div>

      <div className="class-followup">
        {item.status !== 'ended' && (
          <button className="end-class-btn" onClick={() => endClass(item.id)}>
            End class
          </button>
        )}
        {item.status === 'ended' && <strong className="ended-label">Class ended</strong>}
        {item.status === 'ended' && (
          <>
            <label className="notes-upload-label">
              Add class notes
              <input
                type="file"
                multiple
                accept=".pdf,image/*"
                onChange={(event) =>
                  setClassFiles((previous) => ({
                    ...previous,
                    [item.id]: Array.from(event.target.files || []),
                  }))
                }
              />
            </label>
            {(classFiles[item.id] || []).length > 0 && (
              <button className="upload-notes-btn" onClick={() => uploadClassNotes(item.id)}>
                Upload notes
              </button>
            )}
          </>
        )}
      </div>

      {item.status === 'ended' ? (
        <span className="ended-link">Live link closed</span>
      ) : (
        <a href={item.meetingUrl} target="_blank" rel="noreferrer" className="link-btn">
          Open Jitsi meeting
        </a>
      )}
    </div>
  )

  if (currentUser && currentUser.role === 'teacher') {
    const teacherClasses = classes.filter((item) => item.teacherId === currentUser.id)
    const activeClasses = teacherClasses.filter((item) => item.status !== 'ended')
    const endedClasses = teacherClasses.filter((item) => item.status === 'ended')

    return (
      <div className="app-shell teacher-shell">
        <header className="portal-header">
          <div>
            <p className="eyebrow">Teacher portal</p>
            <h1>Classroom panel</h1>
          </div>
          <button className="ghost-btn" onClick={() => setCurrentUser(null)}>
            Logout
          </button>
        </header>

        <main className="teacher-layout">
          <section className="panel create-panel">
            <h2>Create live class</h2>
            <form onSubmit={handleCreateClass} className="class-form">
              <label>
                Class title
                <input
                  type="text"
                  value={newClass.title}
                  onChange={(event) =>
                    setNewClass((prev) => ({ ...prev, title: event.target.value }))
                  }
                  placeholder="Physics / English / Biology"
                />
              </label>

              <label>
                Time
                <input
                  type="text"
                  value={newClass.time}
                  onChange={(event) =>
                    setNewClass((prev) => ({ ...prev, time: event.target.value }))
                  }
                  placeholder="Today, 4:00 PM"
                />
              </label>

              <p className="form-help">
                A secure meeting link will be generated automatically. Use Jitsi&apos;s Share screen button during class.
              </p>

              <label>
                Status
                <select
                  value={newClass.status}
                  onChange={(event) =>
                    setNewClass((prev) => ({ ...prev, status: event.target.value }))
                  }
                >
                  <option value="live">Live now</option>
                  <option value="upcoming">Upcoming</option>
                </select>
              </label>

              <label>
                Upload notes / PDF / images
                <input type="file" multiple accept=".pdf,image/*" onChange={handleFileUpload} />
              </label>

              {uploadedFiles.length > 0 && (
                <div className="uploaded-files">
                  {uploadedFiles.map((file) => (
                    <span key={`${file.name}-${file.size}`}>{file.name}</span>
                  ))}
                </div>
              )}

              {notice && <p className="notice">{notice}</p>}

              <button type="submit" className="primary-btn full-width">
                Publish class
              </button>
            </form>
          </section>

          <section className="panel class-panel">
            <h2>Live classes</h2>
            <div className="class-list">
              {activeClasses.length > 0 ? (
                activeClasses.map(renderTeacherClass)
              ) : (
                <p className="empty-state">No live or upcoming class is available.</p>
              )}
            </div>

            <div className="completed-classes">
              <h2>Completed classes</h2>
              <div className="class-list">
                {endedClasses.length > 0 ? (
                  endedClasses.map(renderTeacherClass)
                ) : (
                  <p className="empty-state">Ended classes will appear here.</p>
                )}
              </div>
            </div>
          </section>
        </main>

        {selectedClass && (
          <div className="modal">
            <div className="modal-card meeting-modal-card">
              <div className="modal-header">
                <h3>{selectedClass.title}</h3>
                <button className="ghost-btn" onClick={() => setSelectedClass(null)}>
                  Close class
                </button>
              </div>
              <div className="meeting-frame-wrap">
                <iframe
                  title={`${selectedClass.title} live meeting`}
                  src={selectedClass.meetingUrl}
                  allow="camera; microphone; fullscreen; display-capture; autoplay"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (currentUser && currentUser.role === 'student') {
    const liveClasses = classes.filter((item) => item.status === 'live')

    return (
      <div className="app-shell student-shell">
        <header className="portal-header">
          <div>
            <p className="eyebrow">Student portal</p>
            <h1>My learning</h1>
          </div>
          <button className="ghost-btn" onClick={() => setCurrentUser(null)}>
            Logout
          </button>
        </header>

        <main className="student-layout">
          <section className="panel">
            <h2>Live classes</h2>
            {liveClasses.length === 0 ? (
              <p className="empty-state">No live class is available right now.</p>
            ) : (
              <div className="class-list">
                {liveClasses.map((item) => (
                  <div key={item.id} className="class-card student-card">
                    <div className="class-topline">
                      <span className="tag live">live</span>
                      <strong>{item.time}</strong>
                    </div>
                    <h3>{item.title}</h3>
                    <p>Teacher: {item.teacherName}</p>
                    <div className="student-actions">
                      <a href={item.meetingUrl} target="_blank" rel="noreferrer" className="primary-btn">
                        Open class in Jitsi
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Class notes and files</h2>
            {classes.flatMap((item) => item.resources).length === 0 ? (
              <p className="empty-state">No notes uploaded yet.</p>
            ) : (
              <ul className="resource-list">
                {classes.flatMap((item) =>
                  item.resources.map((resource) => (
                    <li key={resource.id}>
                      <span>{resource.originalName}</span>
                      <a href={resource.url} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </li>
                  )),
                )}
              </ul>
            )}
          </section>
        </main>

        {selectedClass && (
          <div className="modal">
            <div className="modal-card">
              <div className="modal-header">
                <h3>{selectedClass.title}</h3>
                <button className="ghost-btn" onClick={() => setSelectedClass(null)}>
                  Close
                </button>
              </div>

              <div className="modal-body">
                <div className="video-box">
                  <iframe
                    title={`${selectedClass.title} live meeting`}
                    src={selectedClass.meetingUrl}
                    allow="camera; microphone; fullscreen; display-capture; autoplay"
                  />
                </div>

                <div className="notes-box">
                  <h4>Files in this class</h4>
                  <ul>
                    {selectedClass.resources.length > 0 ? (
                      selectedClass.resources.map((resource) => (
                        <li key={resource.id}>
                          <a href={resource.url} target="_blank" rel="noreferrer">
                            {resource.originalName}
                          </a>
                        </li>
                      ))
                    ) : (
                      <li>No files uploaded for this class.</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-topbar">
          <div className="brand-mark">F</div>
          <div>
            <p className="brand-name">Future Shadow Classes</p>
            <span className="brand-subtitle">Teacher & Student login</span>
          </div>
        </div>

        <div className="role-switcher">
          <button
            className={role === 'student' ? 'role-btn active' : 'role-btn'}
            onClick={() => setRole('student')}
          >
            Student
          </button>
          <button
            className={role === 'teacher' ? 'role-btn active' : 'role-btn'}
            onClick={() => setRole('teacher')}
          >
            Teacher
          </button>
        </div>

        <div className="auth-tabs">
          <button
            className={authMode === 'login' ? 'tab active' : 'tab'}
            onClick={() => setAuthMode('login')}
          >
            Login
          </button>
          <button
            className={authMode === 'signup' ? 'tab active' : 'tab'}
            onClick={() => setAuthMode('signup')}
          >
            Sign up
          </button>
        </div>

        <form className="auth-form" onSubmit={authMode === 'login' ? handleAuthSubmit : handleSignupSubmit}>
          {authMode === 'signup' && (
            <label>
              Full name
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="Enter full name"
              />
            </label>
          )}

          {authMode === 'login' && (
            <label>
              Email or phone number
              <input
                type="text"
                name="identifier"
                value={formData.identifier || ''}
                onChange={handleInputChange}
                placeholder="Email or +91 98765 43210"
              />
            </label>
          )}

          {authMode === 'signup' && (
            <>
              <label>
                Email (optional)
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="name@example.com"
                />
              </label>
              <label>
                Phone number (optional)
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="+91 98765 43210"
                />
              </label>
            </>
          )}

          <label>
            Password
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleInputChange}
              placeholder="Enter password"
            />
          </label>

          {notice && <p className="notice">{notice}</p>}

          <button type="submit" className="primary-btn full-width">
            {authMode === 'login' ? `Login as ${role}` : `Create ${role} account`}
          </button>
        </form>
      </div>
    </div>
  )
}

export default App
