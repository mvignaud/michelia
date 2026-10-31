// Tâche de fond de l'extension : le bouton de la barre d'outils ouvre le panneau latéral de Michel,
// et le clic droit sur un texte sélectionné le lui envoie (« Demander à Michel »).

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create({
      id: 'demander-a-michel',
      title: 'Demander à Michel : « %s »',
      contexts: ['selection'],
    }),
  );
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'demander-a-michel' || !info.selectionText) return;
  // Le panneau lit cette question à son ouverture (ou tout de suite s'il est déjà ouvert).
  // sidePanel.open doit partir dans la foulée du clic : pas d'attente avant.
  if (tab?.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  chrome.storage.session.set({ question: info.selectionText.slice(0, 3000) });
});
