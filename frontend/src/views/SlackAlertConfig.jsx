import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAlertConfig, testSlack, triggerWeeklySummary } from '../api';

function Toggle({ enabled, onChange }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        enabled ? 'bg-green-600' : 'bg-gray-700'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function AlertRow({ label, description, enabled, onToggle, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-gray-800 last:border-0">
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-200">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        {enabled && children && <div className="mt-3">{children}</div>}
      </div>
      <Toggle enabled={enabled} onChange={onToggle} />
    </div>
  );
}

function ThresholdInput({ label, value, onChange, prefix = 'NZD $' }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500 w-32">{label}</label>
      <span className="text-gray-500 text-sm">{prefix}</span>
      <input
        type="number"
        min="0"
        step="50"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-24 bg-gray-800 border border-gray-700 rounded-md text-sm text-gray-200 px-2 py-1 focus:outline-none focus:border-green-500"
      />
    </div>
  );
}

export default function SlackAlertConfig() {
  const configQ = useQuery({ queryKey: ['alertConfig'], queryFn: fetchAlertConfig });

  const [webhookUrl, setWebhookUrl]         = useState('');
  const [testStatus, setTestStatus]         = useState(null); // null | 'sending' | 'ok' | 'error'

  const [noLeadsEnabled, setNoLeadsEnabled]     = useState(true);
  const [spendEnabled, setSpendEnabled]         = useState(true);
  const [spendThreshGoogle, setSpendThreshGoogle] = useState(500);
  const [spendThreshMeta, setSpendThreshMeta]   = useState(500);
  const [cplEnabled, setCplEnabled]             = useState(true);
  const [cplThreshold, setCplThreshold]         = useState(200);
  const [weeklyEnabled, setWeeklyEnabled]       = useState(true);
  const [noRegionEnabled, setNoRegionEnabled]   = useState(true);

  async function handleTestSlack() {
    setTestStatus('sending');
    try {
      await testSlack();
      setTestStatus('ok');
    } catch {
      setTestStatus('error');
    }
    setTimeout(() => setTestStatus(null), 3000);
  }

  async function handleWeeklyNow() {
    try {
      await triggerWeeklySummary();
      alert('Weekly summary sent!');
    } catch (e) {
      alert('Failed: ' + e.message);
    }
  }

  const isConfigured = configQ.data?.slackWebhookConfigured;

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Webhook config */}
      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-white">Slack Webhook</h3>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Incoming Webhook URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder={isConfigured ? '(configured via .env)' : 'https://hooks.slack.com/services/…'}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-md text-sm text-gray-200 px-3 py-2 focus:outline-none focus:border-green-500"
            />
            <button
              onClick={handleTestSlack}
              disabled={testStatus === 'sending'}
              className="px-4 py-2 rounded-md bg-green-700 hover:bg-green-600 disabled:opacity-50 text-sm text-white font-medium transition-colors"
            >
              {testStatus === 'sending' ? 'Sending…' : testStatus === 'ok' ? '✓ Sent' : testStatus === 'error' ? '✗ Error' : 'Test'}
            </button>
          </div>
          {!isConfigured && (
            <p className="text-xs text-yellow-500">No webhook URL configured in .env — set SLACK_WEBHOOK_URL to enable alerts.</p>
          )}
        </div>

        <div className="text-xs text-gray-600">
          Timezone: <span className="text-gray-400">NZST (UTC+12 / UTC+13 DST)</span>
        </div>

        <div>
          <button
            onClick={handleWeeklyNow}
            className="text-xs text-gray-400 hover:text-gray-200 underline"
          >
            Send weekly summary now (for testing)
          </button>
        </div>
      </div>

      {/* Alert rules */}
      <div className="card">
        <h3 className="text-sm font-semibold text-white mb-2">Alert Rules</h3>

        <AlertRow
          label="No new Multi Day enquiries today"
          description="Fires at 6pm NZST if zero new Multi Day enquiries were created today."
          enabled={noLeadsEnabled}
          onToggle={setNoLeadsEnabled}
        />

        <AlertRow
          label="Daily spend exceeds threshold"
          description="Fires at 6pm NZST if Google Ads or Meta daily spend exceeds your threshold."
          enabled={spendEnabled}
          onToggle={setSpendEnabled}
        >
          <div className="space-y-2">
            <ThresholdInput label="Google Ads" value={spendThreshGoogle} onChange={setSpendThreshGoogle} />
            <ThresholdInput label="Meta Ads"   value={spendThreshMeta}   onChange={setSpendThreshMeta} />
          </div>
        </AlertRow>

        <AlertRow
          label="CPL exceeds threshold"
          description="Fires when today's calculated CPL (all channels) exceeds the threshold."
          enabled={cplEnabled}
          onToggle={setCplEnabled}
        >
          <ThresholdInput label="CPL threshold" value={cplThreshold} onChange={setCplThreshold} />
        </AlertRow>

        <AlertRow
          label="Weekly summary"
          description="Fires Monday 8am NZST with prior week KPIs: spend, enquiries, CPL, closed won, ROAS."
          enabled={weeklyEnabled}
          onToggle={setWeeklyEnabled}
        />

        <AlertRow
          label="New deals with no region set"
          description="Fires daily if any HubSpot deals are missing a location/region value."
          enabled={noRegionEnabled}
          onToggle={setNoRegionEnabled}
        />
      </div>

      <p className="text-xs text-gray-600 italic">
        Note: Alert thresholds above are for UI reference. To persist these server-side, add the corresponding ALERT_* environment variables to your .env file and restart the backend.
      </p>
    </div>
  );
}
