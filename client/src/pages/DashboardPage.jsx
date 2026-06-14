import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { groupsApi } from '../api/groups';
import { expensesApi } from '../api/expenses';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [groups, setGroups] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const { data } = await groupsApi.list();
      const groupsArray = data.groups || [];
      setGroups(groupsArray);
      
      const balancesMap = {};
      const promises = groupsArray.map(async (g) => {
        try {
          const { data } = await expensesApi.balances(g.id);
          const userBalance = data.balances.find(b => b.user_id === user.id);
          balancesMap[g.id] = userBalance ? parseFloat(userBalance.net_balance) : 0;
        } catch (err) {
          balancesMap[g.id] = 0;
        }
      });
      await Promise.all(promises);
      setBalances(balancesMap);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchDashboardData();
  }, [user]);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;

    setModalLoading(true);
    setModalError(null);

    try {
      const { data } = await groupsApi.create({
        name: newGroupName,
        description: newGroupDesc
      });
      setIsModalOpen(false);
      navigate(`/groups/${data.id}`);
    } catch (err) {
      setModalError(err.response?.data?.error || 'Failed to create group');
    } finally {
      setModalLoading(false);
    }
  };

  // Computations
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  let totalOwed = 0;
  let totalOwe = 0;
  Object.values(balances).forEach(bal => {
    if (bal > 0) totalOwed += bal;
    if (bal < 0) totalOwe += Math.abs(bal);
  });

  const formatMoney = (amount) => amount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-dark">
          {greeting}, {user?.name?.split(' ')[0]} 👋
        </h1>
      </div>

      {/* Top summary bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Card 1 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-brand-border">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-2xl font-bold text-brand-dark">{groups.length}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">Active Groups</div>
            </div>
            <div className="text-brand-primary">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-brand-border">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-2xl font-bold text-brand-dark">₹{formatMoney(totalOwed)}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">You are owed</div>
            </div>
            <div className="text-green-500">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-brand-border">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-2xl font-bold text-brand-dark">₹{formatMoney(totalOwe)}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">You owe</div>
            </div>
            <div className="text-red-500">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0v-8m0 8l-8-8-4 4-6-6" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Groups Section */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-semibold text-brand-dark">Your Groups</h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-brand-primary text-white rounded-xl px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          New Group
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse bg-white rounded-2xl p-5 shadow-sm border border-brand-border flex justify-between items-center">
              <div className="space-y-2">
                <div className="h-5 bg-gray-200 rounded w-32"></div>
                <div className="h-3 bg-gray-200 rounded w-24"></div>
              </div>
              <div>
                <div className="h-4 bg-gray-200 rounded w-16"></div>
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-brand-border shadow-sm">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <h3 className="mt-4 text-sm font-medium text-gray-500">No groups yet</h3>
          <p className="mt-1 text-sm text-gray-400">Create your first group to start tracking expenses.</p>
          <div className="mt-6">
            <button
              onClick={() => setIsModalOpen(true)}
              style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #FF6584 100%)' }}
              className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-medium rounded-xl shadow-sm text-white hover:opacity-90 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary"
            >
              Create Group
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const bal = balances[group.id] || 0;
            return (
              <div 
                key={group.id}
                onClick={() => navigate(`/groups/${group.id}`)}
                className="bg-white rounded-2xl p-5 shadow-sm border border-brand-border hover:shadow-md transition-shadow cursor-pointer flex justify-between items-center"
              >
                <div>
                  <h3 className="font-semibold text-brand-dark">{group.name}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{group.member_count} members</p>
                  <p className="text-xs text-gray-400">Joined {formatDate(group.joined_at)}</p>
                </div>
                <div className="text-right">
                  {bal > 0 && (
                    <>
                      <div className="text-green-600 font-semibold">+₹{formatMoney(bal)}</div>
                      <div className="text-xs text-green-400">you are owed</div>
                    </>
                  )}
                  {bal < 0 && (
                    <>
                      <div className="text-red-500 font-semibold">-₹{formatMoney(Math.abs(bal))}</div>
                      <div className="text-xs text-red-400">you owe</div>
                    </>
                  )}
                  {bal === 0 && (
                    <div className="text-gray-400 text-sm">✓ Settled</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Group Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="font-bold text-brand-dark text-lg mb-4">Create a new group</h2>
            <form onSubmit={handleCreateGroup}>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Group name
                  </label>
                  <input
                    type="text"
                    required
                    value={newGroupName}
                    onChange={(e) => {
                      setNewGroupName(e.target.value);
                      if (modalError) setModalError(null);
                    }}
                    className="bg-white border border-brand-border rounded-xl px-4 py-3 w-full text-sm text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-all"
                    placeholder="e.g. Goa Trip 2026"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Description <span className="text-gray-400 lowercase normal-case font-normal">(optional)</span>
                  </label>
                  <textarea
                    rows="3"
                    value={newGroupDesc}
                    onChange={(e) => setNewGroupDesc(e.target.value)}
                    className="bg-white border border-brand-border rounded-xl px-4 py-3 w-full text-sm text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-all resize-none"
                    placeholder="What's this group for?"
                  ></textarea>
                </div>
                
                {modalError && (
                  <div className="text-sm text-red-600 mt-2">{modalError}</div>
                )}
                
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      setNewGroupName('');
                      setNewGroupDesc('');
                      setModalError(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={modalLoading}
                    style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #FF6584 100%)' }}
                    className="text-white rounded-xl px-5 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-70 flex items-center"
                  >
                    {modalLoading ? 'Creating...' : 'Create Group'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
