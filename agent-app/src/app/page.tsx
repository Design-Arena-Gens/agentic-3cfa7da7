'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { parseWorkbook, type ParsedWorkbook } from '@/lib/excel';
import type { CallResult, DialRecord } from '@/lib/types';

type StatusDictionary = Record<string, CallResult>;

const classNames = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ');

const STATUS_STYLES: Record<
  CallResult['status'],
  { text: string; badge: string }
> = {
  idle: {
    text: 'text-zinc-500',
    badge: 'bg-zinc-200 text-zinc-700',
  },
  calling: {
    text: 'text-sky-600',
    badge: 'bg-sky-100 text-sky-700',
  },
  success: {
    text: 'text-emerald-600',
    badge: 'bg-emerald-100 text-emerald-700',
  },
  error: {
    text: 'text-rose-600',
    badge: 'bg-rose-100 text-rose-700',
  },
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizePhone = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  const raw = String(value).trim();
  if (!raw) return '';

  const preservedPlus = raw.startsWith('+');
  const digits = raw.replace(/[^\d+]/g, '');

  if (preservedPlus) {
    return `+${digits.replace(/[+]/g, '')}`;
  }

  const numeric = digits.replace(/[+]/g, '');

  if (numeric.length === 11 && numeric.startsWith('1')) {
    return `+${numeric}`;
  }

  if (numeric.length === 10) {
    return `+1${numeric}`;
  }

  if (numeric.startsWith('+')) {
    return numeric;
  }

  return numeric;
};

const findRowScript = (record: Record<string, unknown>): string | undefined => {
  const preferredKeys = ['script', 'message', 'notes', 'prompt'];
  for (const [key, value] of Object.entries(record)) {
    const normalized = key.trim().toLowerCase();
    if (preferredKeys.some((candidate) => normalized.includes(candidate))) {
      const text = String(value ?? '').trim();
      if (text) {
        return text;
      }
    }
  }
  return undefined;
};

type FileState =
  | { status: 'idle' }
  | { status: 'loading'; filename: string }
  | { status: 'ready'; filename: string; workbook: ParsedWorkbook };

