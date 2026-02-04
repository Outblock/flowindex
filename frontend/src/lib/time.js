export function formatRelativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const past = diffMs >= 0;
  const absSec = Math.floor(Math.abs(diffMs) / 1000);

  if (absSec < 5) return 'now';

  const units = [
    { name: 'y', seconds: 31536000 },
    { name: 'mo', seconds: 2592000 },
    { name: 'w', seconds: 604800 },
    { name: 'd', seconds: 86400 },
    { name: 'h', seconds: 3600 },
    { name: 'm', seconds: 60 },
    { name: 's', seconds: 1 }
  ];

  const unit = units.find(u => absSec >= u.seconds) || units[units.length - 1];
  const valueNum = Math.floor(absSec / unit.seconds);
  const label = `${valueNum}${unit.name}`;
  return past ? `${label} ago` : `in ${label}`;
}

export function formatAbsoluteTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

