const page = document.body?.dataset?.page;

if (page === "studio") {
  initStudio();
}

function initStudio() {
  const ui = window.NovaCanvasUI;
  const fileInput = document.querySelector("[data-studio-file-input]");
  const canvasImage = document.querySelector("[data-active-canvas-image]");
  const uploadState = document.querySelector("[data-upload-state]");
  const activeProjectTitle = document.querySelector("[data-active-project-title]");
  const activeProjectSummary = document.querySelector("[data-active-project-summary]");
  const activeUploadLabel = document.querySelector("[data-active-upload-label]");
  const scoreNode = document.querySelector("[data-flow-score]");
  const contrastNode = document.querySelector("[data-flow-contrast]");
  const edgesNode = document.querySelector("[data-flow-edges]");
  const feedbackNode = document.querySelector("[data-ai-feedback]");
  const feedbackThread = document.querySelector("[data-feedback-thread]");
  const feedbackInput = document.querySelector("[data-feedback-input]");
  const feedbackContext = document.querySelector("[data-feedback-context]");
  const uploadHistory = document.querySelector("[data-upload-history]");
  const uploadHistoryCount = document.querySelector("[data-upload-history-count]");
  const aiCard = document.querySelector("[data-feedback-ai-card]");
  const peerCard = document.querySelector("[data-feedback-peer-card]");

  const state = {
    imageDataUrl: null,
    fileName: null,
    analysis: null,
    primaryProject: null,
    uploads: [],
    activeUploadId: null,
    uploadsUnsubscribe: null,
    activeFeedbackThread: [],
  };

  hydrateLocalState();
  bindActions();
  subscribeFirebaseState();

  function storageKey(suffix) {
    const uid = window.NovaCanvas?.uid || "anon";
    return `novacanvas:studio:${uid}:${suffix}`;
  }

  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  function safeStorageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(error);
    }
  }

  function readLocalUploads() {
    try {
      const raw = localStorage.getItem(storageKey("uploads"));
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  function writeLocalUploads(uploads) {
    try {
      localStorage.setItem(storageKey("uploads"), JSON.stringify(uploads));
    } catch (error) {
      console.error(error);
    }
  }

  function mergeUploads(remoteUploads) {
    const localUploads = readLocalUploads();
    const merged = [...remoteUploads];

    localUploads.forEach((localUpload) => {
      if (!merged.some((remoteUpload) => remoteUpload.id === localUpload.id)) {
        merged.push(localUpload);
      }
    });

    return merged.sort((a, b) => {
      const aTime = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
      const bTime = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
      return bTime - aTime;
    });
  }

  function upsertLocalUpload(upload) {
    const uploads = readLocalUploads();
    const index = uploads.findIndex((item) => item.id === upload.id);
    if (index >= 0) {
      uploads[index] = {...uploads[index], ...upload};
    } else {
      uploads.unshift(upload);
    }
    writeLocalUploads(uploads);
    state.uploads = mergeUploads(state.uploads.filter((item) => !item.isLocalOnly));
    return upload;
  }

  function updateLocalUpload(uploadId, patch) {
    const uploads = readLocalUploads();
    const index = uploads.findIndex((item) => item.id === uploadId);
    if (index === -1) {
      const stateUpload = state.uploads.find((item) => item.id === uploadId);
      if (!stateUpload) {
        return null;
      }

      const mergedUpload = {
        ...stateUpload,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      upsertLocalUpload(mergedUpload);
      return mergedUpload;
    }

    uploads[index] = {
      ...uploads[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    writeLocalUploads(uploads);
    state.uploads = mergeUploads(state.uploads.filter((item) => !item.isLocalOnly));
    return uploads[index];
  }

  function removeLocalUpload(uploadId) {
    const uploads = readLocalUploads().filter((item) => item.id !== uploadId);
    writeLocalUploads(uploads);
    state.uploads = mergeUploads(state.uploads.filter((item) => !item.isLocalOnly));
  }

  function hydrateLocalState() {
    const savedImage = localStorage.getItem(storageKey("image"));
    const savedFileName = localStorage.getItem(storageKey("fileName"));
    const savedAnalysis = localStorage.getItem(storageKey("analysis"));
    const savedUploadId = localStorage.getItem(storageKey("activeUploadId"));

    if (savedUploadId) {
      state.activeUploadId = savedUploadId;
    }

    if (savedImage) {
      state.imageDataUrl = savedImage;
      state.fileName = savedFileName || "Uploaded sketch";
      canvasImage.src = savedImage;
      uploadState.textContent = state.fileName;
    }

    if (savedAnalysis) {
      try {
        state.analysis = JSON.parse(savedAnalysis);
        renderAnalysis(state.analysis);
      } catch (error) {
        console.error(error);
      }
    }

    state.uploads = readLocalUploads();
    const active = resolveActiveUpload(state.uploads);
    renderUploadHistory(state.uploads, active?.id);
    if (active) {
      applyActiveUpload(active);
    }
  }

  function subscribeFirebaseState() {
    const bind = () => {
      if (!window.NovaCanvas?.subscribeProjects) {
        window.setTimeout(bind, 250);
        return;
      }

      window.NovaCanvas.subscribeProjects((projects) => {
        const primary = projects?.[0];
        if (!primary) {
          return;
        }

        state.primaryProject = primary;
        if (primary.activeUploadId) {
          state.activeUploadId = primary.activeUploadId;
          safeStorageSet(storageKey("activeUploadId"), primary.activeUploadId);
        }

        if (activeProjectTitle) {
          activeProjectTitle.textContent = primary.title || "Active Canvas";
        }

        if (activeProjectSummary) {
          activeProjectSummary.textContent = primary.summary || "Upload a sketch to start a flow check and critique thread.";
        }

        subscribeUploadState(primary.id);

        if (!state.uploads.length && primary.sketchUrl && primary.sketchUrl !== state.imageDataUrl) {
          state.imageDataUrl = primary.sketchUrl;
          state.fileName = primary.sketchFileName || state.fileName || "Uploaded sketch";
          canvasImage.src = primary.sketchUrl;
          uploadState.textContent = `${state.fileName} synced`;
          safeStorageSet(storageKey("image"), primary.sketchUrl);
          safeStorageSet(storageKey("fileName"), state.fileName);
        }

        if (primary.flowCheck) {
          state.analysis = primary.flowCheck;
          renderAnalysis(primary.flowCheck);
        }

        if (!state.uploads.length && primary.feedbackThread) {
          renderFeedback(primary.feedbackThread);
        }
      });
    };

    bind();
  }

  function subscribeUploadState(projectId) {
    if (!projectId || !window.NovaCanvas?.subscribeProjectUploads) {
      return;
    }

    state.uploadsUnsubscribe?.();
    state.uploadsUnsubscribe = window.NovaCanvas.subscribeProjectUploads(projectId, (uploads) => {
      state.uploads = mergeUploads(uploads);
      writeLocalUploads(state.uploads);
      const active = resolveActiveUpload(state.uploads);
      renderUploadHistory(state.uploads, active?.id);
      if (active) {
        applyActiveUpload(active);
      }
    });
  }

  function resolveActiveUpload(uploads) {
    if (!Array.isArray(uploads) || uploads.length === 0) {
      state.activeUploadId = null;
      safeStorageRemove(storageKey("activeUploadId"));
      renderUploadHistory([], null);
      return null;
    }

    const matched = uploads.find((upload) => upload.id === state.activeUploadId)
      || uploads.find((upload) => upload.id === state.primaryProject?.activeUploadId)
      || uploads[0];

    if (matched) {
      state.activeUploadId = matched.id;
      safeStorageSet(storageKey("activeUploadId"), matched.id);
    }

    return matched;
  }

  function bindActions() {
    function appendFeedbackEntries(uploadId, entries) {
      const localUpload = state.uploads.find((item) => item.id === uploadId);
      state.activeFeedbackThread = [...(state.activeFeedbackThread || []), ...entries];
      renderFeedback(state.activeFeedbackThread);
      if (feedbackContext) {
        feedbackContext.textContent = `${state.activeFeedbackThread.length} saved messages tied to this upload. Reopen this version anytime from Upload History.`;
      }

      if (!localUpload) {
        return null;
      }

      const updatedUpload = updateLocalUpload(uploadId, {
        feedbackThread: [...(localUpload.feedbackThread || []), ...entries],
        updatedLabel: "just now",
      });

      if (updatedUpload && uploadId === state.activeUploadId) {
        applyActiveUpload(updatedUpload);
        renderUploadHistory(state.uploads, uploadId);
      }

      return updatedUpload;
    }

    async function sendFeedbackMessage() {
      const activeUpload = ensureConversationUpload();
      const message = feedbackInput?.value?.trim();
      if (!activeUpload) {
        ui?.showToast?.("Upload a sketch first");
        return;
      }
      if (!message) {
        ui?.showToast?.("Write feedback before sending");
        return;
      }

      feedbackInput.value = "";

      const reply = generateCritiqueReply(message);
      const userEntry = {
        author: "You",
        role: "user",
        message,
        createdAt: new Date().toISOString(),
      };
      const aiEntry = reply
        ? {
          author: "Nova AI Assistant",
          role: "ai",
          message: reply,
          createdAt: new Date().toISOString(),
        }
        : null;

      appendFeedbackEntries(activeUpload.id, aiEntry ? [userEntry, aiEntry] : [userEntry]);

      await persistFeedback({
        projectId: activeUpload.projectId || state.primaryProject?.id,
        uploadId: activeUpload.id,
        entry: message,
        skipLocalUpdate: true,
      });

      if (aiEntry) {
        await persistFeedback({
          projectId: activeUpload.projectId || state.primaryProject?.id,
          uploadId: activeUpload.id,
          entry: {
            author: "Nova AI Assistant",
            role: "ai",
            message: reply,
          },
          skipLocalUpdate: true,
        });
      }

      feedbackInput?.focus();
      ui?.showToast?.("Feedback sent");
    }

    document.addEventListener("click", async (event) => {
      const actionNode = event.target.closest("[data-action]");
      if (!actionNode) {
        return;
      }

      const action = actionNode.getAttribute("data-action");

      if (action === "studio-upload-sketch") {
        fileInput.click();
        return;
      }

      if (action === "studio-select-upload") {
        const uploadId = actionNode.getAttribute("data-upload-id");
        await selectUpload(uploadId);
        return;
      }

      if (action === "studio-flow-check") {
        const activeUpload = ensureConversationUpload();
        if (!state.imageDataUrl || !activeUpload) {
          ui?.showToast?.("Upload a sketch first");
          return;
        }

        const analysis = await runFlowCheck(state.imageDataUrl);
        state.analysis = analysis;
        safeStorageSet(storageKey("analysis"), JSON.stringify(analysis));
        renderAnalysis(analysis);
        await persistUploadUpdate({
          projectId: activeUpload.projectId || state.primaryProject?.id,
          uploadId: activeUpload.id,
          flowCheck: analysis,
          updatedLabel: "just now",
          progress: Math.max(42, Math.min(96, analysis.score)),
          summary: `Flow score ${analysis.score}% • ${analysis.recommendation}`,
        });
        await persistFeedback({
          projectId: activeUpload.projectId || state.primaryProject?.id,
          uploadId: activeUpload.id,
          entry: {
            author: "Nova AI Assistant",
            role: "ai",
            message: `Flow Check: ${analysis.recommendation}`,
          },
        });
        ui?.showToast?.("Flow check complete");
        return;
      }

      if (action === "studio-send-feedback") {
        await sendFeedbackMessage();
        return;
      }

      if (action === "studio-layer-ops") {
        ui?.openModal?.(`
          <h2 class="mb-4 text-2xl font-headline-md text-white">Layer Ops</h2>
          <p class="mb-4 text-on-surface-variant">Layer operations are scaffolded for the live demo. Next step is attaching named layer groups, opacity, and version states to project documents.</p>
          <div class="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-primary-fixed-dim">Suggested layer groups: sketch, structure, color, detail, export.</div>
        `);
        return;
      }

      if (action === "studio-export-lab") {
        if (!state.imageDataUrl) {
          ui?.showToast?.("Upload a sketch before exporting");
          return;
        }

        const link = document.createElement("a");
        link.href = state.imageDataUrl;
        link.download = (state.fileName || "novacanvas-sketch").replace(/\.[^.]+$/, "") + "-export.png";
        link.click();
        ui?.showToast?.("Exported current canvas");
      }
    });

    feedbackInput?.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }

      event.preventDefault();
      await sendFeedbackMessage();
    });

    fileInput.addEventListener("change", async (event) => {
      const [file] = event.target.files || [];
      if (!file) {
        return;
      }

      const dataUrl = await readFileAsDataUrl(file);
      const analysis = await runFlowCheck(dataUrl);
      const localUpload = {
        id: `local-${Date.now()}`,
        projectId: state.primaryProject?.id || null,
        title: file.name.replace(/\.[^.]+$/, ""),
        summary: `Flow score ${analysis.score}% • ${analysis.recommendation}`,
        progress: Math.max(42, Math.min(96, analysis.score)),
        updatedLabel: "just now",
        sketchUrl: dataUrl,
        sketchStoragePath: null,
        sketchFileName: file.name,
        sketchContentType: file.type || "application/octet-stream",
        flowCheck: analysis,
        feedbackThread: [
          {
            author: "Nova AI Assistant",
            role: "ai",
            message: analysis.recommendation,
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isLocalOnly: true,
      };

      state.imageDataUrl = dataUrl;
      state.fileName = file.name;
      state.analysis = analysis;
      canvasImage.src = dataUrl;
      uploadState.textContent = `${file.name} critique ready`;
      const storedPreview = safeStorageSet(storageKey("image"), dataUrl);
      safeStorageSet(storageKey("fileName"), file.name);
      safeStorageSet(storageKey("analysis"), JSON.stringify(analysis));

      upsertLocalUpload(localUpload);
      state.activeUploadId = localUpload.id;
      safeStorageSet(storageKey("activeUploadId"), localUpload.id);
      renderAnalysis(analysis);
      state.activeFeedbackThread = [...localUpload.feedbackThread];
      renderFeedback(state.activeFeedbackThread);
      if (feedbackContext) {
        feedbackContext.textContent = "1 saved message tied to this upload. Reopen this version anytime from Upload History.";
      }
      renderUploadHistory(state.uploads, localUpload.id);
      applyActiveUpload(localUpload);
      if (!storedPreview) {
        ui?.showToast?.("Large image loaded. Preview storage was skipped, but critique still runs.");
      }
      ui?.showToast?.("Sketch loaded and critique generated");

      try {
        const uploadResult = await uploadSketchToCloud(file);
        state.imageDataUrl = uploadResult.downloadUrl;
        state.fileName = uploadResult.fileName;
        canvasImage.src = uploadResult.downloadUrl;
        uploadState.textContent = `${uploadResult.fileName} synced`;
        safeStorageSet(storageKey("image"), uploadResult.downloadUrl);
        safeStorageSet(storageKey("fileName"), uploadResult.fileName);

        const createdUpload = await createUploadVersion({
          projectId: state.primaryProject?.id,
          fileName: uploadResult.fileName,
          title: file.name.replace(/\.[^.]+$/, ""),
          summary: `Flow score ${analysis.score}% • ${analysis.recommendation}`,
          progress: Math.max(42, Math.min(96, analysis.score)),
          updatedLabel: "just now",
          downloadUrl: uploadResult.downloadUrl,
          storagePath: uploadResult.storagePath,
          contentType: uploadResult.contentType,
          flowCheck: analysis,
        });
        if (createdUpload?.id) {
          removeLocalUpload(localUpload.id);
          const syncedUpload = {
            ...localUpload,
            ...createdUpload,
            sketchUrl: uploadResult.downloadUrl,
            sketchStoragePath: uploadResult.storagePath,
            sketchFileName: uploadResult.fileName,
            sketchContentType: uploadResult.contentType,
            isLocalOnly: false,
            feedbackThread: createdUpload.feedbackThread || localUpload.feedbackThread,
          };
          upsertLocalUpload(syncedUpload);
          state.activeUploadId = createdUpload.id;
          safeStorageSet(storageKey("activeUploadId"), createdUpload.id);
          renderUploadHistory(state.uploads, createdUpload.id);
          applyActiveUpload(syncedUpload);
        }
      } catch (error) {
        console.error(error);
        uploadState.textContent = `${file.name} local only`;
        ui?.showToast?.("Cloud storage unavailable. This upload and conversation are staying local in this browser.");
      } finally {
        fileInput.value = "";
      }
    });
  }

  function getActiveUpload() {
    return state.uploads.find((upload) => upload.id === state.activeUploadId)
      || state.uploads[0]
      || null;
  }

  function ensureConversationUpload() {
    const existing = getActiveUpload();
    if (existing) {
      return existing;
    }

    if (!state.imageDataUrl) {
      return null;
    }

    const fallbackUpload = {
      id: `memory-${Date.now()}`,
      projectId: state.primaryProject?.id || null,
      title: state.fileName?.replace(/\.[^.]+$/, "") || state.primaryProject?.title || "Current Canvas",
      summary: state.analysis?.recommendation
        ? `Flow score ${state.analysis.score}% • ${state.analysis.recommendation}`
        : "Current canvas ready for critique.",
      progress: state.analysis?.score || state.primaryProject?.progress || 42,
      updatedLabel: "just now",
      sketchUrl: state.imageDataUrl,
      sketchStoragePath: null,
      sketchFileName: state.fileName || "Current canvas",
      sketchContentType: "image/*",
      flowCheck: state.analysis || null,
      feedbackThread: state.analysis?.recommendation
        ? [
          {
            author: "Nova AI Assistant",
            role: "ai",
            message: state.analysis.recommendation,
            createdAt: new Date().toISOString(),
          },
        ]
        : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isLocalOnly: true,
    };

    upsertLocalUpload(fallbackUpload);
    state.activeUploadId = fallbackUpload.id;
    safeStorageSet(storageKey("activeUploadId"), fallbackUpload.id);
    renderUploadHistory(state.uploads, fallbackUpload.id);
    applyActiveUpload(fallbackUpload);
    return fallbackUpload;
  }

  async function persistProjectUpdate(patch) {
    if (!window.NovaCanvas?.updatePrimaryProject) {
      return;
    }

    try {
      await window.NovaCanvas.updatePrimaryProject(patch);
    } catch (error) {
      console.error(error);
      ui?.showToast?.("Project sync failed");
    }
  }

  async function createUploadVersion(payload) {
    if (!window.NovaCanvas?.createProjectUploadVersion) {
      return null;
    }

    try {
      return await window.NovaCanvas.createProjectUploadVersion(payload);
    } catch (error) {
      console.error(error);
      ui?.showToast?.("Upload record sync failed");
      return null;
    }
  }

  async function persistUploadUpdate({projectId, uploadId, ...patch}) {
    const localUpload = updateLocalUpload(uploadId, patch);
    if (localUpload && uploadId === state.activeUploadId) {
      applyActiveUpload(localUpload);
      renderUploadHistory(state.uploads, uploadId);
    }

    if (!window.NovaCanvas?.updateProjectUpload) {
      return;
    }

    try {
      await window.NovaCanvas.updateProjectUpload(projectId, uploadId, patch);
    } catch (error) {
      console.error(error);
      ui?.showToast?.("Upload sync failed");
    }
  }

  async function persistFeedback({projectId, uploadId, entry, skipLocalUpdate = false}) {
    const localUpload = state.uploads.find((item) => item.id === uploadId);
    const payload = typeof entry === "string"
      ? {
        author: "You",
        role: "user",
        message: entry,
        createdAt: new Date().toISOString(),
      }
      : {
        author: entry?.author || "Nova AI Assistant",
        role: entry?.role || "ai",
        message: entry?.message || "",
        createdAt: new Date().toISOString(),
      };

    if (!skipLocalUpdate && localUpload) {
      const feedbackThread = [...(localUpload.feedbackThread || []), payload];
      const updatedUpload = updateLocalUpload(uploadId, {
        feedbackThread,
        updatedLabel: "just now",
      });
      if (updatedUpload && uploadId === state.activeUploadId) {
        applyActiveUpload(updatedUpload);
        renderUploadHistory(state.uploads, uploadId);
      }
    }

    if (!window.NovaCanvas?.addUploadFeedback) {
      return;
    }

    try {
      await window.NovaCanvas.addUploadFeedback(projectId, uploadId, entry);
    } catch (error) {
      console.error(error);
      ui?.showToast?.("Feedback sync failed");
    }
  }

  async function uploadSketchToCloud(file) {
    if (!window.NovaCanvas?.uploadStudioSketch) {
      throw new Error("Storage upload unavailable");
    }

    return window.NovaCanvas.uploadStudioSketch(file, state.primaryProject?.id);
  }

  async function selectUpload(uploadId) {
    const upload = state.uploads.find((item) => item.id === uploadId);
    if (!upload) {
      return;
    }

    state.activeUploadId = uploadId;
    safeStorageSet(storageKey("activeUploadId"), uploadId);
    applyActiveUpload(upload);
    renderUploadHistory(state.uploads, uploadId);
    await persistProjectUpdate({
      activeUploadId: upload.id,
      title: upload.title,
      summary: upload.summary,
      progress: upload.progress,
      updatedLabel: upload.updatedLabel || "just now",
      sketchUrl: upload.sketchUrl,
      sketchStoragePath: upload.sketchStoragePath,
      sketchFileName: upload.sketchFileName,
      sketchContentType: upload.sketchContentType,
      flowCheck: upload.flowCheck || null,
    });
  }

  function applyActiveUpload(upload) {
    state.imageDataUrl = upload.sketchUrl || state.imageDataUrl;
    state.fileName = upload.sketchFileName || state.fileName;
    state.analysis = upload.flowCheck || null;
    state.activeUploadId = upload.id;
    canvasImage.src = state.imageDataUrl;
    uploadState.textContent = upload.sketchFileName ? `${upload.sketchFileName} synced` : "Upload ready";
    if (typeof state.imageDataUrl === "string" && state.imageDataUrl.startsWith("http")) {
      safeStorageSet(storageKey("image"), state.imageDataUrl);
    }
    safeStorageSet(storageKey("fileName"), state.fileName || "");
    safeStorageSet(storageKey("activeUploadId"), upload.id);

    if (activeProjectTitle) {
      activeProjectTitle.textContent = upload.title || state.primaryProject?.title || "Active Canvas";
    }

    if (activeProjectSummary) {
      activeProjectSummary.textContent = upload.summary || state.primaryProject?.summary || "Critique thread ready.";
    }

    if (activeUploadLabel) {
      activeUploadLabel.textContent = `Selected upload • ${upload.sketchFileName || upload.title || "Untitled Upload"}`;
    }

    if (feedbackContext) {
      const feedbackCount = Array.isArray(upload.feedbackThread) ? upload.feedbackThread.length : 0;
      feedbackContext.textContent = `${feedbackCount} saved messages tied to this upload. Reopen this version anytime from Upload History.`;
    }

    if (upload.flowCheck) {
      safeStorageSet(storageKey("analysis"), JSON.stringify(upload.flowCheck));
      renderAnalysis(upload.flowCheck);
    } else {
      clearAnalysis();
    }

    state.activeFeedbackThread = Array.isArray(upload.feedbackThread) ? [...upload.feedbackThread] : [];
    renderFeedback(state.activeFeedbackThread);
  }

  function renderUploadHistory(items, activeId) {
    if (!uploadHistory) {
      return;
    }

    if (uploadHistoryCount) {
      uploadHistoryCount.textContent = `${items.length} ${items.length === 1 ? "upload" : "uploads"}`;
    }

    uploadHistory.innerHTML = "";
    if (!items.length) {
      uploadHistory.innerHTML = `
        <div class="rounded-xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-on-surface-variant">
          Upload a sketch to start a versioned critique thread.
        </div>
      `;
      return;
    }

    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-action", "studio-select-upload");
      button.setAttribute("data-upload-id", item.id);
      button.className = `w-full rounded-xl border p-4 text-left transition-all ${
        item.id === activeId
          ? "border-primary-fixed-dim/50 bg-primary-container/10 shadow-lg shadow-primary-container/10"
          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
      }`;
      const messageCount = Array.isArray(item.feedbackThread) ? item.feedbackThread.length : 0;
      button.innerHTML = `
        <div class="mb-2 flex items-center justify-between gap-3">
          <span class="truncate font-label-md text-white">${item.title || item.sketchFileName || "Untitled Upload"}</span>
          <span class="text-[10px] uppercase tracking-[0.24em] text-on-surface-variant">${item.updatedLabel || "saved"}</span>
        </div>
        <p class="mb-3 line-clamp-2 text-sm text-on-surface-variant">${item.summary || "Critique thread ready."}</p>
        <div class="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-on-surface-variant/80">
          <span>${messageCount} messages</span>
          <span>${item.flowCheck ? `${item.flowCheck.score}% flow` : "No flow check"}</span>
        </div>
      `;
      uploadHistory.appendChild(button);
    });
  }

  function renderAnalysis(analysis) {
    if (!analysis) {
      clearAnalysis();
      return;
    }

    scoreNode.textContent = `${analysis.score}%`;
    contrastNode.textContent = analysis.contrastLabel;
    edgesNode.textContent = analysis.edgeLabel;
    feedbackNode.textContent = `“${analysis.recommendation}”`;
  }

  function clearAnalysis() {
    scoreNode.textContent = "Pending";
    contrastNode.textContent = "Pending";
    edgesNode.textContent = "Pending";
    feedbackNode.textContent = "“Run Flow Check to generate critique for this upload.”";
  }

  function renderFeedback(items) {
    if (!feedbackThread) {
      return;
    }

    aiCard?.remove();
    peerCard?.remove();
    feedbackThread.innerHTML = "";

    if (!Array.isArray(items) || items.length === 0) {
      feedbackThread.innerHTML = `
        <div class="rounded-lg border border-dashed border-white/10 bg-white/5 p-4 text-sm text-on-surface-variant">
          This upload does not have a saved conversation yet. Run a flow check or ask for critique to start one.
        </div>
      `;
      return;
    }

    items.forEach((item) => {
      const card = document.createElement("div");
      const isAi = item.role === "ai";
      const isUser = item.role === "user";
      card.className = isAi
        ? "rounded-lg border-l-4 border-secondary-container bg-surface-container-high/40 p-4"
        : "rounded-lg border border-white/10 bg-white/5 p-4";
      const header = document.createElement("div");
      header.className = "mb-2 flex gap-3";

      const avatar = document.createElement("div");
      if (isAi) {
        avatar.className = "flex h-8 w-8 items-center justify-center rounded-full bg-secondary-container/20";
        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined text-sm text-secondary";
        icon.textContent = "smart_toy";
        avatar.appendChild(icon);
      } else {
        avatar.className = "flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-surface-container-high text-xs text-primary-fixed-dim";
        avatar.textContent = isUser ? "You" : "MC";
      }

      const author = document.createElement("span");
      author.className = `font-label-md ${isAi ? "text-secondary" : "text-on-surface"}`;
      author.textContent = item.author;

      const body = document.createElement("p");
      body.className = "text-sm text-on-surface-variant";
      body.textContent = `“${item.message}”`;

      header.append(avatar, author);
      card.append(header, body);
      feedbackThread.appendChild(card);
    });
  }

  function generateCritiqueReply(message) {
    const trimmed = message.trim();
    if (!trimmed) {
      return "";
    }

    const analysis = state.analysis;
    const projectName = getActiveUpload()?.title || state.primaryProject?.title || state.fileName?.replace(/\.[^.]+$/, "") || "this piece";
    const topic = inferTopic(trimmed);

    if (!analysis) {
      return `For ${projectName}, I can give stronger critique after a Flow Check. Right now I would focus first on ${topic.focus}, then test two small variations so the focal read becomes clearer.`;
    }

    const contrastLine = analysis.contrastLabel === "High"
      ? "Your contrast separation is already doing useful work, so adjust focal emphasis without flattening the dark-to-light rhythm."
      : analysis.contrastLabel === "Balanced"
        ? "The contrast range is balanced, which gives you room to push one area harder for a stronger focal hierarchy."
        : "The current contrast read is still quiet, so the fastest improvement is a clearer light-vs-shadow split around the subject.";

    const edgeLine = analysis.edgeLabel === "High"
      ? "Edge energy is dense, so reserve your sharpest transitions for the main subject and let supporting zones breathe."
      : analysis.edgeLabel === "Balanced"
        ? "Edge energy is controlled, which means you can selectively sharpen one contour to improve direction and intent."
        : "The edge structure is soft right now, so one decisive contour pass would help the form hold together.";

    const paletteLine = analysis.recommendation.toLowerCase().includes("cool")
      ? "Because the image is leaning cooler, one warmer accent would create a cleaner visual anchor."
      : analysis.recommendation.toLowerCase().includes("warm")
        ? "Because the palette is running warm, a cooler counterpoint would keep the surface from collapsing into one temperature band."
        : "The palette is serviceable, but a tighter temperature split would make the composition feel more authored.";

    return `${contrastLine} ${edgeLine} For ${projectName}, on the question of ${topic.label}, I would ${topic.action} ${paletteLine}`;
  }

  function inferTopic(message) {
    const normalized = message.toLowerCase();
    if (normalized.includes("color") || normalized.includes("palette") || normalized.includes("tone")) {
      return {
        label: "color and palette control",
        focus: "color temperature and value grouping",
        action: "test one dominant palette family with a single accent temperature",
      };
    }

    if (normalized.includes("light") || normalized.includes("shadow") || normalized.includes("contrast")) {
      return {
        label: "lighting and contrast",
        focus: "your brightest zone against your quietest dark",
        action: "tighten the lighting hierarchy around the intended focal point",
      };
    }

    if (normalized.includes("composition") || normalized.includes("focal") || normalized.includes("layout")) {
      return {
        label: "composition",
        focus: "focal hierarchy and directional flow",
        action: "simplify one competing area so the eye lands faster on the main read",
      };
    }

    if (normalized.includes("edge") || normalized.includes("line") || normalized.includes("shape")) {
      return {
        label: "edge control",
        focus: "shape clarity and selective sharpness",
        action: "sharpen only the highest-priority contour and soften secondary transitions",
      };
    }

    return {
      label: "overall refinement",
      focus: "value grouping and focal clarity",
      action: "run one pass on hierarchy first, then a second pass on accent detail",
    };
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function runFlowCheck(imageDataUrl) {
  const image = await loadImage(imageDataUrl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", {willReadFrequently: true});
  const width = 160;
  const height = Math.max(1, Math.round((image.height / image.width) * width));
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0, width, height);
  const {data} = ctx.getImageData(0, 0, width, height);

  let brightnessSum = 0;
  const values = new Array(width * height);
  let warmSum = 0;
  let coolSum = 0;
  let saturationSum = 0;
  let centerWeight = 0;
  let outerWeight = 0;
  let leftWeight = 0;
  let rightWeight = 0;
  let topWeight = 0;
  let bottomWeight = 0;

  for (let i = 0; i < values.length; i += 1) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    values[i] = value;
    brightnessSum += value;

    const x = i % width;
    const y = Math.floor(i / width);
    const dx = Math.abs(x - width / 2) / (width / 2);
    const dy = Math.abs(y - height / 2) / (height / 2);
    const radialDistance = Math.sqrt(dx * dx + dy * dy);
    const maxRgb = Math.max(r, g, b);
    const minRgb = Math.min(r, g, b);
    const saturation = maxRgb === 0 ? 0 : ((maxRgb - minRgb) / maxRgb) * 100;
    saturationSum += saturation;
    warmSum += r - b;
    coolSum += b - r;

    if (radialDistance < 0.45) {
      centerWeight += value;
    } else {
      outerWeight += value;
    }

    if (x < width / 2) {
      leftWeight += value;
    } else {
      rightWeight += value;
    }

    if (y < height / 2) {
      topWeight += value;
    } else {
      bottomWeight += value;
    }
  }

  const brightnessAvg = brightnessSum / values.length;
  let varianceSum = 0;
  let edgeSum = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = values[index];
      varianceSum += (value - brightnessAvg) ** 2;

      if (x < width - 1) {
        edgeSum += Math.abs(value - values[index + 1]);
      }
      if (y < height - 1) {
        edgeSum += Math.abs(value - values[index + width]);
      }
    }
  }

  const contrast = Math.sqrt(varianceSum / values.length);
  const edgeDensity = edgeSum / (values.length * 2);
  const averageSaturation = saturationSum / values.length;
  const horizontalBias = ((rightWeight - leftWeight) / Math.max(1, rightWeight + leftWeight)) * 100;
  const verticalBias = ((bottomWeight - topWeight) / Math.max(1, bottomWeight + topWeight)) * 100;
  const centerBias = ((centerWeight - outerWeight) / Math.max(1, centerWeight + outerWeight)) * 100;
  const warmth = warmSum / values.length;
  const coolness = coolSum / values.length;

  const brightnessScore = 100 - Math.min(100, Math.abs(brightnessAvg - 128) * 0.8);
  const contrastScore = Math.min(100, contrast * 1.8);
  const edgeScore = Math.min(100, edgeDensity * 1.6);
  const centerScore = 100 - Math.min(100, Math.abs(centerBias) * 2.2);
  const score = Math.round(
    brightnessScore * 0.18 +
      contrastScore * 0.32 +
      edgeScore * 0.28 +
      centerScore * 0.22,
  );

  const contrastLabel = contrast >= 58 ? "High" : contrast >= 38 ? "Balanced" : "Soft";
  const edgeLabel = edgeDensity >= 42 ? "Dense" : edgeDensity >= 24 ? "Controlled" : "Loose";
  const temperatureLabel =
    warmth > 12 ? "warm-leaning" : coolness > 12 ? "cool-leaning" : "temperature-balanced";
  const focalLabel =
    centerBias > 8 ? "center-weighted" : centerBias < -8 ? "edge-weighted" : "evenly distributed";
  const orientationLabel =
    Math.abs(horizontalBias) > Math.abs(verticalBias)
      ? horizontalBias > 0
        ? "right-drifting"
        : "left-drifting"
      : verticalBias > 0
        ? "bottom-heavy"
        : "top-heavy";
  const paletteLabel =
    averageSaturation > 46 ? "high-chroma" : averageSaturation > 24 ? "moderately saturated" : "muted";

  const recommendation = buildRecommendation({
    score,
    contrast,
    edgeDensity,
    brightnessAvg,
    averageSaturation,
    horizontalBias,
    verticalBias,
    centerBias,
    temperatureLabel,
    focalLabel,
    orientationLabel,
    paletteLabel,
  });

  return {
    score,
    brightness: Math.round(brightnessAvg),
    contrast: Math.round(contrast),
    edgeDensity: Math.round(edgeDensity),
    saturation: Math.round(averageSaturation),
    focalBias: Math.round(centerBias),
    horizontalBias: Math.round(horizontalBias),
    verticalBias: Math.round(verticalBias),
    contrastLabel,
    edgeLabel,
    temperatureLabel,
    focalLabel,
    orientationLabel,
    paletteLabel,
    recommendation,
    analyzedAt: new Date().toISOString(),
  };
}

