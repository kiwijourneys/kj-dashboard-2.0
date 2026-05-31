import React from 'react';

export default function ErrorWidget({ message, onRetry }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 py-8 text-center">
      <span className="text-2xl">⚠️</span>
      <p className="text-sm text-red-400">{message || 'Failed to load data'}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 text-xs text-gray-400 hover:text-gray-200 underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}
