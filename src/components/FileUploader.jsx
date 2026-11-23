/**
 * FileUploader.jsx
 *
 * Renders a click-to-upload area. Calls onFile(file) with the chosen File;
 * the parent decides how to read it (CSV text, PDF bytes...).
 */

import { useRef } from 'react'

export default function FileUploader({ label, description, accept, onFile, hasData, fileName, busy }) {
  const inputRef = useRef(null)

  function handleFile(e) {
    const file = e.target.files[0]
    if (file) onFile(file)
    e.target.value = '' // allow re-uploading the same file
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && inputRef.current?.click()}
      style={{
        border: `2px dashed ${hasData ? '#1e5c2c' : '#CECECE'}`,
        borderRadius: 6,
        padding: '1rem 1.2rem',
        background: hasData ? '#f0faf2' : '#fafafa',
        cursor: busy ? 'wait' : 'pointer',
      }}
    >
      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }} onChange={handleFile} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: 20 }}>{hasData ? '✅' : '📄'}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#131A48' }}>{label}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
            {busy ? 'Reading file…' : hasData ? fileName : description}
          </div>
        </div>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontWeight: 700,
            color: hasData ? '#1e5c2c' : '#FF5800',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {hasData ? 'Change' : 'Upload'}
        </span>
      </div>
    </div>
  )
}
