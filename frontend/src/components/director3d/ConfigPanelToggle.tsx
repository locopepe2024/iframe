interface ConfigPanelToggleProps {
  expanded: boolean;
  controls: string;
  expandedLabel: string;
  collapsedLabel: string;
  onToggle: () => void;
}

export function ConfigPanelToggle({ expanded, controls, expandedLabel, collapsedLabel, onToggle }: ConfigPanelToggleProps) {
  const label = expanded ? expandedLabel : collapsedLabel;
  return (
    <button
      type="button"
      className="config-panel-toggle"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {expanded ? <path d="m6 9 6 6 6-6" /> : <path d="m9 6 6 6-6 6" />}
      </svg>
    </button>
  );
}