function buildRecommendation(metrics) {
  const openings = [
    "This sketch reads as",
    "The current composition feels",
    "Your uploaded piece is coming through as",
    "The overall motion here feels",
  ];

  const opener =
    openings[
      Math.abs(
        Math.round(
          metrics.score +
            metrics.contrast +
            metrics.edgeDensity +
            metrics.saturation +
            metrics.horizontalBias +
            metrics.verticalBias,
        ),
      ) % openings.length
    ];

  const clauses = [
    `${metrics.focalLabel}, ${metrics.orientationLabel}, and ${metrics.paletteLabel}.`,
  ];

  if (metrics.contrast < 34) {
    clauses.push("Push a cleaner value split around the focal path so the main form separates faster.");
  } else if (metrics.contrast > 62) {
    clauses.push("The value snap is already strong, so the next win is controlling where the sharpest contrast lands.");
  } else {
    clauses.push("The contrast band is usable, but a tighter focal hotspot would make the eye travel more decisively.");
  }

  if (metrics.edgeDensity < 22) {
    clauses.push("Edge information is sparse, which makes the silhouette feel soft; sharpen one dominant contour and let the rest stay quiet.");
  } else if (metrics.edgeDensity > 46) {
    clauses.push("There is a lot of edge activity, so simplifying the secondary clusters would keep the composition from fragmenting.");
  } else {
    clauses.push("Edge density is controlled, and you can now emphasize hierarchy by making one region crisper than the others.");
  }

  if (metrics.centerBias > 8) {
    clauses.push("Because the energy is pooling near the center, consider extending one line of force farther outward to create a stronger sweep.");
  } else if (metrics.centerBias < -8) {
    clauses.push("The visual pull lives more on the perimeter, so anchoring one central focal mass would make the composition feel more intentional.");
  } else {
    clauses.push("The focal distribution is fairly even, so a single dominant anchor would help turn rhythm into a clearer statement.");
  }

  if (metrics.temperatureLabel === "warm-leaning") {
    clauses.push("The warmer bias gives it heat; a cooler accent in the focal zone could create cleaner dimensional contrast.");
  } else if (metrics.temperatureLabel === "cool-leaning") {
    clauses.push("The cooler bias supports atmosphere well; a restrained warm interruption could make the main subject feel more alive.");
  } else {
    clauses.push("The temperature balance is steady, which means your next decision can be more expressive rather than corrective.");
  }

  if (metrics.brightnessAvg < 92) {
    clauses.push("Overall it sits dark, so a deliberate lift in the key planes would keep detail from collapsing in presentation.");
  } else if (metrics.brightnessAvg > 168) {
    clauses.push("It is reading bright overall, so protecting a few deeper value pockets would give the piece more depth.");
  }

  return `${opener} ${clauses.join(" ")}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
