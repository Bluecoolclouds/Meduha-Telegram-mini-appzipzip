import { useState } from 'react';

export function ProfileAvatar({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials = name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toLocaleUpperCase('ru-RU') || 'Г';
  if (!photoUrl || failedUrl === photoUrl) return <div className="m-avatar-guest" role="img" aria-label={`Профиль: ${name}`}>{initials}</div>;
  return <img className="m-avatar-photo" src={photoUrl} alt={`Аватар ${name} из Telegram`} referrerPolicy="no-referrer" onError={() => setFailedUrl(photoUrl)} />;
}
