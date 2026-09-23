const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('league', {
  getStatus: () => ipcRenderer.invoke('lcu:status'),
  getProfileIcon: (id) => ipcRenderer.invoke('profile:icon', id),
  getRoles: () => ipcRenderer.invoke('roles:get'),
  saveRoles: (roles) => ipcRenderer.invoke('roles:save', roles),
  launch: () => ipcRenderer.invoke('league:launch'),
  openClient: () => ipcRenderer.invoke('league:open-client'),
  getReadyState: () => ipcRenderer.invoke('ready:state'),
  createRanked: () => ipcRenderer.invoke('lobby:create-ranked'),
  invite: (name) => ipcRenderer.invoke('lobby:invite', name),
  getOnlineFriends: () => ipcRenderer.invoke('friends:online'),
  inviteSummoner: (summonerId, name) => ipcRenderer.invoke('lobby:invite-summoner', summonerId, name),
  kickMember: (summonerId) => ipcRenderer.invoke('lobby:kick-member', summonerId),
  acceptInvitation: (id) => ipcRenderer.invoke('invitation:accept', id),
  listQueues: () => ipcRenderer.invoke('queues:list'),
  selectQueue: (id) => ipcRenderer.invoke('queue:select', id),
  switchArenaTeam: (subteamIndex, position) => ipcRenderer.invoke('arena:team', subteamIndex, position),
  setWidgetSize: (width, height) => ipcRenderer.invoke('widget:size', width, height),
  declineInvitation: (id) => ipcRenderer.invoke('invitation:decline', id),
  startSearch: () => ipcRenderer.invoke('lobby:start-search'),
  cancelSearch: () => ipcRenderer.invoke('lobby:cancel-search'),
  acceptReady: () => ipcRenderer.invoke('ready:accept'),
  hideReady: () => ipcRenderer.invoke('window:hide-ready'),
  closeWidget: () => ipcRenderer.invoke('widget:close'),
  onReadyCheck: (callback) => ipcRenderer.on('ready-check', (_event, state) => callback(state))
});
