export type CharacterMetricBody = {
  heightM: string;
  bodyWidthM: string;
  reachM: string;
  armSpanM: string;
  legToTorsoRatio: string;
  shoulderToHeadWidthRatio: string;
  headToHeightRatio: string;
};

export default function CharacterMetricBodyFields({ value, onChange }: {
  value: CharacterMetricBody;
  onChange: (key: keyof CharacterMetricBody, next: string) => void;
}) {
  return <fieldset className="min-w-0 rounded border border-glass-border p-3">
    <legend className="px-1 text-xs font-medium text-foreground">米制尺寸（可选）</legend>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {([['heightM', '身高'], ['bodyWidthM', '体宽'], ['reachM', '单臂可达距离'], ['armSpanM', '臂展']] as const).map(([key, label]) =>
        <label key={key} className="min-w-0 text-xs text-text-secondary">{label}（米）
          <input aria-label={`${label}（米）`} type="number" min="0.01" max="5" step="0.01" value={value[key]}
            onChange={event => onChange(key, event.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-glass-border bg-surface p-2 text-sm text-foreground" />
        </label>)}
      {([['legToTorsoRatio', '腿长/躯干长'], ['shoulderToHeadWidthRatio', '肩宽/头宽'], ['headToHeightRatio', '头高/身高']] as const).map(([key, label]) =>
        <label key={key} className="min-w-0 text-xs text-text-secondary">{label}
          <input aria-label={label} type="number" min="0.01" max={key === 'headToHeightRatio' ? '0.99' : '9.99'} step="0.01"
            value={value[key]} onChange={event => onChange(key, event.target.value)}
            className="mt-1 min-h-11 w-full rounded border border-glass-border bg-surface p-2 text-sm text-foreground" />
        </label>)}
    </div>
    <p className="mt-2 text-xs text-text-muted">腿长为胯点到地面，躯干长为胯点到肩线；头高为头顶到下巴。未知值留空，保存角色设计时一并保存。</p>
  </fieldset>;
}
