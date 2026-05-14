(function initNovaCanvasFirebase() {
  const config = window.NOVACANVAS_FIREBASE_CONFIG || null;
  window.NovaCanvas = window.NovaCanvas || {};
  window.NovaCanvas.firebaseConfig = config;

  const statusNodes = document.querySelectorAll("[data-firebase-status]");
  statusNodes.forEach((node) => {
    if (!config) {
      node.textContent = "Firebase config missing";
      return;
    }

    const label = config.projectId ? "Connected to " + config.projectId : "Firebase ready";
    node.textContent = label;
  });
})();
