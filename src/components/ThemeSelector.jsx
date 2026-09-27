export default function ThemeSelector({ value, onChange, className = '' }) {
  return (
    <label className={`theme-selector ${className}`.trim()}>
      <span>Theme</span>
      <select aria-label="Color theme" onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  )
}
