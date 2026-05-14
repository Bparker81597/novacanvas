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
