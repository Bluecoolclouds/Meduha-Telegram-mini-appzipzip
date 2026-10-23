import type { GenjutsuScenarioId } from './intent';

export const genjutsuModes: { id: GenjutsuScenarioId; label: string }[] = [
  { id: 'genjutsu', label: 'Перенос движения' },
  { id: 'object-swap', label: 'Замена объектов' },
  { id: 'restyle', label: 'Новый стиль' },
];

export default function ModeSelector({ value, disabled, onChange }: { value: GenjutsuScenarioId; disabled: boolean; onChange: (next: GenjutsuScenarioId) => void }) {
  return <label className="gj-mode">
    <span className="gj-sr">Режим</span>
    <select data-testid="select-genjutsu-mode" value={value} disabled={disabled} onChange={e => onChange(e.target.value as GenjutsuScenarioId)}>
      {genjutsuModes.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
    </select>
  </label>;
}
