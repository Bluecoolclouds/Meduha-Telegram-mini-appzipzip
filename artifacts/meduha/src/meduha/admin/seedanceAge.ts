export const LONG_HELD_SEEDANCE_THRESHOLD_SECONDS = 15 * 60;

export function isLongHeldSeedanceReservation(reservationStatus: string | null, ageSeconds: number | null): boolean {
  return reservationStatus === 'held'
    && ageSeconds !== null
    && Number.isFinite(ageSeconds)
    && ageSeconds > LONG_HELD_SEEDANCE_THRESHOLD_SECONDS;
}

export function formatSeedanceReservationAge(ageSeconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, ageSeconds) / 60);
  if (totalMinutes === 0) return 'меньше минуты';
  if (totalMinutes < 60) return `${totalMinutes} мин`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return `${totalHours} ч${minutes ? ` ${minutes} мин` : ''}`;

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days} д${hours ? ` ${hours} ч` : ''}`;
}
