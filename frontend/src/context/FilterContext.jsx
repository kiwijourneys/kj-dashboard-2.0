import React, { createContext, useContext, useState, useCallback } from 'react';
import { startOfMonth, endOfMonth, subDays, startOfQuarter, startOfYear, format } from 'date-fns';

const FilterContext = createContext(null);

const REGIONS = [
  { value: null,              label: 'All Regions' },
  { value: 'Nelson',          label: 'Nelson' },
  { value: 'Central Otago',   label: 'Central Otago' },
  { value: 'West Coast',      label: 'West Coast' },
  { value: 'Kawarau Gorge',   label: 'Kawarau Gorge' },
];

const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7d',    label: '7D' },
  { value: '30d',   label: '30D' },
  { value: 'mtd',   label: 'MTD' },
  { value: 'qtd',   label: 'QTD' },
  { value: 'ytd',   label: 'YTD' },
  { value: 'custom', label: 'Custom' },
];

function fmt(date) {
  return format(date, 'yyyy-MM-dd');
}

function resolvePreset(preset) {
  const now = new Date();
  switch (preset) {
    case 'today': return { startDate: fmt(now), endDate: fmt(now) };
    case '7d':    return { startDate: fmt(subDays(now, 6)), endDate: fmt(now) };
    case '30d':   return { startDate: fmt(subDays(now, 29)), endDate: fmt(now) };
    case 'mtd':   return { startDate: fmt(startOfMonth(now)), endDate: fmt(now) };
    case 'qtd':   return { startDate: fmt(startOfQuarter(now)), endDate: fmt(now) };
    case 'ytd':   return { startDate: fmt(startOfYear(now)), endDate: fmt(now) };
    default:      return { startDate: fmt(startOfMonth(now)), endDate: fmt(now) };
  }
}

export function FilterProvider({ children }) {
  const [region, setRegion] = useState(null);
  const [preset, setPreset] = useState('mtd');
  const [customRange, setCustomRange] = useState(null); // { startDate, endDate }

  const dateRange = preset === 'custom' && customRange
    ? customRange
    : resolvePreset(preset);

  const setDatePreset = useCallback((newPreset) => {
    setPreset(newPreset);
    if (newPreset !== 'custom') setCustomRange(null);
  }, []);

  const setCustomDateRange = useCallback((start, end) => {
    setCustomRange({ startDate: start, endDate: end });
    setPreset('custom');
  }, []);

  // Build query params object ready for API calls
  const queryParams = {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    ...(region ? { region } : {}),
  };

  return (
    <FilterContext.Provider value={{
      region, setRegion,
      preset, setDatePreset,
      dateRange, setCustomDateRange,
      queryParams,
      REGIONS,
      DATE_PRESETS,
    }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within FilterProvider');
  return ctx;
}
