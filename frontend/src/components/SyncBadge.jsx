import React from 'react';
import { formatDistanceToNow } from 'date-fns';

export default function SyncBadge({ source, timestamp }) {
  if (!timestamp) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />
        {source}: never synced
      </span>
    );
  }
  const ago = formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
      {source}: {ago}
    </span>
  );
}
