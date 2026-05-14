const page = document.body?.dataset?.page;

if (page === "studio") {
  initStudio();
}

function initStudio() {
  const ui = window.NovaCanvasUI;
  const fileInput = document.querySelector("[data-studio-file-input]");
  const canvasImage = document.querySelector("[data-active-canvas-image]");
  const uploadState = document.querySelector("[data-upload-state]");
  const scoreNode = document.querySelector("[data-flow-score]");
  const contrastNode = document.querySelector("[data-flow-contrast]");
  const edgesNode = document.querySelector("[data-flow-edges]");
  const feedbackNode = document.querySelector("[data-ai-feedback]");

  const state = {
    imageDataUrl: null,
    fileName: null,
    analysis: null,
  };

  hydrateLocalState();
  bindActions();
  subscribeFirebaseState();

  function storageKey(suffix) {
    const uid = window.NovaCanvas?.uid || "anon";
    return `novacanvas:studio:${uid}:${suffix}`;
  }

  function hydrateLocalState() {
    const savedImage = localStorage.getItem(storageKey("image"));
    const savedFileName = localStorage.getItem(storageKey("fileName"));
    const savedAnalysis = localStorage.getItem(storageKey("analysis"));

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

        if (primary.flowCheck) {
          state.analysis = primary.flowCheck;
          renderAnalysis(primary.flowCheck);
        }
      });
    };

    bind();
  }

  function bindActions() {
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

      if (action === "studio-flow-check") {
        if (!state.imageDataUrl) {
          ui?.showToast?.("Upload a sketch first");
          return;
        }

        const analysis = await runFlowCheck(state.imageDataUrl);
        state.analysis = analysis;
        localStorage.setItem(storageKey("analysis"), JSON.stringify(analysis));
        renderAnalysis(analysis);
        await persistProjectUpdate({
          flowCheck: analysis,
          updatedLabel: "just now",
          progress: Math.max(42, Math.min(96, analysis.score)),
          summary: `Flow score ${analysis.score}% • ${analysis.recommendation}`,
        });
        ui?.showToast?.("Flow check complete");
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

    fileInput.addEventListener("change", async (event) => {
      const [file] = event.target.files || [];
      if (!file) {
        return;
      }

      const dataUrl = await readFileAsDataUrl(file);
      state.imageDataUrl = dataUrl;
      state.fileName = file.name;
      canvasImage.src = dataUrl;
      uploadState.textContent = file.name;
      localStorage.setItem(storageKey("image"), dataUrl);
      localStorage.setItem(storageKey("fileName"), file.name);

      await persistProjectUpdate({
        title: file.name.replace(/\.[^.]+$/, ""),
        summary: `Uploaded sketch ready for flow analysis`,
        updatedLabel: "just now",
      });

      ui?.showToast?.("Sketch uploaded");
      fileInput.value = "";
    });
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

  function renderAnalysis(analysis) {
    if (!analysis) {
      return;
    }

    scoreNode.textContent = `${analysis.score}%`;
    contrastNode.textContent = analysis.contrastLabel;
    edgesNode.textContent = analysis.edgeLabel;
    feedbackNode.textContent = `“${analysis.recommendation}”`;
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
  for (let i = 0; i < values.length; i += 1) {
    const offset = i * 4;
    const value = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
    values[i] = value;
    brightnessSum += value;
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

  const brightnessScore = 100 - Math.min(100, Math.abs(brightnessAvg - 128) * 0.8);
  const contrastScore = Math.min(100, contrast * 1.8);
  const edgeScore = Math.min(100, edgeDensity * 1.6);
  const score = Math.round(brightnessScore * 0.2 + contrastScore * 0.45 + edgeScore * 0.35);

  const contrastLabel = contrast >= 58 ? "High" : contrast >= 38 ? "Balanced" : "Soft";
  const edgeLabel = edgeDensity >= 42 ? "Dense" : edgeDensity >= 24 ? "Controlled" : "Loose";

  let recommendation;
  if (score >= 80) {
    recommendation = "Strong structural flow. Focus next on refining focal contrast and edge hierarchy.";
  } else if (score >= 60) {
    recommendation = "Good base rhythm. Tighten the dominant silhouette and increase contrast around the focal path.";
  } else {
    recommendation = "Flow is still loose. Push bigger value separation and simplify edge clusters around the main form.";
  }

  return {
    score,
    brightness: Math.round(brightnessAvg),
    contrast: Math.round(contrast),
    edgeDensity: Math.round(edgeDensity),
    contrastLabel,
    edgeLabel,
    recommendation,
    analyzedAt: new Date().toISOString(),
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
