// src/components/UserProfileModal.jsx - Netflix-style User Switcher & Profile Sync Modal
import React, { useState, useEffect } from 'react';
import { 
  X, User, UserPlus, Check, Sparkles, Heart, History, RefreshCw, Trash2, Shield
} from 'lucide-react';

const AVATARS = [
  { id: 'cat', emoji: '🐱', label: '喵星人 Cat' },
  { id: 'fox', emoji: '🦊', label: '狐狸 Fox' },
  { id: 'ninja', emoji: '🥷', label: '忍者 Ninja' },
  { id: 'robot', emoji: '🤖', label: '機甲 Robot' },
  { id: 'ghost', emoji: '👻', label: '幽靈 Ghost' },
  { id: 'dragon', emoji: '🐲', label: '神龍 Dragon' },
  { id: 'star', emoji: '⭐', label: '動漫星 Star' }
];

export default function UserProfileModal({
  isOpen,
  onClose,
  currentUser,
  onSwitchUser,
  currentLang = 'zh-TW',
  favoritesCount = 0,
  historyCount = 0
}) {
  const [userList, setUserList] = useState([]);
  const [inputUsername, setInputUsername] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('cat');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // Fetch list of all existing users on server
  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (data.success && Array.isArray(data.users)) {
        setUserList(data.users);
      }
    } catch (err) {
      console.warn('Failed to fetch user list:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
      setInputUsername('');
      setStatusMsg('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    const clean = inputUsername.trim();
    if (!clean) return;

    setIsLoading(true);
    setStatusMsg('');
    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: clean, avatar: selectedAvatar })
      });
      const data = await res.json();
      if (data.success && data.user) {
        onSwitchUser(data.user);
        setStatusMsg(`✅ 已切換至「${data.user.displayName || data.user.username}」！`);
        setTimeout(() => {
          onClose();
        }, 800);
      } else {
        setStatusMsg('❌ 登入失敗：' + (data.error || '請重試'));
      }
    } catch (err) {
      setStatusMsg('❌ 連線異常：' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectExistingUser = async (userObj) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: userObj.username })
      });
      const data = await res.json();
      if (data.success && data.user) {
        onSwitchUser(data.user);
        onClose();
      }
    } catch (err) {
      console.warn('Failed to switch user:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteUser = async (e, username) => {
    e.stopPropagation();
    if (username === currentUser?.username) {
      alert('無法刪除當前使用中的帳號。請先切換至其他帳號。');
      return;
    }
    if (!confirm(`確定要刪除使用者「${username}」的雲端資料嗎？此操作無法還原。`)) {
      return;
    }

    try {
      await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
      fetchUsers();
    } catch {}
  };

  const currentAvatarEmoji = AVATARS.find(a => a.id === currentUser?.avatar)?.emoji || '👤';

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-pointer overflow-y-auto"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-lg bg-[#18181c] rounded-3xl border border-zinc-800 shadow-2xl p-5 sm:p-7 text-zinc-100 animate-in fade-in zoom-in-95 cursor-default overflow-hidden max-h-[90vh] flex flex-col my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-red-600/20 text-[#E50914] flex items-center justify-center border border-red-500/30">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                {currentLang === 'ja' ? 'ユーザープロファイル' : currentLang.startsWith('zh') ? '使用者帳號與資料同步' : 'User Profiles & Sync'}
              </h3>
              <p className="text-[11px] text-zinc-400">
                {currentLang === 'ja' ? 'ユーザー名でログインし、お気に入りと履歴を同期' : currentLang.startsWith('zh') ? '以用戶名稱切換帳號，跨裝置自動同步收藏與歷史紀錄' : 'Login by username to load your personal watch list & history'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 py-4 space-y-5 no-scrollbar">
          {/* Current Active User Banner */}
          <div className="bg-gradient-to-r from-red-950/30 via-zinc-900 to-zinc-900 border border-red-500/30 rounded-2xl p-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <div className="text-2xl w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center border border-zinc-700 shadow-inner">
                {currentAvatarEmoji}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{currentUser?.displayName || currentUser?.username || 'Default'}</span>
                  <span className="text-[10px] bg-red-600/30 text-red-300 border border-red-500/40 px-2 py-0.5 rounded-full font-bold">
                    當前使用中
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-400 mt-1">
                  <span className="flex items-center gap-1">
                    <Heart className="w-3 h-3 text-rose-500 fill-rose-500" />
                    {favoritesCount} 追番關注
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <History className="w-3 h-3 text-indigo-400" />
                    {historyCount} 播放紀錄
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Switch Existing User Profiles */}
          {userList.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-bold text-zinc-300">
                  {currentLang === 'ja' ? '保存済みユーザー' : currentLang.startsWith('zh') ? '現有用戶列表 (點擊快速切換)' : 'Registered Profiles'}
                </span>
                <button 
                  onClick={fetchUsers} 
                  className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800 transition-colors"
                  title="Refresh users"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {userList.map((u) => {
                  const isCurrent = (u.username === currentUser?.username);
                  const avatarEmoji = AVATARS.find(a => a.id === u.avatar)?.emoji || '👤';

                  return (
                    <div
                      key={u.username}
                      onClick={() => !isCurrent && handleSelectExistingUser(u)}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                        isCurrent 
                          ? 'bg-zinc-800/80 border-red-500/40 cursor-default ring-1 ring-red-500/20' 
                          : 'bg-zinc-900/80 hover:bg-zinc-800 border-zinc-800 hover:border-zinc-700 cursor-pointer hover:scale-[1.01]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xl shrink-0">{avatarEmoji}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">{u.displayName || u.username}</p>
                          <p className="text-[10px] text-zinc-400 truncate">
                            {u.favoritesCount} 收藏 · {u.historyCount} 歷史
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isCurrent ? (
                          <span className="text-emerald-400 flex items-center justify-center w-6 h-6 rounded-full bg-emerald-950/40 border border-emerald-500/30">
                            <Check className="w-3.5 h-3.5" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteUser(e, u.username)}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-950/30 transition-colors"
                            title="刪除用戶檔案"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Login or Create New User Form */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-bold text-white">
                {currentLang === 'ja' ? '新しいユーザー名でログイン / 作成' : currentLang.startsWith('zh') ? '以用戶名稱登入 / 建立新帳號' : 'Login or Create by Username'}
              </h4>
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-3">
              {/* Avatar Selector */}
              <div>
                <span className="text-[11px] font-bold text-zinc-400 mb-1.5 block">
                  選擇頭像風格 (Avatar):
                </span>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                  {AVATARS.map((av) => (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => setSelectedAvatar(av.id)}
                      className={`text-lg p-2 rounded-xl border transition-all ${
                        selectedAvatar === av.id
                          ? 'bg-red-600/20 border-red-500 shadow-sm scale-105'
                          : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
                      }`}
                      title={av.label}
                    >
                      {av.emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Username Input Field with accessible label */}
              <div>
                <label htmlFor="user-login-input" className="text-[11px] font-bold text-zinc-400 mb-1 block">
                  輸入使用者名稱 (Username):
                </label>
                <div className="flex gap-2">
                  <input
                    id="user-login-input"
                    name="username"
                    type="text"
                    autoComplete="username"
                    required
                    value={inputUsername}
                    onChange={(e) => setInputUsername(e.target.value)}
                    placeholder="例如: Atszl, Family, BedroomTV..."
                    aria-label="使用者名稱 (Username)"
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !inputUsername.trim()}
                    className="px-4 py-2 rounded-xl bg-[#E50914] hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold transition-[transform,background-color] duration-150 shadow-md shrink-0 flex items-center gap-1.5 motion-safe:active:scale-[0.96]"
                  >
                    <span>登入 / 切換</span>
                  </button>
                </div>
              </div>

              {statusMsg && (
                <p className="text-xs font-semibold text-zinc-300 animate-in fade-in">
                  {statusMsg}
                </p>
              )}
            </form>
          </div>
        </div>

        {/* Footer Note */}
        <div className="pt-3 border-t border-zinc-800 text-[11px] text-zinc-500 shrink-0 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
            資料存放於 NAS `/data/users/`，無密碼負擔，重啟不丟失
          </span>
          <button 
            type="button" 
            onClick={onClose}
            className="text-xs text-zinc-400 hover:text-white px-3 py-1 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
