import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { groupsApi } from '../api/groups';
import { expensesApi } from '../api/expenses';

export default function GroupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [balances, setBalances] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [activeTab, setActiveTab] = useState('expenses');
  const [loading, setLoading] = useState(true);

  const [expandedExpenseId, setExpandedExpenseId] = useState(null);
  const [expenseSplits, setExpenseSplits] = useState({});

  // Modals state
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  
  // Add Expense form
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expCurrency, setExpCurrency] = useState('INR');
  const [expExchange, setExpExchange] = useState('83.50');
  const [expDate, setExpDate] = useState(new Date().toISOString().split('T')[0]);
  const [expPaidBy, setExpPaidBy] = useState('');
  const [expSplitType, setExpSplitType] = useState('equal');
  const [expNotes, setExpNotes] = useState('');
  const [expParticipants, setExpParticipants] = useState([]);
  const [expError, setExpError] = useState(null);
  const [expSubmitting, setExpSubmitting] = useState(false);

  // Settle form
  const [settleFrom, setSettleFrom] = useState('');
  const [settleTo, setSettleTo] = useState('');
  const [settleAmount, setSettleAmount] = useState('');
  const [settleDate, setSettleDate] = useState(new Date().toISOString().split('T')[0]);
  const [settleNotes, setSettleNotes] = useState('');
  const [settleSubmitting, setSettleSubmitting] = useState(false);

  // Add member form
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberDate, setNewMemberDate] = useState(new Date().toISOString().split('T')[0]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [groupRes, expensesRes, balancesRes, settlementsRes] = await Promise.all([
        groupsApi.get(id),
        expensesApi.list(id, { limit: 100 }),
        expensesApi.balances(id),
        expensesApi.settlements(id),
      ]);

      setGroup(groupRes.data.group);
      setMembers(groupRes.data.members || []);

      const combined = [
        ...(expensesRes.data.expenses || []),
        ...(settlementsRes.data.settlements || []).map(s => ({ ...s, is_settlement: true }))
      ].sort((a, b) => new Date(b.date) - new Date(a.date));

      setExpenses(combined);
      setBalances(balancesRes.data.balances || []);
      setTransactions(balancesRes.data.transactions || []);
      
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line
  }, [id]);

  const handleExpandExpense = async (expId) => {
    if (expandedExpenseId === expId) {
      setExpandedExpenseId(null);
      return;
    }
    setExpandedExpenseId(expId);
    if (!expenseSplits[expId]) {
      try {
        const { data } = await expensesApi.get(id, expId);
        setExpenseSplits(prev => ({ ...prev, [expId]: data.splits }));
      } catch (err) {}
    }
  };

  const handleOpenAddExpense = () => {
    const activeMembers = members.filter(m => m.is_active);
    setExpParticipants(activeMembers.map(m => ({
      user_id: m.user_id,
      participant_name: m.name,
      included: true,
      share_amount: '',
      percent: '',
      shares: '1'
    })));
    setExpPaidBy(user.id.toString());
    setShowAddExpense(true);
  };

  const handleAddExternal = () => {
    setExpParticipants(prev => [
      ...prev,
      { user_id: null, participant_name: '', included: true, share_amount: '', percent: '', shares: '1' }
    ]);
  };

  const submitAddExpense = async (e) => {
    e.preventDefault();
    setExpError(null);
    setExpSubmitting(true);
    
    try {
      const participantsToSubmit = expParticipants
        .filter(p => p.included && p.participant_name.trim() !== '')
        .map(p => {
          const payload = {
            user_id: p.user_id,
            participant_name: p.user_id ? undefined : p.participant_name.trim()
          };
          if (expSplitType === 'unequal') payload.share_amount = parseFloat(p.share_amount);
          if (expSplitType === 'percentage') payload.percent = parseFloat(p.percent);
          if (expSplitType === 'share') payload.shares = parseInt(p.shares, 10);
          return payload;
        });

      await expensesApi.create(id, {
        description: expDesc,
        amount: parseFloat(expAmount),
        currency: expCurrency,
        exchange_rate: expCurrency === 'USD' ? parseFloat(expExchange) : undefined,
        paid_by_user_id: expPaidBy === 'external' ? null : parseInt(expPaidBy, 10),
        split_type: expSplitType,
        date: expDate,
        notes: expNotes,
        participants: participantsToSubmit
      });

      setShowAddExpense(false);
      setExpDesc(''); setExpAmount(''); setExpNotes(''); setExpSplitType('equal');
      fetchData();
    } catch (err) {
      setExpError(err.response?.data?.error || 'Failed to create expense');
    } finally {
      setExpSubmitting(false);
    }
  };

  const openSettle = (t) => {
    setSettleFrom(t.from_user_id);
    setSettleTo(t.to_user_id);
    setSettleAmount(t.amount);
    setSettleNotes('');
    setSettleDate(new Date().toISOString().split('T')[0]);
    setShowSettle(true);
  };

  const submitSettle = async (e) => {
    e.preventDefault();
    setSettleSubmitting(true);
    try {
      await expensesApi.settle(id, {
        from_user_id: parseInt(settleFrom, 10),
        to_user_id: parseInt(settleTo, 10),
        amount: parseFloat(settleAmount),
        currency: 'INR',
        date: settleDate,
        notes: settleNotes
      });
      setShowSettle(false);
      fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setSettleSubmitting(false);
    }
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    try {
      await groupsApi.addMember(id, { email: newMemberEmail, joined_at: newMemberDate });
      setNewMemberEmail('');
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add member');
    }
  };

  const handleRemoveMember = async (userId) => {
    if (!window.confirm('Are you sure you want to remove this member?')) return;
    try {
      await groupsApi.removeMember(id, userId, { left_at: new Date().toISOString().split('T')[0] });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove member');
    }
  };

  const formatMoney = (amount) => Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const formatDateStr = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };
  const formatBadgeDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) return <div className="min-h-screen bg-brand-surface flex justify-center items-center">Loading...</div>;
  if (!group) return <div className="min-h-screen bg-brand-surface flex justify-center items-center">Group not found</div>;

  return (
    <div className="min-h-screen bg-brand-surface w-full">
      <div className="max-w-5xl mx-auto px-4 py-6">
        
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="flex items-center gap-3">
              <Link to="/" className="text-gray-400 hover:text-brand-primary transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-2xl font-bold text-brand-dark">{group.name}</h1>
            </div>
            {group.description && <p className="text-sm text-gray-400 mt-1 ml-9">{group.description}</p>}
          </div>
          <div className="flex gap-3">
            <Link
              to={`/groups/${id}/import`}
              className="border border-brand-primary text-brand-primary rounded-xl px-4 py-2 text-sm font-medium hover:bg-brand-primary/5 transition-colors"
            >
              Import CSV
            </Link>
            <button
              onClick={handleOpenAddExpense}
              style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #FF6584 100%)' }}
              className="rounded-xl px-4 py-2 text-sm text-white font-medium hover:opacity-90 transition-opacity shadow-sm"
            >
              Add Expense
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 border-b border-brand-border mb-6">
          {['expenses', 'balances', 'members'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-semibold capitalize transition-colors ${
                activeTab === tab
                  ? 'border-b-2 border-brand-primary text-brand-primary'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* TAB 1: Expenses */}
        {activeTab === 'expenses' && (
          <div>
            {expenses.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                No expenses yet. Add your first expense or import a CSV.
              </div>
            ) : (
              expenses.map((exp) => {
                const isExpanded = expandedExpenseId === exp.id;
                const splits = expenseSplits[exp.id] || [];

                if (exp.is_settlement) {
                  return (
                    <div key={`settlement-${exp.id}`} className="bg-white rounded-2xl p-4 shadow-sm border border-brand-border mb-3 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="bg-gray-100 p-2 rounded-full text-gray-500">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </div>
                        <div>
                          <div className="text-xs bg-brand-surface text-gray-500 rounded-lg px-2 py-1 font-mono inline-block">
                            {formatBadgeDate(exp.date)}
                          </div>
                          <div className="text-sm text-gray-400 italic mt-1">Settlement</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-brand-dark">{exp.from_name} &rarr; {exp.to_name}</div>
                        <div className="text-lg font-bold text-gray-700">₹{formatMoney(exp.amount)}</div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={`expense-${exp.id}`}
                    onClick={() => handleExpandExpense(exp.id)}
                    className={`bg-white rounded-2xl p-4 shadow-sm border border-brand-border mb-3 cursor-pointer transition-colors ${
                      isExpanded ? 'bg-gray-50' : 'hover:shadow-md'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-brand-surface text-gray-500 rounded-lg px-2 py-1 font-mono">
                            {formatBadgeDate(exp.date)}
                          </span>
                          {exp.notes?.includes('csv') || exp.description.toLowerCase().includes('import') ? (
                            <span className="text-xs text-gray-400 italic">CSV import</span>
                          ) : null}
                        </div>
                        <h3 className="font-semibold text-brand-dark text-sm mt-1">{exp.description}</h3>
                        <p className="text-xs text-gray-400">Paid by {exp.paid_by_name || 'Someone external'}</p>
                        <div className="mt-2">
                          <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                            exp.split_type === 'equal' ? 'bg-blue-50 text-blue-600' :
                            exp.split_type === 'percentage' ? 'bg-purple-50 text-purple-600' :
                            exp.split_type === 'unequal' ? 'bg-orange-50 text-orange-600' :
                            'bg-teal-50 text-teal-600'
                          }`}>
                            {exp.split_type}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-brand-dark text-lg">₹{formatMoney(exp.amount_inr)}</div>
                        {exp.currency !== 'INR' && (
                          <div className="text-xs text-gray-400">({exp.amount} {exp.currency})</div>
                        )}
                        {/* Summary for current user if expanded/fetched, or if paid_by_user_id === user.id */}
                        <div className="mt-2">
                          {exp.paid_by_user_id === user.id ? (
                            <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded">you paid</span>
                          ) : null}
                          {splits.length > 0 && splits.find(s => s.user_id === user.id) && (
                            <div className={`text-xs mt-1 ${exp.paid_by_user_id === user.id ? 'text-gray-500' : 'text-red-400'}`}>
                              Your share: ₹{formatMoney(splits.find(s => s.user_id === user.id).share_amount)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-brand-border">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Split Details</div>
                        {splits.length === 0 ? (
                          <div className="text-sm text-gray-400 animate-pulse">Loading splits...</div>
                        ) : (
                          <div className="space-y-2">
                            {splits.map((s, i) => (
                              <div key={i} className="flex justify-between items-center text-sm">
                                <span className="text-brand-dark">{s.user_name || s.participant_name}</span>
                                <span className="text-gray-500">
                                  ₹{formatMoney(s.share_amount)} <span className="text-xs text-gray-400 ml-1">({s.split_detail})</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 2: Balances */}
        {activeTab === 'balances' && (
          <div className="space-y-8">
            <section>
              <h3 className="text-lg font-semibold text-brand-dark mb-4">Who owes whom</h3>
              {transactions.length === 0 ? (
                <div className="bg-white rounded-2xl p-6 text-center border border-brand-border shadow-sm flex flex-col items-center">
                  <div className="bg-green-100 text-green-600 rounded-full p-3 mb-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="font-semibold text-brand-dark">All settled up! 🎉</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {transactions.map((t, idx) => (
                    <div key={idx} className="bg-white rounded-2xl p-4 shadow-sm border border-brand-border flex justify-between items-center">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center font-bold text-sm shrink-0">
                          {t.from_name.charAt(0)}{t.to_name.charAt(0)}
                        </div>
                        <div>
                          <div className="text-brand-dark text-sm">
                            <span className="font-semibold">{t.from_name}</span> owes <span className="font-semibold">{t.to_name}</span>
                          </div>
                          <div className="font-bold text-brand-dark text-lg mt-0.5">₹{formatMoney(t.amount)}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => openSettle(t)}
                        className="bg-brand-surface text-brand-primary border border-brand-primary/30 px-4 py-1.5 rounded-xl text-sm font-medium hover:bg-brand-primary hover:text-white transition-colors"
                      >
                        Settle up
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-lg font-semibold text-brand-dark mb-4">Individual balances</h3>
              <div className="bg-white rounded-2xl shadow-sm border border-brand-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 uppercase tracking-wider text-xs">
                      <tr>
                        <th className="px-6 py-3 font-medium">Name</th>
                        <th className="px-6 py-3 font-medium text-right">Paid</th>
                        <th className="px-6 py-3 font-medium text-right">Owed</th>
                        <th className="px-6 py-3 font-medium text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {balances.map((b) => (
                        <tr key={b.user_id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 font-medium text-brand-dark">{b.user_name}</td>
                          <td className="px-6 py-4 text-right text-gray-500">₹{formatMoney(b.total_paid)}</td>
                          <td className="px-6 py-4 text-right text-gray-500">₹{formatMoney(b.total_owed)}</td>
                          <td className="px-6 py-4 text-right font-semibold">
                            {b.net_balance > 0 && <span className="text-green-600">+₹{formatMoney(b.net_balance)}</span>}
                            {b.net_balance < 0 && <span className="text-red-500">-₹{formatMoney(Math.abs(b.net_balance))}</span>}
                            {b.net_balance === 0 && <span className="text-gray-400">Settled</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {balances.filter(b => b.external_shares > 0).map(b => (
                <div key={`ext-${b.user_id}`} className="mt-4 flex gap-3 bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
                  <span>💡</span>
                  <span>
                    <strong>{b.user_name}</strong> paid ₹{formatMoney(b.external_shares)} on behalf of external participants. Collect directly — not tracked in group balance.
                  </span>
                </div>
              ))}
            </section>
          </div>
        )}

        {/* TAB 3: Members */}
        {activeTab === 'members' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-brand-border overflow-hidden">
              <div className="divide-y divide-gray-100">
                {members.map(m => (
                  <div key={m.user_id} className="p-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-brand-surface text-brand-primary flex items-center justify-center font-bold">
                        {m.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-brand-dark">{m.name}</span>
                          {m.user_id === group.admin_user_id && (
                            <span className="bg-brand-primary/10 text-brand-primary text-xs px-2 py-0.5 rounded font-medium">Admin</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400">{m.email}</div>
                        <div className="flex gap-2 mt-1">
                          <span className="text-xs text-gray-400">Joined {formatDateStr(m.joined_at)}</span>
                          {m.left_at && (
                            <span className="bg-gray-100 text-gray-400 text-xs rounded-full px-2">Left {formatDateStr(m.left_at)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {m.is_active && user.id === group.admin_user_id && m.user_id !== user.id && (
                      <button
                        onClick={() => handleRemoveMember(m.user_id)}
                        className="text-red-400 hover:text-red-600 text-xs font-medium"
                      >
                        Remove
                      </button>
                    )}
                    {m.is_active && m.user_id === user.id && (
                      <button
                        onClick={() => handleRemoveMember(user.id)}
                        className="text-red-400 hover:text-red-600 text-xs font-medium"
                      >
                        Leave
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-sm border border-brand-border">
              <h3 className="font-semibold text-brand-dark mb-3">Add Member</h3>
              <form onSubmit={handleAddMember} className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider font-semibold">Email</label>
                  <input
                    type="email"
                    required
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    className="w-full bg-brand-surface border border-brand-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                    placeholder="friend@example.com"
                  />
                </div>
                <div className="w-40">
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider font-semibold">Joined on</label>
                  <input
                    type="date"
                    required
                    value={newMemberDate}
                    onChange={(e) => setNewMemberDate(e.target.value)}
                    className="w-full bg-brand-surface border border-brand-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
                  />
                </div>
                <button
                  type="submit"
                  className="bg-brand-dark text-white px-4 py-2 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Add
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      
      {/* Settle Modal */}
      {showSettle && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="font-bold text-brand-dark text-lg mb-4">Settle up</h2>
            <form onSubmit={submitSettle} className="space-y-4">
              <div className="flex items-center gap-2">
                <select disabled value={settleFrom} className="flex-1 bg-gray-50 border border-brand-border rounded-xl px-3 py-2 text-sm opacity-70">
                  <option value={settleFrom}>{members.find(m => m.user_id === settleFrom)?.name || settleFrom}</option>
                </select>
                <span className="text-gray-400">&rarr;</span>
                <select disabled value={settleTo} className="flex-1 bg-gray-50 border border-brand-border rounded-xl px-3 py-2 text-sm opacity-70">
                  <option value={settleTo}>{members.find(m => m.user_id === settleTo)?.name || settleTo}</option>
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Amount (₹)</label>
                <input
                  type="number" step="0.01" min="0.01" required
                  value={settleAmount}
                  onChange={(e) => setSettleAmount(e.target.value)}
                  className="w-full border border-brand-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-primary/40"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Date</label>
                <input
                  type="date" required
                  value={settleDate}
                  onChange={(e) => setSettleDate(e.target.value)}
                  className="w-full border border-brand-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-primary/40"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Notes</label>
                <input
                  type="text"
                  value={settleNotes}
                  onChange={(e) => setSettleNotes(e.target.value)}
                  placeholder="e.g. UPI payment"
                  className="w-full border border-brand-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-primary/40"
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setShowSettle(false)} className="px-4 py-2 text-sm font-medium text-gray-500">Cancel</button>
                <button type="submit" disabled={settleSubmitting} className="bg-brand-primary text-white rounded-xl px-5 py-2 text-sm font-medium">
                  {settleSubmitting ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="font-bold text-brand-dark text-lg mb-4">Add Expense</h2>
            <form onSubmit={submitAddExpense} className="space-y-4">
              
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Description</label>
                <input type="text" required value={expDesc} onChange={e => setExpDesc(e.target.value)} className="w-full border border-brand-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-primary/40" placeholder="Dinner at Olive" />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Amount</label>
                  <input type="number" step="0.01" required value={expAmount} onChange={e => setExpAmount(e.target.value)} className="w-full border border-brand-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-primary/40" />
                </div>
                <div className="w-24">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Currency</label>
                  <select value={expCurrency} onChange={e => setExpCurrency(e.target.value)} className="w-full border border-brand-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-primary/40">
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              {expCurrency === 'USD' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Exchange rate (₹ per $)</label>
                  <input type="number" step="0.01" required value={expExchange} onChange={e => setExpExchange(e.target.value)} className="w-full border border-brand-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-primary/40" />
                </div>
              )}

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Date</label>
                  <input type="date" required value={expDate} onChange={e => setExpDate(e.target.value)} className="w-full border border-brand-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-primary/40" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Paid by</label>
                  <select value={expPaidBy} onChange={e => setExpPaidBy(e.target.value)} className="w-full border border-brand-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-primary/40">
                    {members.filter(m => m.is_active).map(m => (
                      <option key={m.user_id} value={m.user_id}>{m.name}</option>
                    ))}
                    <option value="external">Someone else (external)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Split type</label>
                <select value={expSplitType} onChange={e => setExpSplitType(e.target.value)} className="w-full border border-brand-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-primary/40">
                  <option value="equal">Equal</option>
                  <option value="unequal">Unequal (exact amounts)</option>
                  <option value="percentage">Percentage</option>
                  <option value="share">Shares</option>
                </select>
              </div>

              <div className="bg-brand-surface p-3 rounded-xl border border-brand-border space-y-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Split Participants</div>
                {expParticipants.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={p.included}
                      onChange={e => {
                        const newP = [...expParticipants];
                        newP[idx].included = e.target.checked;
                        setExpParticipants(newP);
                      }}
                      className="rounded text-brand-primary focus:ring-brand-primary/40 w-4 h-4"
                    />
                    {p.user_id ? (
                      <span className="text-sm font-medium flex-1">{p.participant_name}</span>
                    ) : (
                      <input
                        type="text"
                        placeholder="External name"
                        value={p.participant_name}
                        onChange={e => {
                          const newP = [...expParticipants];
                          newP[idx].participant_name = e.target.value;
                          setExpParticipants(newP);
                        }}
                        className="border border-brand-border rounded px-2 py-1 text-sm flex-1"
                      />
                    )}
                    
                    {p.included && expSplitType === 'unequal' && (
                      <input type="number" step="0.01" placeholder="₹ Amount" value={p.share_amount} onChange={e => { const newP = [...expParticipants]; newP[idx].share_amount = e.target.value; setExpParticipants(newP); }} className="w-24 border border-brand-border rounded px-2 py-1 text-sm" required />
                    )}
                    {p.included && expSplitType === 'percentage' && (
                      <input type="number" step="0.01" placeholder="%" value={p.percent} onChange={e => { const newP = [...expParticipants]; newP[idx].percent = e.target.value; setExpParticipants(newP); }} className="w-20 border border-brand-border rounded px-2 py-1 text-sm" required />
                    )}
                    {p.included && expSplitType === 'share' && (
                      <input type="number" placeholder="Shares" value={p.shares} onChange={e => { const newP = [...expParticipants]; newP[idx].shares = e.target.value; setExpParticipants(newP); }} className="w-20 border border-brand-border rounded px-2 py-1 text-sm" required />
                    )}
                  </div>
                ))}

                {expSplitType === 'percentage' && (
                  <div className="text-xs text-right mt-2 text-gray-500 font-medium">
                    Total: {expParticipants.filter(p=>p.included).reduce((acc, p) => acc + (parseFloat(p.percent)||0), 0)}% of 100%
                  </div>
                )}

                <div className="mt-3">
                  <button type="button" onClick={handleAddExternal} className="text-xs text-brand-primary hover:underline font-medium">
                    + Add external participant
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Notes (optional)</label>
                <textarea rows="2" value={expNotes} onChange={e => setExpNotes(e.target.value)} className="w-full border border-brand-border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-primary/40 resize-none"></textarea>
              </div>

              {expError && (
                <div className="text-sm text-red-600 bg-red-50 p-2 rounded-lg border border-red-200">{expError}</div>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setShowAddExpense(false)} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700">Cancel</button>
                <button type="submit" disabled={expSubmitting} style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #FF6584 100%)' }} className="rounded-xl px-5 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-70">
                  {expSubmitting ? 'Adding...' : 'Add Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