export default function Home() {
  const [fileState, setFileState] = useState<FileState>({ status: 'idle' });
  const [fromColumn, setFromColumn] = useState<string | null>(null);
  const [toColumn, setToColumn] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<StatusDictionary>({});
  const [error, setError] = useState<string | null>(null);
  const [scriptOverride, setScriptOverride] = useState('');
  const [isAutoDialing, setIsAutoDialing] = useState(false);

  const workbook = fileState.status === 'ready' ? fileState.workbook : null;
  const columns = workbook?.columns ?? [];

  useEffect(() => {
    if (!workbook) return;
    setFromColumn((prev) => prev ?? workbook.suggestedFromColumn ?? null);
    setToColumn((prev) => prev ?? workbook.suggestedToColumn ?? null);
  }, [workbook]);

  const dialRecords = useMemo<DialRecord[]>(() => {
    if (!workbook || !fromColumn || !toColumn) return [];

    return workbook.rows
      .map((row, index) => {
        const rawFrom = row[fromColumn];
        const rawTo = row[toColumn];
        const from = normalizePhone(rawFrom);
        const to = normalizePhone(rawTo);

        if (!from || !to) {
          return null;
        }

        return {
          id: `row-${index}`,
          from,
          to,
          displayFrom: String(rawFrom ?? '').trim() || from,
          displayTo: String(rawTo ?? '').trim() || to,
          rowIndex: index + 1,
          ...row,
        } as DialRecord;
      })
      .filter((entry): entry is DialRecord => Boolean(entry));
  }, [workbook, fromColumn, toColumn]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = event.target.files ?? [];
    if (!file) return;

    setError(null);
    setStatusMap({});
    setFileState({ status: 'loading', filename: file.name });

    try {
      const workbookData = await parseWorkbook(file);
      setFileState({
        status: 'ready',
        filename: file.name,
        workbook: workbookData,
      });
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? parseError.message
          : 'Unable to read workbook',
      );
      setFileState({ status: 'idle' });
    } finally {
      event.target.value = '';
    }
  };

  const setCallStatus = (
    recordId: string,
    update: Omit<CallResult, 'id' | 'timestamp'> & { timestamp?: number },
  ) => {
    const { timestamp, ...rest } = update;
    const nextTimestamp = timestamp ?? Date.now();
    setStatusMap((previous) => ({
      ...previous,
      [recordId]: {
        ...(previous[recordId] ?? {}),
        id: recordId,
        timestamp: nextTimestamp,
        ...rest,
      },
    }));
  };

  const triggerCall = async (record: DialRecord) => {
    if (!record.from || !record.to) {
      setCallStatus(record.id, {
        status: 'error',
        message: 'Missing phone numbers',
      });
      return;
    }

    setCallStatus(record.id, { status: 'calling', message: 'Dialing...' });

    try {
      const payload = {
        from: record.from,
        to: record.to,
        script: findRowScript(record) || scriptOverride.trim(),
      };

      const response = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const { error: apiError } = await response.json().catch(() => ({
          error: 'Call failed',
        }));
        throw new Error(apiError ?? 'Call failed');
      }

      const { sid } = (await response.json()) as { sid?: string };

      setCallStatus(record.id, {
        status: 'success',
        message: sid ? `Call queued (SID: ${sid})` : 'Call queued',
        sid,
      });
    } catch (callError) {
      setCallStatus(record.id, {
        status: 'error',
        message:
          callError instanceof Error ? callError.message : 'Call failed',
      });
    }
  };

  const handleDialAll = async () => {
    if (isAutoDialing) return;
    setIsAutoDialing(true);
    try {
      for (const record of dialRecords) {
        if (statusMap[record.id]?.status === 'success') continue;
        await triggerCall(record);
        await delay(1500);
      }
    } finally {
      setIsAutoDialing(false);
    }
  };

  const selectedRows = dialRecords.length;
  const successfulCalls = Object.values(statusMap).filter(
    (entry) => entry.status === 'success',
  ).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-16 text-slate-100">
      <header className="border-b border-white/10 bg-black/20 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-emerald-400/80">
              Agentic Dialer
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Excel-Powered Outbound Calling
            </h1>
            <p className="mt-2 text-sm text-slate-300/80 sm:text-base">
              Upload an Excel workbook to transform rows into actionable outbound
              calls instantly.
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-300/70">
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2">
              Total rows{' '}
              <span className="font-semibold text-white">
                {selectedRows.toLocaleString()}
              </span>
            </div>
            <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-emerald-300">
              Connected{' '}
              <span className="font-semibold text-emerald-200">
                {successfulCalls.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-10 grid max-w-7xl gap-8 px-6 sm:grid-cols-[360px,1fr] sm:px-10">
        <section className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/30">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-medium text-white">
                  1. Upload Workbook
                </h2>
                <p className="text-sm text-slate-300/80">
                  The first worksheet should include column headers for the
                  caller ID and destination numbers.
                </p>
              </div>
              <label
                htmlFor="workbook-upload"
                className="relative flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed border-white/20 bg-black/20 px-6 py-8 text-center transition hover:border-emerald-400/60 hover:bg-emerald-400/5"
              >
                <input
                  id="workbook-upload"
                  name="workbook-upload"
                  type="file"
                  accept=".xls,.xlsx,.csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-200">
                  Select File
                </span>
                <p className="text-sm text-slate-200">
                  {fileState.status === 'loading'
                    ? `Reading ${fileState.filename}...`
                    : fileState.status === 'ready'
                      ? fileState.filename
                      : 'Drop an Excel file or click to browse'}
                </p>
                <p className="text-xs text-slate-400">
                  Supported formats: .xlsx, .xls, .csv
                </p>
              </label>
              {error ? (
                <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/30">
            <h2 className="text-lg font-medium text-white">2. Column Mapping</h2>
            <p className="mt-1 text-sm text-slate-300/80">
              Confirm the workbook fields that hold the outbound caller ID and
              destination numbers.
            </p>
            <div className="mt-5 space-y-4 text-sm text-slate-100">
              <label className="block space-y-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-300">
                  Caller ID (Twilio Number)
                </span>
                <select
                  value={fromColumn ?? ''}
                  onChange={(event) => setFromColumn(event.target.value || null)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-base outline-none ring-emerald-400/40 focus:ring"
                >
                  <option value="">Select column</option>
                  {columns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-300">
                  Destination Number
                </span>
                <select
                  value={toColumn ?? ''}
                  onChange={(event) => setToColumn(event.target.value || null)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-base outline-none ring-emerald-400/40 focus:ring"
                >
                  <option value="">Select column</option>
                  {columns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/30">
            <h2 className="text-lg font-medium text-white">3. Call Script</h2>
            <p className="mt-1 text-sm text-slate-300/80">
              Provide an optional fallback script. If a row includes a column
              named &ldquo;script&rdquo;, &ldquo;message&rdquo;, or
              &ldquo;notes&rdquo;, that value overrides this field.
            </p>
            <textarea
              value={scriptOverride}
              onChange={(event) => setScriptOverride(event.target.value)}
              placeholder="Introduce yourself, provide context, and state the call-to-action."
              rows={5}
              className="mt-4 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none ring-emerald-400/40 focus:ring"
            />
            <button
              type="button"
              onClick={() => setScriptOverride('')}
              className="mt-3 text-xs text-emerald-300 underline underline-offset-4 hover:text-emerald-200"
            >
              Clear script
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white">
                Call Queue Preview
              </h2>
              <p className="text-sm text-slate-300/80">
                Review detected records, then trigger individual or automated
                dialing.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDialAll}
                disabled={
                  !dialRecords.length || isAutoDialing || !fromColumn || !toColumn
                }
                className={classNames(
                  'rounded-2xl px-5 py-2 text-sm font-semibold transition',
                  dialRecords.length && fromColumn && toColumn
                    ? 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400 disabled:bg-emerald-500/40 disabled:text-emerald-800'
                    : 'bg-zinc-700 text-zinc-300 cursor-not-allowed',
                )}
              >
                {isAutoDialing ? 'Dialing queue…' : 'Dial entire queue'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFileState({ status: 'idle' });
                  setFromColumn(null);
                  setToColumn(null);
                  setStatusMap({});
                  setScriptOverride('');
                  setError(null);
                }}
                className="rounded-2xl border border-white/15 px-5 py-2 text-sm text-slate-300 transition hover:border-white/40 hover:text-white"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/30 shadow-2xl shadow-black/30">
            <div className="max-h-[520px] overflow-y-auto">
              <table className="min-w-full divide-y divide-white/5 text-sm">
                <thead className="bg-white/5 text-left text-xs uppercase tracking-widest text-slate-300">
                  <tr>
                    <th className="px-4 py-3">Row</th>
                    <th className="px-4 py-3">Destination</th>
                    <th className="px-4 py-3">Caller ID</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Details</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {dialRecords.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center text-sm text-slate-400"
                      >
                        Upload a workbook to populate dialable contacts.
                      </td>
                    </tr>
                  ) : (
                    dialRecords.map((record) => {
                      const status = statusMap[record.id]?.status ?? 'idle';
                      const statusMeta = STATUS_STYLES[status];
                      const message = statusMap[record.id]?.message;
                      const sid = statusMap[record.id]?.sid;

                      const metadataEntries = Object.entries(record)
                        .filter(([key]) => !['id', 'from', 'to', 'displayFrom', 'displayTo', 'rowIndex', 'sid'].includes(key))
                        .slice(0, 4);

                      return (
                        <tr key={record.id} className="hover:bg-white/5">
                          <td className="px-4 py-4 font-mono text-xs text-slate-400">
                            #{(record as unknown as { rowIndex?: number }).rowIndex ?? '-'}
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-semibold text-white">
                              {record.displayTo}
                            </p>
                            <p className="text-xs text-slate-400">{record.to}</p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-semibold text-white">
                              {record.displayFrom}
                            </p>
                            <p className="text-xs text-slate-400">{record.from}</p>
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={classNames(
                                'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold',
                                statusMeta.badge,
                              )}
                            >
                              {status.toUpperCase()}
                            </span>
                            {message ? (
                              <p
                                className={classNames(
                                  'mt-2 text-xs',
                                  statusMeta.text,
                                )}
                              >
                                {message}
                              </p>
                            ) : null}
                            {sid ? (
                              <p className="mt-1 text-[11px] text-slate-500">
                                SID: {sid}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-4 text-xs text-slate-300">
                            <div className="space-y-1">
                              {metadataEntries.length === 0 ? (
                                <p className="text-slate-500">No extra metadata</p>
                              ) : (
                                metadataEntries.map(([key, value]) => (
                                  <p key={key}>
                                    <span className="text-slate-500">{key}: </span>
                                    <span className="text-slate-200">
                                      {String(value ?? '') || '—'}
                                    </span>
                                  </p>
                                ))
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => triggerCall(record)}
                              disabled={
                                status === 'calling' ||
                                !record.from ||
                                !record.to ||
                                isAutoDialing
                              }
                              className={classNames(
                                'rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wide transition',
                                status === 'calling'
                                  ? 'bg-zinc-700 text-zinc-300'
                                  : 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-300',
                              )}
                            >
                              {status === 'calling' ? 'Dialing…' : 'Call'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-black/40 px-6 py-5 text-sm text-slate-400">
            <p>
              Tip: ensure all caller IDs are Twilio-verified numbers with voice
              capability. Numbers are normalized to E.164 where possible. Adjust
              regional prefixes directly in the workbook if needed.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
