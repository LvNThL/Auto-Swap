export default function ThemeSelector({ value, onChange, className = '' }) {
  return (
    <label className={`theme-selector ${className}`.trim()}>
      <select aria-label="Theme" onChange={(event) => onChange(event.target.value)} title="Choose theme" value={value}>
        <optgroup label="Appearance">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </optgroup>
        <optgroup label="Color palettes">
          <option value="neon">Neon</option>
          <option value="azure-trade">Azure Trade</option>
          <option value="sage-clay">Sage &amp; Clay</option>
          <option value="slate-pro">Slate Pro</option>
          <option value="twilight-modern">Twilight Modern</option>
        </optgroup>
      </select>
    </label>
  )
}
