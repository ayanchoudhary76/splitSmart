import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { importApi } from '../api/import';

export default function ImportPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  // State machine & shared state
  const [step, setStep] = useState('upload'); // 'upload' | 'review' | 'confirm'
  const [file, setFile] = useState(null);
  const [usdRate, setUsdRate] = useState('83.50');
  const [preview, setPreview] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [userDecisions, setUserDecisions] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Upload state
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Review state
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState({});

  // Confirm state
  const [showPolicies, setShowPolicies] = useState(false);

  // Expand pending rows by default on review step
  useEffect(() => {
    if (step === 'review' && preview) {
      const pendingRows = preview.rows
        .filter(r => r.proposedAction === 'pending_user_review')
        .reduce((acc, r) => ({ ...acc, [r.rowNumber]: true }), {});
      setExpanded(prev => ({ ...prev, ...pendingRows }));
    }
  }, [step, preview]);

  // Handle file selection
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setError(null);
    }
  };

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('csv', file);
    formData.append('usd_rate', usdRate);

    try {
      const res = await importApi.preview(id, formData);
      setPreview(res.data);
      setSessionId(res.data.session_id);
      setStep('review');
    } catch (err) {
      setError(err.response?.data?.error || 'Preview failed. Please check your file.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);

    const decisions = Object.entries(userDecisions).map(([rowNumber, action]) => ({
      row_number: parseInt(rowNumber, 10),
      action
    }));

    try {
      const res = await importApi.confirm(id, {
        session_id: sessionId,
        user_decisions: decisions
      });
      setResult(res.data);
      setStep('confirm');
    } catch (err) {
      setError(err.response?.data?.error || 'Import confirmation failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = async () => {
    try {
      const res = await importApi.report(id, sessionId);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import-report-${sessionId}.json`;
      a.click();
    } catch (err) {
      console.error('Failed to download report', err);
    }
  };

  // UI Helpers
  const stepCircleClass = (currentStep) => {
    const steps = ['upload', 'review', 'confirm'];
    const curIdx = steps.indexOf(step);
    const thisIdx = steps.indexOf(currentStep);

    if (curIdx > thisIdx || (step === 'confirm' && thisIdx === 2)) {
      return 'bg-green-500 text-white border-green-500'; // completed
    }
    if (curIdx === thisIdx) {
      return 'bg-brand-primary text-white border-brand-primary'; // active
    }
    return 'border-2 border-gray-300 text-gray-300'; // future
  };

  const pendingReviewRows = preview?.rows.filter(r => r.proposedAction === 'pending_user_review') || [];
  const allPendingDecided = pendingReviewRows.every(r => userDecisions[r.rowNumber]);

  return (
    <div className="min-h-screen bg-brand-surface w-full pb-32 relative">
      <div className="max-w-4xl mx-auto px-4 py-8">
        
        {/* Header */}
        <div className="mb-8 text-center max-w-xl mx-auto">
          <div className="flex justify-center items-center gap-3 mb-2">
            <Link to={`/groups/${id}`} className="text-gray-400 hover:text-brand-primary transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-brand-dark">Import expenses from CSV</h1>
          </div>
          <p className="text-sm text-gray-500">
            Upload your expenses_export.csv to import all expenses with automatic anomaly detection.
          </p>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-4 mt-6">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${stepCircleClass('upload')}`}>
                {step !== 'upload' ? '✓' : '1'}
              </div>
              <span className="text-xs font-semibold text-gray-500">Upload</span>
            </div>
            <div className="w-16 h-0.5 bg-gray-200"></div>
            <div className="flex flex-col items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${stepCircleClass('review')}`}>
                {step === 'confirm' ? '✓' : '2'}
              </div>
              <span className="text-xs font-semibold text-gray-500">Review</span>
            </div>
            <div className="w-16 h-0.5 bg-gray-200"></div>
            <div className="flex flex-col items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${stepCircleClass('confirm')}`}>
                {step === 'confirm' ? '✓' : '3'}
              </div>
              <span className="text-xs font-semibold text-gray-500">Done</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="max-w-md mx-auto mb-6 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
            <svg className="h-4 w-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" clipRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: Upload */}
        {step === 'upload' && (
          <div className="max-w-md mx-auto">
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                isDragOver ? 'border-brand-primary bg-brand-primary/5' : 'border-brand-border hover:border-brand-primary hover:bg-brand-primary/5 bg-white'
              }`}
            >
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv" className="hidden" />
              
              {!file ? (
                <>
                  <svg className="h-12 w-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <p className="text-gray-500 font-medium">Drop your CSV here</p>
                  <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                  <p className="text-xs text-gray-300 mt-3">Only .csv files accepted</p>
                </>
              ) : (
                <>
                  <div className="bg-green-100 text-green-600 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-brand-dark font-medium truncate px-4">{file.name}</p>
                  <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                  <p className="text-xs text-brand-primary underline mt-4 cursor-pointer" onClick={(e) => { e.stopPropagation(); setFile(null); fileInputRef.current.value=''; }}>
                    Change file
                  </p>
                </>
              )}
            </div>

            <div className="bg-white rounded-xl border border-brand-border p-4 mt-4 shadow-sm">
              <h3 className="text-sm font-semibold text-brand-dark">💱 USD Exchange Rate</h3>
              <p className="text-xs text-gray-400 mt-0.5 mb-3">Required for expenses in US dollars (Goa trip)</p>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500 font-medium">₹</span>
                <input
                  type="number" step="0.01"
                  value={usdRate}
                  onChange={e => setUsdRate(e.target.value)}
                  className="border border-brand-border rounded-lg pl-8 pr-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-colors"
                />
              </div>
              <p className="text-xs text-gray-400 mt-2 italic">Current rate: ₹83.50 per USD (April 2026 approximate)</p>
            </div>

            <button
              onClick={handlePreview}
              disabled={!file || loading}
              style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #FF6584 100%)' }}
              className="w-full text-white rounded-xl py-3 text-sm font-semibold hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-70 mt-6 flex justify-center items-center"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 mr-2 inline" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Analysing CSV...
                </>
              ) : 'Preview Import'}
            </button>
          </div>
        )}

        {/* STEP 2: Review */}
        {step === 'review' && preview && (
          <div>
            <div className="flex gap-2 flex-wrap mb-6 justify-center">
              <div className="rounded-full px-3 py-1 text-xs font-semibold bg-green-100 text-green-700">
                ✅ {preview.summary.to_import} Clean
              </div>
              <div className="rounded-full px-3 py-1 text-xs font-semibold bg-yellow-100 text-yellow-700">
                ⚠️ {preview.summary.to_import_with_flag} Flagged
              </div>
              <div className="rounded-full px-3 py-1 text-xs font-semibold bg-blue-100 text-blue-700">
                🔄 {preview.summary.to_import_as_settlement} Settlements
              </div>
              <div className="rounded-full px-3 py-1 text-xs font-semibold bg-gray-100 text-gray-500">
                ⏭️ {preview.summary.to_skip} Skipped
              </div>
              <div className="rounded-full px-3 py-1 text-xs font-semibold bg-orange-100 text-orange-700">
                👀 {preview.summary.pending_review} Need review
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              {['all', 'flagged', 'pending', 'skipped'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-sm font-medium px-3 py-1 rounded-lg transition-colors capitalize ${
                    filter === f ? 'bg-brand-primary/10 text-brand-primary' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {f === 'pending' ? 'Need Review' : f}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {preview.rows
                .filter(r => {
                  if (filter === 'all') return true;
                  if (filter === 'flagged') return r.proposedAction === 'imported_with_flag';
                  if (filter === 'pending') return r.proposedAction === 'pending_user_review';
                  if (filter === 'skipped') return r.proposedAction === 'skipped';
                  return true;
                })
                .map((row) => {
                  const isExp = expanded[row.rowNumber];
                  const action = row.proposedAction;

                  let borderColor = 'border-gray-200';
                  let badge = null;

                  if (action === 'imported') {
                    borderColor = 'border-green-200';
                    badge = <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded-full text-xs font-medium">✅ Will import</span>;
                  } else if (action === 'imported_with_flag') {
                    borderColor = 'border-yellow-300';
                    badge = <span className="text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full text-xs font-medium">⚠️ Import + flag</span>;
                  } else if (action === 'imported_as_settlement') {
                    borderColor = 'border-blue-300';
                    badge = <span className="text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full text-xs font-medium">🔄 As settlement</span>;
                  } else if (action === 'skipped') {
                    borderColor = 'border-gray-200 opacity-60';
                    badge = <span className="text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full text-xs font-medium">⏭️ Skipped</span>;
                  } else if (action === 'pending_user_review') {
                    borderColor = 'border-orange-400 ring-1 ring-orange-300';
                    badge = <span className="text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full text-xs font-medium">👀 Review needed</span>;
                  }

                  return (
                    <div key={row.rowNumber} className={`bg-white rounded-xl border ${borderColor} p-4 shadow-sm transition-all`}>
                      <div
                        className="flex justify-between items-center cursor-pointer"
                        onClick={() => setExpanded(prev => ({ ...prev, [row.rowNumber]: !prev[row.rowNumber] }))}
                      >
                        <div className="flex items-center">
                          <span className="text-xs text-gray-400 font-mono">Row {row.rowNumber}</span>
                          <span className="text-sm font-semibold text-brand-dark ml-3">{row.original.description}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {badge}
                          <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExp ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {isExp && (
                        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-500">Date</span>
                              <span className="text-brand-dark font-medium">{row.normalized?.date || row.original.date}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-500">Amount</span>
                              <span className="text-brand-dark font-medium">
                                {row.normalized?.amount} {row.normalized?.currency}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-500">Paid by</span>
                              <span className="text-brand-dark font-medium">{row.normalized?.paid_by_name || row.original.paid_by}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-500">Split type</span>
                              <span className="text-brand-dark font-medium capitalize">{row.normalized?.split_type || row.original.split_type}</span>
                            </div>
                          </div>

                          <div>
                            {row.anomalies && row.anomalies.length > 0 ? (
                              <div className="space-y-2">
                                {row.anomalies.map((a, i) => (
                                  <div key={i} className="flex gap-2 items-start bg-gray-50 p-2 rounded-lg border border-gray-100">
                                    <span className="shrink-0">{a.severity === 'error' ? '❌' : '⚠️'}</span>
                                    <div>
                                      <div className="font-mono text-[10px] text-gray-400">{a.type}</div>
                                      <div className="text-xs text-gray-600 mt-0.5 leading-tight">{a.description}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-gray-400 italic">No anomalies detected.</div>
                            )}

                            {action === 'pending_user_review' && (
                              <div className="mt-4 flex gap-2 items-center">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setUserDecisions(prev => ({...prev, [row.rowNumber]: 'imported'})); }}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                    userDecisions[row.rowNumber] === 'imported'
                                      ? 'bg-green-500 text-white shadow-sm'
                                      : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                                  }`}
                                >
                                  ✅ Import this row
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setUserDecisions(prev => ({...prev, [row.rowNumber]: 'skipped'})); }}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                    userDecisions[row.rowNumber] === 'skipped'
                                      ? 'bg-gray-500 text-white shadow-sm'
                                      : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
                                  }`}
                                >
                                  ⏭️ Skip this row
                                </button>
                                {userDecisions[row.rowNumber] && (
                                  <span className="text-xs text-green-600 font-medium ml-2">Decision recorded ✓</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* STEP 3: Confirm */}
        {step === 'confirm' && result && (
          <div className="max-w-md mx-auto pt-12 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <svg className="h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            
            <h2 className="text-2xl font-bold text-brand-dark mt-6">Import Complete!</h2>
            <p className="text-sm text-gray-500 mt-2">Your expenses have been imported successfully.</p>

            <div className="grid grid-cols-2 gap-3 mt-8 text-left">
              <div className="bg-white rounded-xl border border-brand-border p-4 text-center shadow-sm hover:shadow-md transition-shadow">
                <div className="text-3xl font-bold text-brand-dark">{result.summary.imported}</div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-1 font-semibold">Expenses Added</div>
              </div>
              <div className="bg-white rounded-xl border border-brand-border p-4 text-center shadow-sm hover:shadow-md transition-shadow">
                <div className="text-3xl font-bold text-yellow-600">{result.summary.flagged}</div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-1 font-semibold">Imported with Flags</div>
              </div>
              <div className="bg-white rounded-xl border border-brand-border p-4 text-center shadow-sm hover:shadow-md transition-shadow">
                <div className="text-3xl font-bold text-blue-600">{result.summary.settlements}</div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-1 font-semibold">Settlements Recorded</div>
              </div>
              <div className="bg-white rounded-xl border border-brand-border p-4 text-center shadow-sm hover:shadow-md transition-shadow">
                <div className="text-3xl font-bold text-gray-500">{result.summary.skipped}</div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-1 font-semibold">Rows Skipped</div>
              </div>
            </div>

            <div className="mt-8 text-left">
              <button 
                onClick={() => setShowPolicies(!showPolicies)}
                className="text-sm text-brand-primary font-semibold hover:underline flex items-center gap-1"
              >
                📋 View import policies
                <svg className={`w-4 h-4 transition-transform ${showPolicies ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {showPolicies && result.policies && (
                <div className="mt-3 bg-white border border-brand-border rounded-xl p-4 shadow-sm">
                  <ul className="space-y-3">
                    {Object.entries(result.policies).map(([type, desc], idx) => (
                      <li key={idx} className="text-xs">
                        <span className="font-mono text-gray-500 bg-gray-50 px-1 py-0.5 rounded mr-2">{type}</span>
                        <span className="text-gray-600">{desc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mt-10 space-y-3">
              <Link
                to={`/groups/${id}`}
                className="w-full block text-white rounded-xl py-3 text-sm font-semibold hover:opacity-90 active:scale-[0.99] transition-all"
                style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #FF6584 100%)' }}
              >
                View Expenses &rarr;
              </Link>
              <button
                onClick={handleDownloadReport}
                className="w-full block bg-white border border-brand-border text-brand-primary rounded-xl py-3 text-sm font-semibold hover:bg-brand-primary/5 active:scale-[0.99] transition-all"
              >
                Download Import Report
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sticky Bottom Bar for Review Step */}
      {step === 'review' && preview && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-brand-border shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] p-4 z-10">
          <div className="max-w-4xl mx-auto flex justify-between items-center">
            <div className="text-sm text-gray-500 font-medium">
              Reviewing {preview.summary.total_rows} rows — {preview.summary.pending_review} need your decision
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setStep('upload')}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                &larr; Back
              </button>
              
              <div className="relative group">
                <button
                  onClick={handleConfirm}
                  disabled={!allPendingDecided || loading}
                  className="px-6 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.99] transition-all flex items-center"
                  style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #FF6584 100%)' }}
                >
                  {loading ? (
                    <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : null}
                  Confirm Import &rarr;
                </button>
                {!allPendingDecided && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap">
                    Please review all flagged rows first
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
