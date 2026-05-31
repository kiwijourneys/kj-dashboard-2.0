import React from 'react';

const MAP = {
  ENABLED:  { cls: 'badge-active',  label: 'Active'  },
  PAUSED:   { cls: 'badge-paused',  label: 'Paused'  },
  REMOVED:  { cls: 'badge-ended',   label: 'Ended'   },
  ARCHIVED: { cls: 'badge-ended',   label: 'Archived' },
  // Meta statuses
  ACTIVE:   { cls: 'badge-active',  label: 'Active'  },
  DELETED:  { cls: 'badge-ended',   label: 'Deleted' },
};

export default function StatusBadge({ status }) {
  const s = String(status || '').toUpperCase();
  const { cls, label } = MAP[s] || { cls: 'badge-ended', label: status || '?' };
  return <span className={cls}>{label}</span>;
}
