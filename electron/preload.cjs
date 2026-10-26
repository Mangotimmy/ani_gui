// electron/preload.cjs - Minimal, context-isolated bridge between the renderer and
// native desktop capabilities (Windows toasts + a few window helpers).
//
// Kept intentionally small: the renderer never gets Node access. Window
// minimize/maximize/close are handled natively by the titleBarOverlay on Windows, so no
// IPC is needed for them.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aniflixDesktop', {
  isDesktop: true,
  platform: process.platform,
  titleBarHeight: process.platform === 'darwin' ? 28 : 34,

  /** Show a native OS notification. Resolves to true when it was dispatched. */
  notify: (payload) => ipcRenderer.invoke('desktop:notify', payload),

  notificationsSupported: () => ipcRenderer.invoke('desktop:notifications-supported'),

  /** UI Zoom & Scale factor methods */
  getZoomFactor: () => ipcRenderer.invoke('desktop:get-zoom-factor'),
  setZoomFactor: (factor) => ipcRenderer.invoke('desktop:set-zoom-factor', factor),
  onZoomChange: (callback) => {
    const handler = (_event, factor) => callback(factor);
    ipcRenderer.on('desktop:zoom-changed', handler);
    return () => ipcRenderer.removeListener('desktop:zoom-changed', handler);
  },

  /** Fired when the user clicks a native notification. Returns an unsubscribe fn. */
  onNotificationClick: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:notification-clicked', handler);
    return () => ipcRenderer.removeListener('desktop:notification-clicked', handler);
  }
});
