const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

var onNewWindowOpened;

function startup(aData, aReason) {
  const { Services } = Cu.import('resource://gre/modules/Services.jsm', {});

  const handleWindow = (aWindow) => {
    if (!aWindow.AttachmentInfo ||
        !aWindow.AttachmentInfo.prototype ||
        aWindow.AttachmentInfo.prototype.__force_fix_folder__open)
      return;

    Services.console.logStringMessage(`Initializing... ${aWindow.location.href}`);

    aWindow.AttachmentInfo.prototype.__force_fix_folder__open = aWindow.AttachmentInfo.prototype.open;
    aWindow.AttachmentInfo.prototype.open = async function() {
      Services.console.logStringMessage(`AttachmentInfo.prototype.open called`);
      await this.ensureFolderFileExists();
      this.__force_fix_folder__open();
    };
    aWindow.AttachmentInfo.prototype.ensureFolderFileExists = async function() {
      if (!this.isEmpty) {
        Services.console.logStringMessage('SKIP: not empty');
        return;
      }
      let selectedMessage = aWindow.gFolderDisplay.selectedMessage;
      let folder = aWindow.gFolderDisplay.displayedFolder;
      if (!selectedMessage ||
          !folder) {
        Services.console.logStringMessage('SKIP: failed to get current folder and message');
        return;
      }

      if (folder.locked) {
        Services.console.logStringMessage('SKIP: failed to fix locked folder');
        return;
      }

      let file = folder.filePath;
      Services.console.logStringMessage('Folder is detected as "empty", now trying to fix. (exists=' + file.exists() + ')');

      aWindow.gFolderDisplay.view.close();
      // MailServices.mfn.notifyItemEvent(folder, 'FolderReindexTriggered', null);
      folder.msgDatabase.summaryValid = false;
      let msgDB = folder.msgDatabase;
      msgDB.summaryValid = false;
      try {
        folder.closeAndBackupFolderDB('');
      }
      catch(e) {
        Cu.reportError(e);
        folder.ForceDBClosed();
      }
      folder.updateFolder(aWindow.msgWindow);
      aWindow.gFolderDisplay.show(folder);

      Services.console.logStringMessage('start waiting until the folder becomes ready.');
      await new Promise((aResolve, aReject) => {
        let timer = setInterval(() => {
          Services.console.logStringMessage('waiting...');
          if (!file.exists())
            return;
          clearInterval(timer);
          aResolve();
        }, 200);
      });

      Services.console.logStringMessage('re-select the message');
      aWindow.gFolderDisplay.selectMessage(selectedMessage);
      Services.console.logStringMessage('ready to open attachments');
    };

    Services.console.logStringMessage(`Initialized: ${aWindow.location.href}`);
  };

  const windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    handleWindow(windows.getNext().QueryInterface(Ci.nsIDOMWindow));
  }

  onNewWindowOpened = {
    observe(aSubject, aTopic, aData) {
      if (aTopic == 'domwindowopened' &&
          !aSubject
            .QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIWebNavigation)
            .QueryInterface(Ci.nsIDocShell)
            .QueryInterface(Ci.nsIDocShellTreeNode || Ci.nsIDocShellTreeItem) // nsIDocShellTreeNode is merged to nsIDocShellTreeItem by https://bugzilla.mozilla.org/show_bug.cgi?id=331376
            .QueryInterface(Ci.nsIDocShellTreeItem)
            .parent)
        aSubject.QueryInterface(Ci.nsIDOMWindow).addEventListener('DOMContentLoaded', aEvent => {
          handleWindow(aEvent.target.defaultView);
        }, { once: true });
    }
  };

  Services.ww.registerNotification(onNewWindowOpened);
}

function shutdown(aData, aReason) {
  const { Services } = Cu.import('resource://gre/modules/Services.jsm', {});

  const windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    const window = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    if (!window.AttachmentInfo.prototype.__force_fix_folder__open)
      continue;
    window.AttachmentInfo.prototype.open = window.AttachmentInfo.prototype.__force_fix_folder__open;
    delete window.AttachmentInfo.prototype.__force_fix_folder__open;
    delete window.AttachmentInfo.prototype.ensureFolderFileExists;
  }

  Services.ww.unregisterNotification(onNewWindowOpened);
  onNewWindowOpened = undefined;
}

function install(aData, aReason) {}

function uninstall(aData, aReason) {}
