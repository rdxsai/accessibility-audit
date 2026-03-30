import React, { useState } from 'react';
import type { Violation } from '@shared/messages';

export default function App() {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [scanning, setScanning] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    chrome.runtime.sendMessage(
      { type: 'SCAN_REQUEST', payload: { scope: 'full' } },
      (response: { violations: Violation[] }) => {
        setViolations(response?.violations ?? []);
        setScanning(false);
      }
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <header className="mb-4">
        <h1 className="text-lg font-bold text-gray-900">WCAG Scout</h1>
        <p className="text-sm text-gray-500">AI Accessibility Scanner</p>
      </header>

      <button
        onClick={handleScan}
        disabled={scanning}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {scanning ? 'Scanning...' : 'Scan Page'}
      </button>

      <div className="mt-4">
        {violations.length === 0 ? (
          <p className="text-sm text-gray-400 text-center mt-8">
            {scanning ? 'Analyzing page...' : 'Click "Scan Page" to start'}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">
              Found {violations.length} violation{violations.length !== 1 && 's'}
            </p>
            {violations.map((v, i) => (
              <div
                key={`${v.id}-${i}`}
                className="rounded-md border border-gray-200 bg-white p-3"
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${impactColor(v.impact)}`}>
                    {v.impact}
                  </span>
                  <span className="text-sm font-medium text-gray-800">{v.id}</span>
                </div>
                <p className="mt-1 text-xs text-gray-600">{v.description}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {v.nodes.length} element{v.nodes.length !== 1 && 's'} affected
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function impactColor(impact: string): string {
  switch (impact) {
    case 'critical': return 'bg-red-100 text-red-700';
    case 'serious':  return 'bg-orange-100 text-orange-700';
    case 'moderate': return 'bg-yellow-100 text-yellow-700';
    case 'minor':    return 'bg-blue-100 text-blue-700';
    default:         return 'bg-gray-100 text-gray-700';
  }
}
