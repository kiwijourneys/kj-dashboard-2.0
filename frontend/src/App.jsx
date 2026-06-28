import React from 'react';
import { BrowserRouter, NavLink, Routes, Route, Navigate } from 'react-router-dom';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#f87171', fontFamily: 'monospace', background: '#0f172a', minHeight: '100vh' }}>
          <h2 style={{ color: '#fbbf24' }}>Render Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{String(this.state.error)}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#94a3b8', marginTop: 12 }}>{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
import { FilterProvider } from './context/FilterContext';
import GlobalFilters from './components/GlobalFilters';
import PasswordGate from './components/PasswordGate';

// Views (lazy-loaded per view)
import PulseCheck         from './views/PulseCheck';
import SalesMarketing     from './views/SalesMarketing';
import MarketingPerformance from './views/MarketingPerformance';
import PaidChannels       from './views/PaidChannels';
import CampaignDetail     from './views/CampaignDetail';
import FunnelView         from './views/FunnelView';
import OrganicSEO         from './views/OrganicSEO';
import SlackAlertConfig   from './views/SlackAlertConfig';

const NAV = [
  { path: '/pulse',     label: 'Pulse Check' },
  { path: '/sales',     label: 'Sales' },
  { path: '/marketing', label: 'Marketing' },
  { path: '/channels',  label: 'Paid Channels' },
  { path: '/campaigns', label: 'Campaigns' },
  { path: '/funnel',    label: 'Funnel' },
  { path: '/organic',   label: 'Organic / SEO' },
  { path: '/alerts',    label: 'Slack Alerts' },
];

export default function App() {
  return (
    <PasswordGate>
    <BrowserRouter>
      <FilterProvider>
        <div className="min-h-screen flex flex-col">
          {/* Top nav */}
          <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6 shadow-sm">
            <img src="/KJ_logo.jpg" alt="Kiwi Journeys" className="h-8 w-auto" />
            <nav className="flex items-center gap-1 overflow-x-auto">
              {NAV.map(n => (
                <NavLink
                  key={n.path}
                  to={n.path}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                      isActive
                        ? 'font-medium'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`
                  }
                  style={({ isActive }) => isActive ? { backgroundColor: '#e8f5d0', color: '#99ca3c' } : {}}
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
          </header>

          {/* Global filters — persists across all views */}
          <GlobalFilters />

          {/* Page content */}
          <main className="flex-1 overflow-auto">
            <ErrorBoundary>
              <Routes>
                <Route path="/"          element={<Navigate to="/pulse" replace />} />
                <Route path="/pulse"     element={<PulseCheck />} />
                <Route path="/sales"     element={<SalesMarketing />} />
                <Route path="/marketing" element={<MarketingPerformance />} />
                <Route path="/summary"   element={<Navigate to="/pulse" replace />} />
                <Route path="/channels"  element={<PaidChannels />} />
                <Route path="/campaigns" element={<CampaignDetail />} />
                <Route path="/funnel"    element={<FunnelView />} />
                <Route path="/organic"   element={<OrganicSEO />} />
                <Route path="/alerts"    element={<SlackAlertConfig />} />
              </Routes>
            </ErrorBoundary>
          </main>
        </div>
      </FilterProvider>
    </BrowserRouter>
    </PasswordGate>
  );
}
